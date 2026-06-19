'use strict';

const { getCached, setCache } = require('./cache');
const { createDedup } = require('./dedup');

const STEAM_KEY = process.env.STEAM_API_KEY;
const withDedup = createDedup();

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

// Limit concurrent requests to Steam's unauthenticated store endpoints (appreviews, appdetails).
// These are aggressively rate-limited per IP; cap at 2 in-flight to stay under the limit.
function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  function next() {
    if (active < limit && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(val => { active--; resolve(val); next(); },
                err => { active--; reject(err);  next(); });
    }
  }
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

const storeLimit = createSemaphore(2);
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

async function getOwnedGames(steamId) {
  const cacheKey = `games:${steamId}`;
  const hit = getCached(cacheKey);
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

async function getPlayerSummaries(steamIds) {
  const result = new Map();
  const uncached = [];
  for (const id of steamIds) {
    const hit = getCached(`player:${id}`);
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

async function getGameRating(appid) {
  const cacheKey = `rating:${appid}`;
  const hit = getCached(cacheKey);
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

function extractAppDetails(raw) {
  if (!raw) return null;
  const {
    genres = [], categories = [], developers = [], publishers = [],
    short_description = '', release_date = {}, metacritic, screenshots = [], movies = [],
  } = raw;
  return {
    genres:      genres.map(g => g.description),
    categories:  categories.map(c => c.description),
    developers,
    publishers,
    description: short_description || null,
    releaseDate: release_date?.coming_soon ? null : (release_date?.date || null),
    metacritic:  metacritic?.score != null ? { score: metacritic.score, url: metacritic.url || null } : null,
    movies:      movies.slice(0, 5).map(m => ({ thumbnail: m.thumbnail, hls: m.hls_h264 || null })),
    screenshots: screenshots.slice(0, 10).map(s => ({ thumbnail: s.path_thumbnail, full: s.path_full })),
  };
}

async function getAppDetails(appid) {
  const cacheKey = `meta:${appid}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return extractAppDetails(hit);

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
    return extractAppDetails(entry.data);
  });
}

function extractTags(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag]) => tag);
}

async function getSteamSpyTags(appid) {
  const cacheKey = `tags:${appid}`;
  const hit = getCached(cacheKey);
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

module.exports = { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags };
