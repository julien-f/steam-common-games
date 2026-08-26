'use strict';

// IsThereAnyDeal API — bundle listings + resolving a bundle's games to Steam appids.
// Undocumented-adjacent in the sense that this app treats it the same trust tier as the other
// third-party integrations covered by CLAUDE.md's compliance note: a free, key-gated API with
// published (if sparse) OpenAPI docs at https://docs.isthereanydeal.com/. Requires ITAD_API_KEY
// (see default.env) — unlike STEAM_API_KEY this is optional; every function here is only ever
// called once server.js has confirmed the key is set (see isItadConfigured there), so no
// explicit check is duplicated in this file.

const { getCached, setCache } = require('./cache');
const { createDedup } = require('./dedup');

const ITAD_KEY = process.env.ITAD_API_KEY;
const withDedup = createDedup();

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

// ITAD's numeric id for the Steam shop — resolved once from GET /service/shops/v1 (a near-
// static list) rather than hardcoded, since nothing in the published docs pins this value and
// shop ids are assigned by ITAD itself, not derived from anything Steam-side. Cached
// indefinitely-in-practice under the `itad-shop:` prefix (see BUNDLES_CACHE_TTL_MINUTES in
// default.env for why it shares that tier rather than getting its own).
const SHOP_ID_CACHE_KEY = 'itad-shop:steam';

async function getSteamShopId() {
  const hit = getCached(SHOP_ID_CACHE_KEY);
  if (hit !== undefined) return hit;

  return withDedup(SHOP_ID_CACHE_KEY, async () => {
    const res = await fetch(`https://api.isthereanydeal.com/service/shops/v1?key=${ITAD_KEY}`, { signal: signal() });
    if (!res.ok) throw upstreamError(`ITAD shops error ${res.status}`);
    const shops = await res.json();
    const steam = Array.isArray(shops) ? shops.find(s => s.title === 'Steam') : null;
    if (!steam) throw upstreamError('ITAD shops response has no "Steam" entry');
    setCache(SHOP_ID_CACHE_KEY, steam.id);
    return steam.id;
  });
}

// GET /bundles/v1 — current bundles, one page at a time. Params match the upstream API
// directly (see https://docs.isthereanydeal.com/); `sort` is passed through verbatim rather
// than validated against an enum, same trust-the-upstream-value approach as everywhere else
// this app forwards a "same as the website" sort string.
async function getBundles({ country = 'US', offset = 0, limit = 20, sort = '-publish', mature = false, expired = false } = {}) {
  const cacheKey = `itad-bundles:${country}:${sort}:${expired}:${mature}:${offset}:${limit}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const qs = new URLSearchParams({
      key: ITAD_KEY, country, offset: String(offset), limit: String(limit),
      sort, mature: String(mature), expired: String(expired),
    });
    const res = await fetch(`https://api.isthereanydeal.com/bundles/v1?${qs}`, { signal: signal() });
    if (!res.ok) throw upstreamError(`ITAD bundles error ${res.status}`);
    const bundles = await res.json();
    setCache(cacheKey, bundles);
    return bundles;
  });
}

// Resolves a batch of ITAD game ids (uuids, off a bundle's tiers[].games[].id) to their Steam
// appid, via POST /lookup/{shopId}/gid/v1 — the reverse direction of the `games/lookup/v1`
// appid→gid endpoint. Each gid is cached individually (`itad-appid:{gid}`) so a game seen in
// one bundle is never re-resolved for another. `null` (no Steam listing for this game, or ITAD
// has no mapping for it yet) is cached the same as a real appid — a confirmed miss, not a
// gap to retry every time.
async function resolveSteamAppIds(gids) {
  const result = new Map();
  const uncached = [];
  for (const gid of gids) {
    const hit = getCached(`itad-appid:${gid}`);
    if (hit !== undefined) result.set(gid, hit);
    else uncached.push(gid);
  }
  if (uncached.length === 0) return result;

  const shopId = await getSteamShopId();
  // Deduped per exact batch (sorted, joined) — good enough here since resolveSteamAppIds is
  // only ever called once per opened bundle with that bundle's own full uncached gid set,
  // unlike e.g. getPlayerSummaries which needs true per-id dedup across overlapping batches.
  const dedupKey = `itad-resolve:${[...uncached].sort().join(',')}`;
  const resolved = await withDedup(dedupKey, async () => {
    // Path is /lookup/shop/{shopId}/id/v1 (ITAD's own `/lookup/{lookup-what}/{by-what}/`
    // convention), not the more RPC-sounding /lookup/{shopId}/gid/v1 the shape of the sibling
    // endpoints briefly suggested — confirmed against the live API, not just the docs.
    const res = await fetch(`https://api.isthereanydeal.com/lookup/shop/${shopId}/id/v1?key=${ITAD_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uncached),
      signal: signal(),
    });
    if (!res.ok) throw upstreamError(`ITAD shopid lookup error ${res.status}`);
    return res.json(); // { gid: ["app/<id>" | "sub/<id>", ...] | null }
  });

  for (const gid of uncached) {
    const shopIds = resolved[gid];
    // Steam ids come back namespaced as "app/<id>" (a store page) or "sub/<id>" (a package/
    // bundle sub, not a single game page) — only the former maps to something
    // GET /api/game-details/:appid can look up. Order isn't guaranteed to put "app/" first,
    // so find it explicitly rather than assuming index 0; a game listed only as a "sub"
    // resolves to null, same as no Steam listing at all.
    let appid = null;
    if (Array.isArray(shopIds)) {
      for (const id of shopIds) {
        const m = /^app\/(\d+)$/.exec(id);
        if (m) { appid = Number(m[1]); break; }
      }
    }
    setCache(`itad-appid:${gid}`, appid);
    result.set(gid, appid);
  }
  return result;
}

// Steam's own non-discounted regular price plus historical lows (all-time / 1yr / 3mo, across
// every shop ITAD tracks, not just Steam — "have I ever seen this cheaper anywhere" is the more
// useful question than a Steam-only low) for a batch of ITAD game ids, via POST
// /games/prices/v3. Both figures come back in whatever `country`'s currency, same as the
// bundle price itself, so a "bundle price vs. buying outright" comparison is apples-to-apples.
// Each gid is cached whole (raw historyLow + deals, not just the two fields extracted below) —
// same "cache raw, extract at read time" approach as getStoreBrowseItem in lib/steam.js — so a
// future need for another shop's price or the current best deal never needs a new upstream call.
// Cached per (gid, country) — unlike the appid resolution above, a price is meaningfully
// different per region, not just a currency relabeling.
async function getPrices(gids, { country = 'US' } = {}) {
  const result = new Map();
  const uncached = [];
  for (const gid of gids) {
    const hit = getCached(`itad-price:${country}:${gid}`);
    if (hit !== undefined) result.set(gid, hit);
    else uncached.push(gid);
  }
  if (uncached.length === 0) return result;

  // The upstream endpoint caps a single request at 200 game ids (see the shared `gids-200`
  // request body in ITAD's own OpenAPI docs) — chunk rather than assuming callers never exceed
  // it, since resolveSteamAppIds' own MAX_BUNDLE_RESOLVE_GAMES allows up to 500 per bundle.
  const CHUNK_SIZE = 200;
  for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
    const chunk = uncached.slice(i, i + CHUNK_SIZE);
    const dedupKey = `itad-prices:${country}:${[...chunk].sort().join(',')}`;
    const entries = await withDedup(dedupKey, async () => {
      const res = await fetch(`https://api.isthereanydeal.com/games/prices/v3?key=${ITAD_KEY}&country=${country}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: signal(),
      });
      if (!res.ok) throw upstreamError(`ITAD prices error ${res.status}`);
      return res.json(); // [{ id, historyLow: {all, y1, m3}, deals: [{ shop: {id, name}, regular, price, ... }] }]
    });
    for (const entry of entries) {
      setCache(`itad-price:${country}:${entry.id}`, entry);
      result.set(entry.id, entry);
    }
    // A gid ITAD has no price data for at all is simply absent from the response (not a null
    // entry) — cache that as null too, so it isn't re-requested on every subsequent bundle.
    for (const gid of chunk) {
      if (!result.has(gid)) {
        setCache(`itad-price:${country}:${gid}`, null);
        result.set(gid, null);
      }
    }
  }
  return result;
}

// Extracts just what the Bundles page's table needs from one getPrices() entry — Steam's own
// regular (non-discounted) price, and the three historical lows. `null` fields throughout mean
// "ITAD has no data for this", not zero.
function extractPriceInfo(entry, steamShopId) {
  if (!entry) return { steamRegular: null, lowAll: null, lowY1: null, lowM3: null };
  const steamDeal = (entry.deals || []).find(d => d.shop?.id === steamShopId);
  return {
    steamRegular: steamDeal?.regular ?? null,
    lowAll: entry.historyLow?.all ?? null,
    lowY1:  entry.historyLow?.y1   ?? null,
    lowM3:  entry.historyLow?.m3   ?? null,
  };
}

module.exports = { getSteamShopId, getBundles, resolveSteamAppIds, getPrices, extractPriceInfo };
