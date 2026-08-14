'use strict';

const { getCached, setCache } = require('./cache');
const { createDedup } = require('./dedup');

const STEAM_KEY = process.env.STEAM_API_KEY;
const withDedup = createDedup();

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

// Limit concurrent requests and enforce a minimum interval between them.
// minIntervalMs delays slot release after each request so throughput stays under the rate limit
// even when many requests are queued (concurrency alone isn't enough — Steam limits by req/s).
function createSemaphore(limit, minIntervalMs = 0) {
  let active = 0;
  const queue = [];
  function release() {
    active--;
    next();
  }
  function next() {
    if (active < limit && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(
        val => { resolve(val); minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release(); },
        err => { reject(err);  minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release(); }
      );
    }
  }
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

// 2 in-flight, 500 ms cooldown per slot → ≈ 4 req/s sustained to Steam's unauthenticated store.
const storeLimit = createSemaphore(2, 500);
const spyLimit   = createSemaphore(3);

// Circuit breaker: trip after 2 consecutive 403s (rate limit storm), reset on any success.
// A single 403 is ignored to avoid false-positives on per-game blocks (removed/region-locked).
let storeConsecutive403s = 0;
let storeBlockedUntil = 0;
const STORE_BLOCK_MS = 5 * 60 * 1000;

// Fetch a Steam store URL through the semaphore, retrying up to twice on 429.
async function fetchStoreApi(url) {
  if (Date.now() < storeBlockedUntil) throw upstreamError('Steam store: rate limited (circuit open)');
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await storeLimit(() => fetch(url, { signal: signal() }));
    if (res.status === 403) {
      if (++storeConsecutive403s >= 2) {
        storeBlockedUntil = Date.now() + STORE_BLOCK_MS;
        storeConsecutive403s = 0;
      }
      throw upstreamError('Steam store: rate limited (403)');
    }
    if (res.status !== 429) { storeConsecutive403s = 0; return res; }
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 2000 * (2 ** attempt));
    await new Promise(r => setTimeout(r, delay));
  }
  throw upstreamError('Steam store: rate limited after retries');
}

async function resolveSteamId(raw) {
  const id = raw.trim();
  if (/^7656119\d{10}$/.test(id)) return id;

  const cacheKey = `resolve:${id}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(id)}`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    if (response.success !== 1) throw new Error(`Cannot find Steam account: "${id}"`);
    setCache(cacheKey, response.steamid);
    return response.steamid;
  });
}

async function getOwnedGames(steamId, { force = false } = {}) {
  const cacheKey = `games:${steamId}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    if (!response.games) {
      throw new Error(`Cannot access library for ${steamId} — profile may be set to private`);
    }
    setCache(cacheKey, response.games);
    return response.games;
  });
}

async function getWishlist(steamId, { force = false } = {}) {
  const cacheKey = `wishlist:${steamId}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${STEAM_KEY}&steamid=${steamId}`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    // A private wishlist, a private profile, and a genuinely empty wishlist are
    // all indistinguishable — each returns `{"response":{}}` with no `items` key.
    // Treat all three as an empty wishlist rather than throwing.
    const items = response.items || [];
    setCache(cacheKey, items);
    return items;
  });
}

// `forceIds` lets a caller bypass the cache for specific accounts within the batch
// (e.g. the Library Explorer's per-account "↻" refresh) without forcing every other
// account in the same GetPlayerSummaries call to also re-fetch — `force` alone would
// bypass the whole batch.
async function getPlayerSummaries(steamIds, { force = false, forceIds } = {}) {
  const result = new Map();
  const uncached = [];
  for (const id of steamIds) {
    const hit = getCached(`player:${id}`, { force: force || forceIds?.has(id) });
    if (hit) result.set(id, hit);
    else uncached.push(id);
  }

  if (uncached.length > 0) {
    const fetched = await withDedup(`players:${[...uncached].sort().join(',')}`, async () => {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${uncached.join(',')}`,
        { signal: signal() }
      );
      if (!res.ok) return [];
      const { response } = await res.json();
      return response.players || [];
    });

    for (const player of fetched) {
      setCache(`player:${player.steamid}`, player);
      result.set(player.steamid, player);
    }
  }

  return steamIds.map(id => result.get(id) ?? { steamid: id, personaname: id, profileurl: '' });
}

function computeRating(raw) {
  if (!raw) return null;
  const n = raw.total_reviews;
  const pos = raw.total_positive;
  const p = pos / n;
  const z = 1.96;
  const z2 = z * z;
  // Wilson score lower bound (95% confidence) — same formula as SteamDB
  const score =
    (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) /
    (1 + z2 / n);
  return {
    score: Math.round(score * 100),
    desc: raw.review_score_desc,
    positive: pos,
    total: n,
  };
}

async function getGameRating(appid, { force = false } = {}) {
  const cacheKey = `rating:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return computeRating(hit);

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
    );
    if (!res.ok) throw upstreamError(`Steam reviews error ${res.status}`);
    const { query_summary: s } = await res.json();
    if (!s?.total_reviews) {
      setCache(cacheKey, null);
      return null;
    }
    setCache(cacheKey, s);
    return computeRating(s);
  });
}

function extractAppDetails(raw, appid) {
  if (!raw) return null;
  const {
    name = null, genres = [], categories = [], developers = [], publishers = [],
    short_description = '', release_date = {}, metacritic, screenshots = [], movies = [],
    capsule_imagev5 = null, capsule_image = null, header_image = null,
  } = raw;
  return {
    name,
    genres:      genres.map(g => g.description),
    categories:  categories.map(c => c.description),
    developers,
    publishers,
    description: short_description || null,
    // `coming_soon` only tells us whether the game has shipped yet, not whether Steam gave us
    // a usable date — an unreleased game can still have a concrete announced date (e.g.
    // "Oct 14, 2026"), not just a placeholder ("Coming soon"). Always pass through whatever
    // string Steam gives; public/library.js's `endOfReleasePeriod` handles turning fuzzy forms
    // ("2026", "Fall 2026") into a sortable date and treats genuinely unparseable placeholders
    // as missing.
    releaseDate: release_date?.date || null,
    metacritic:  metacritic?.score != null ? { score: metacritic.score, url: metacritic.url || null } : null,
    capsule:     capsule_imagev5 || capsule_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`,
    // The side panel's hero banner (public/mediaItems.js) — Steam's own header image for
    // this specific game, rather than only ever guessing the conventional `.../header.jpg`
    // CDN path. The guess (kept as a fallback here, and again client-side for the brief
    // window before this metadata has loaded at all) doesn't exist for every appid — some
    // games only ever had newer asset sizes uploaded — and since the guessed path never
    // changes, a game whose guess 404s stays broken no matter how many times the panel is
    // reopened. `header_image` is real store metadata, so it's always the correct asset.
    banner:      header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
    movies:      movies.slice(0, 5).map(m => ({ id: m.id, thumbnail: m.thumbnail, hls: m.hls_h264 || null })),
    screenshots: screenshots.slice(0, 10).map(s => ({ id: s.id, thumbnail: s.path_thumbnail, full: s.path_full })),
  };
}

async function getAppDetails(appid, { force = false } = {}) {
  const cacheKey = `meta:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return extractAppDetails(hit, appid);

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
    );
    if (!res.ok) throw upstreamError(`Steam Store API error ${res.status}`);
    const json = await res.json();
    const entry = json?.[String(appid)];
    if (!entry?.success || !entry.data) {
      setCache(cacheKey, null);
      return null;
    }
    setCache(cacheKey, entry.data);
    return extractAppDetails(entry.data, appid);
  });
}

// Trims to the fields the frontend's lookup dropdown actually renders (name + thumbnail),
// capped well below what the endpoint returns since only a short dropdown list is shown.
function extractSearchResults(raw) {
  if (!raw || !Array.isArray(raw.items)) return [];
  return raw.items.slice(0, 8).map(item => ({
    appid: item.id,
    name: item.name,
    tinyImage: item.tiny_image || null,
  }));
}

// Name → appid lookup for games not necessarily owned or wishlisted by anyone — backs the
// "look up any game" search box on both pages. Wraps the same undocumented storefront search
// Steam's own store search box uses (no auth, no key) — same trust tier as the HLTB/wishlist
// endpoints elsewhere in this file; see the compliance note in CLAUDE.md.
async function searchStoreGames(term, { force = false } = {}) {
  const cacheKey = `search:${term.toLowerCase()}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
    );
    if (!res.ok) throw upstreamError(`Steam store search error ${res.status}`);
    const results = extractSearchResults(await res.json());
    setCache(cacheKey, results);
    return results;
  });
}

function extractTags(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag]) => tag);
}

async function getSteamSpyTags(appid, { force = false } = {}) {
  const cacheKey = `tags:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return extractTags(hit);

  return withDedup(cacheKey, async () => {
    const res = await spyLimit(() =>
      fetch(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, { signal: signal() })
    );
    if (!res.ok) throw upstreamError(`SteamSpy error ${res.status}`);
    const data = await res.json();
    const raw = (data?.tags && typeof data.tags === 'object') ? data.tags : null;
    setCache(cacheKey, raw);
    return extractTags(raw);
  });
}

// Linux/Steam Deck compatibility tier, from the community-run ProtonDB. Wraps its
// undocumented summary endpoint — same trust tier as the HLTB/wishlist endpoints
// elsewhere in this file (see CLAUDE.md's compliance note): no auth/key, low-volume,
// liable to change without notice. A 404 means "no reports for this appid yet",
// which is cached as null the same way an empty Steam review count is.
// "pending" isn't a compatibility outcome — it means ProtonDB has too few reports to
// confidently assign one — so it carries the same actionable information as no rating at
// all. Treated as null here rather than passed through, so neither client (the side panel's
// badge, the Library Explorer's column/sort order) has to special-case a tier that doesn't
// belong on the quality spectrum the other tiers represent. Raw upstream data is still what
// gets cached (see getProtonDbStatus below) — this is purely a display-transform decision,
// so it can change again later without needing to bust anything cached under the old rule.
function extractProtonDb(raw) {
  if (!raw || raw.tier === 'pending') return null;
  return { tier: raw.tier, confidence: raw.confidence, total: raw.total };
}

async function getProtonDbStatus(appid, { force = false } = {}) {
  const cacheKey = `protondb:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return extractProtonDb(hit);

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`,
      { signal: signal() }
    );
    if (res.status === 404) {
      setCache(cacheKey, null);
      return null;
    }
    if (!res.ok) {
      // 403 here has been observed as a blanket bot-block rather than a per-appid failure
      // (this fetch sends no headers, unlike HLTB's spoofed UA/Referer — see CLAUDE.md) — a
      // body snippet distinguishes "app-specific error" from "same block page for every appid".
      const bodySnippet = await Promise.resolve().then(() => res.text()).catch(() => '');
      throw upstreamError(`ProtonDB error ${res.status} for appid ${appid}${bodySnippet ? `: ${bodySnippet.slice(0, 200)}` : ''}`);
    }
    const raw = await res.json();
    setCache(cacheKey, raw);
    return extractProtonDb(raw);
  });
}

module.exports = { resolveSteamId, getOwnedGames, getWishlist, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags, searchStoreGames, getProtonDbStatus };
