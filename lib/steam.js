'use strict';

const { getCached, setCache } = require('./cache');
const { createDedup } = require('./dedup');
const { CACHE_TTL_MS, DETAILS_CACHE_TTL_MS } = require('./config');

const STEAM_KEY = process.env.STEAM_API_KEY;
const withDedup = createDedup();

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

async function resolveSteamId(raw) {
  const id = raw.trim();
  if (/^7656119\d{10}$/.test(id)) return id;

  const cacheKey = `resolve:${id}`;
  const hit = getCached(cacheKey, DETAILS_CACHE_TTL_MS);
  if (hit) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(id)}`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    if (response.success !== 1) throw new Error(`Cannot find Steam account: "${id}"`);
    setCache(cacheKey, response.steamid, DETAILS_CACHE_TTL_MS);
    return response.steamid;
  });
}

async function getOwnedGames(steamId) {
  const cacheKey = `games:${steamId}`;
  const hit = getCached(cacheKey, CACHE_TTL_MS);
  if (hit) return hit;

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
    setCache(cacheKey, response.games, CACHE_TTL_MS);
    return response.games;
  });
}

async function getPlayerSummaries(steamIds) {
  const result = new Map();
  const uncached = [];
  for (const id of steamIds) {
    const hit = getCached(`player:${id}`, CACHE_TTL_MS);
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
      setCache(`player:${player.steamid}`, player, CACHE_TTL_MS);
      result.set(player.steamid, player);
    }
  }

  return steamIds.map(id => result.get(id) ?? { steamid: id, personaname: id, profileurl: '' });
}

async function getGameRating(appid) {
  const res = await fetch(
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`,
    { signal: signal() }
  );
  if (!res.ok) return null;
  const { query_summary: s } = await res.json();
  if (!s?.total_reviews) return null;

  const n = s.total_reviews;
  const pos = s.total_positive;
  const p = pos / n;
  const z = 1.96;
  const z2 = z * z;
  // Wilson score lower bound (95% confidence) — same formula as SteamDB
  const score =
    (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) /
    (1 + z2 / n);

  return {
    score: Math.round(score * 100),
    desc: s.review_score_desc,
    positive: pos,
    total: n,
  };
}

module.exports = { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating };
