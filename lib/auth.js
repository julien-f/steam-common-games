'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const { SESSION_TTL_MS } = require('./config');
const { trackedFetch } = require('./metrics');

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'steam_login_state';

// ── Cookies ───────────────────────────────────────────────────────────────────
// No cookie-parsing dependency — the format needed here (read a plain name=value pair, write one
// back with a handful of attributes) is small enough not to warrant one.

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// `secure` is left to the caller (server.js knows the request's actual scheme) rather than
// hardcoded true — a hardcoded Secure attribute would silently drop every cookie in local dev,
// which normally runs over plain http.
function serializeCookie(name, value, { maxAgeMs, secure } = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (secure) str += '; Secure';
  str += value === '' ? '; Max-Age=0' : `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  return str;
}

// ── Steam OpenID 2.0 ──────────────────────────────────────────────────────────
// Steam has no OAuth2 for third parties — OpenID 2.0 against steamcommunity.com/openid is the
// sanctioned way to authenticate a user (see steamcommunity.com/dev). `state` guards against
// login CSRF (forcing a victim's session to log in as an attacker's Steam account): it's minted
// here, round-tripped through Steam untouched inside `openid.return_to`, and checked against a
// short-lived cookie on the way back — Steam's own signature (verified below) already protects
// the identity assertion itself, this only protects which browser session it lands in.

function buildLoginUrl(origin, state) {
  const returnTo = `${origin}/auth/steam/callback?state=${encodeURIComponent(state)}`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

// Verifies the callback's signed assertion by echoing every openid.* param back to Steam with
// openid.mode=check_authentication (the OpenID 2.0 indirect-verification dance) — never trust
// the query params on their own, since anyone can craft a claimed_id in a plain GET request.
// Returns the asserted steamid64, or null if the assertion doesn't check out.
async function verifySteamAssertion(query) {
  const claimedId = query['openid.claimed_id'];
  if (typeof claimedId !== 'string') return null;
  const match = claimedId.match(CLAIMED_ID_RE);
  if (!match) return null;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('openid.') && typeof value === 'string') params.set(key, value);
  }
  params.set('openid.mode', 'check_authentication');

  const res = await trackedFetch('steam-openid', 'verify', STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const body = await res.text();
  if (!/is_valid\s*:\s*true/.test(body)) return null;

  return match[1];
}

// ── Users & sessions (db.sqlite) ─────────────────────────────────────────────

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (steamid, created_at, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(steamid) DO UPDATE SET updated_at = excluded.updated_at
  `),
  getUserPrefs: db.prepare('SELECT key, value, updated_at FROM user_prefs WHERE steamid = ?'),
  setUserPref: db.prepare('INSERT OR REPLACE INTO user_prefs (steamid, key, value, updated_at) VALUES (?, ?, ?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (id, steamid, expires_at) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT steamid, expires_at FROM sessions WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};

// Evict sessions that expired while the server was stopped — same "TTL changes take effect on
// next restart" treatment lib/cache.js's own startup eviction gets.
stmts.deleteExpiredSessions.run(Date.now());

function upsertUser(steamid) {
  const now = Date.now();
  stmts.upsertUser.run(steamid, now, now);
}

function createSession(steamid) {
  const id = crypto.randomBytes(32).toString('hex');
  stmts.insertSession.run(id, steamid, Date.now() + SESSION_TTL_MS);
  return id;
}

function destroySession(sessionId) {
  if (sessionId) stmts.deleteSession.run(sessionId);
}

// Every key/value this user has saved, each with the time it was last written — the frontend
// (authStore.ts) merges this against its own local copy by last-write-wins per key, not by
// treating the whole set as one blob (see setUserPref below).
function getUserPrefs(steamid) {
  const prefs = {};
  for (const { key, value, updated_at } of stmts.getUserPrefs.all(steamid)) {
    prefs[key] = { value: JSON.parse(value), updatedAt: updated_at };
  }
  return prefs;
}

// Undefined for a missing, expired, or otherwise unknown session — callers treat that as
// logged-out rather than an error.
function getSessionUser(sessionId) {
  if (!sessionId) return undefined;
  const session = stmts.getSession.get(sessionId);
  if (!session) return undefined;
  if (session.expires_at < Date.now()) {
    stmts.deleteSession.run(sessionId);
    return undefined;
  }
  return { steamid: session.steamid, prefs: getUserPrefs(session.steamid) };
}

// Sets one key unconditionally — a write always overwrites whatever's already stored. Prefs still
// carry `updatedAt` (the caller's clock) for display, but it's no longer a write guard: a plain
// key/value pref (region, ...) still merges last-write-wins client-side (authStore.ts), while a
// table-view key instead surfaces a Save/Revert choice on the client when the two sides disagree
// (public/prefDivergence.ts) — either way, by the time a PUT lands here the client has already
// decided this write should win.
function setUserPref(steamid, key, value, updatedAt) {
  stmts.setUserPref.run(steamid, key, JSON.stringify(value), updatedAt);
  return true;
}

module.exports = {
  SESSION_COOKIE,
  STATE_COOKIE,
  parseCookies,
  serializeCookie,
  buildLoginUrl,
  verifySteamAssertion,
  upsertUser,
  createSession,
  destroySession,
  getSessionUser,
  getUserPrefs,
  setUserPref,
};
