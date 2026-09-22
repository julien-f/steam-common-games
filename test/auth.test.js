'use strict';

// Force the in-memory DB regardless of how this file is invoked — see steam.test.js's own
// comment on why this must be set before requiring lib/db (via lib/auth).
process.env.DB_FILE = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCookies, serializeCookie, buildLoginUrl, verifySteamAssertion,
  upsertUser, createSession, destroySession, getSessionUser, setUserPref,
} = require('../lib/auth');

const VALID_CLAIMED_ID = 'https://steamcommunity.com/openid/id/76561198000000001';

// ── cookies ───────────────────────────────────────────────────────────────────

test('parseCookies: parses several name=value pairs', () => {
  assert.deepEqual(parseCookies('sid=abc; steam_login_state=xyz'), { sid: 'abc', steam_login_state: 'xyz' });
});

test('parseCookies: decodes percent-encoded values', () => {
  assert.deepEqual(parseCookies('k=a%20b'), { k: 'a b' });
});

test('parseCookies: empty/missing header yields no cookies', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('serializeCookie: sets Max-Age from maxAgeMs and HttpOnly/SameSite always', () => {
  const str = serializeCookie('sid', 'abc', { maxAgeMs: 5000 });
  assert.match(str, /^sid=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=5$/);
});

test('serializeCookie: adds Secure only when asked', () => {
  assert.match(serializeCookie('sid', 'abc', { maxAgeMs: 1000, secure: true }), /; Secure/);
  assert.doesNotMatch(serializeCookie('sid', 'abc', { maxAgeMs: 1000 }), /; Secure/);
});

test('serializeCookie: an empty value clears the cookie via Max-Age=0', () => {
  assert.match(serializeCookie('sid', '', {}), /Max-Age=0$/);
});

// ── OpenID login URL ──────────────────────────────────────────────────────────

test('buildLoginUrl: points at Steam with the realm, return_to and state set', () => {
  const url = new URL(buildLoginUrl('https://example.com', 'the-state'));
  assert.equal(url.origin, 'https://steamcommunity.com');
  assert.equal(url.searchParams.get('openid.realm'), 'https://example.com');
  assert.equal(url.searchParams.get('openid.mode'), 'checkid_setup');
  const returnTo = new URL(url.searchParams.get('openid.return_to'));
  assert.equal(returnTo.pathname, '/auth/steam/callback');
  assert.equal(returnTo.searchParams.get('state'), 'the-state');
});

// ── verifySteamAssertion ──────────────────────────────────────────────────────

test('verifySteamAssertion: returns the steamid64 when Steam confirms the assertion', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => 'ns:...\nis_valid:true\n' }));
  const steamid = await verifySteamAssertion({ 'openid.claimed_id': VALID_CLAIMED_ID, 'openid.mode': 'id_res' });
  assert.equal(steamid, '76561198000000001');
});

test('verifySteamAssertion: forwards every openid.* param with mode overridden to check_authentication', async (t) => {
  let sentBody;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sentBody = new URLSearchParams(opts.body);
    return { ok: true, text: async () => 'is_valid:true' };
  });
  await verifySteamAssertion({ 'openid.claimed_id': VALID_CLAIMED_ID, 'openid.sig': 'abc', unrelated: 'drop-me' });
  assert.equal(sentBody.get('openid.mode'), 'check_authentication');
  assert.equal(sentBody.get('openid.sig'), 'abc');
  assert.equal(sentBody.has('unrelated'), false);
});

test('verifySteamAssertion: null when Steam says the assertion is invalid', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => 'is_valid:false' }));
  assert.equal(await verifySteamAssertion({ 'openid.claimed_id': VALID_CLAIMED_ID }), null);
});

test('verifySteamAssertion: null when the verification request itself fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));
  assert.equal(await verifySteamAssertion({ 'openid.claimed_id': VALID_CLAIMED_ID }), null);
});

test('verifySteamAssertion: null for a malformed claimed_id, without even calling Steam', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => 'is_valid:true' }));
  assert.equal(await verifySteamAssertion({ 'openid.claimed_id': 'https://evil.example/not-steam' }), null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('verifySteamAssertion: null when claimed_id is missing entirely', async () => {
  assert.equal(await verifySteamAssertion({}), null);
});

// ── users & sessions ──────────────────────────────────────────────────────────

test('createSession + getSessionUser: round-trips to the steamid and its (initially empty) prefs', () => {
  const steamid = '76561198000000101';
  upsertUser(steamid);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId), { steamid, prefs: {} });
});

test('getSessionUser: undefined for an unknown or missing session id', () => {
  assert.equal(getSessionUser('does-not-exist'), undefined);
  assert.equal(getSessionUser(undefined), undefined);
});

test('destroySession: the session stops resolving to a user afterwards', () => {
  const steamid = '76561198000000102';
  upsertUser(steamid);
  const sessionId = createSession(steamid);
  destroySession(sessionId);
  assert.equal(getSessionUser(sessionId), undefined);
});

test('setUserPref: sets one key with its updatedAt, visible through a fresh session lookup', () => {
  const steamid = '76561198000000103';
  const t1 = 1000;
  upsertUser(steamid);
  setUserPref(steamid, 'myAccount', { id: steamid }, t1);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId).prefs, { myAccount: { value: { id: steamid }, updatedAt: t1 } });
});

test('setUserPref: merges into existing prefs rather than replacing the whole set', () => {
  const steamid = '76561198000000106';
  upsertUser(steamid);
  setUserPref(steamid, 'a', 1, 1000);
  setUserPref(steamid, 'b', 2, 1000);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId).prefs, {
    a: { value: 1, updatedAt: 1000 },
    b: { value: 2, updatedAt: 1000 },
  });
});

test('setUserPref: a write always replaces whatever was there, regardless of updatedAt ordering', () => {
  const steamid = '76561198000000107';
  upsertUser(steamid);
  setUserPref(steamid, 'a', 'old', 1000);
  const applied = setUserPref(steamid, 'a', 'new', 2000);
  assert.equal(applied, true);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId).prefs.a, { value: 'new', updatedAt: 2000 });
});

test('setUserPref: an "older" updatedAt still overwrites — the server no longer guards on it', () => {
  const steamid = '76561198000000108';
  upsertUser(steamid);
  setUserPref(steamid, 'a', 'new', 2000);
  const applied = setUserPref(steamid, 'a', 'later-but-lower-updatedAt', 1000);
  assert.equal(applied, true);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId).prefs.a, { value: 'later-but-lower-updatedAt', updatedAt: 1000 });
});

test('upsertUser: logging in again does not reset that user\'s prefs', () => {
  const steamid = '76561198000000104';
  upsertUser(steamid);
  setUserPref(steamid, 'keep', 'me', 1000);
  upsertUser(steamid);
  const sessionId = createSession(steamid);
  assert.deepEqual(getSessionUser(sessionId).prefs.keep, { value: 'me', updatedAt: 1000 });
});
