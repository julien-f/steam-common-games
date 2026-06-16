'use strict';

const { getCached, setCache } = require('./cache');

const STEAM_KEY = process.env.STEAM_API_KEY;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MINUTES || 60) * 60 * 1000;
const DETAILS_CACHE_TTL_MS = Number(process.env.DETAILS_CACHE_TTL_MINUTES || 10080) * 60 * 1000;

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

async function resolveSteamId(raw) {
  const id = raw.trim();
  if (/^7656119\d{10}$/.test(id)) return id;

  const hit = getCached(`resolve:${id}`, DETAILS_CACHE_TTL_MS);
  if (hit) return hit;

  const res = await fetch(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(id)}`,
    { signal: signal() }
  );
  if (!res.ok) throw new Error(`Steam API error ${res.status}`);
  const { response } = await res.json();
  if (response.success !== 1) throw new Error(`Cannot find Steam account: "${id}"`);
  setCache(`resolve:${id}`, response.steamid);
  return response.steamid;
}

async function getOwnedGames(steamId) {
  const hit = getCached(`games:${steamId}`, CACHE_TTL_MS);
  if (hit) return hit;

  const res = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`,
    { signal: signal() }
  );
  if (!res.ok) throw new Error(`Steam API error ${res.status}`);
  const { response } = await res.json();
  if (!response.games) {
    throw new Error(`Cannot access library for ${steamId} — profile may be set to private`);
  }
  setCache(`games:${steamId}`, response.games);
  return response.games;
}

async function getPlayerSummaries(steamIds) {
  const key = `players:${[...steamIds].sort().join(',')}`;
  const hit = getCached(key, CACHE_TTL_MS);
  if (hit) return hit;

  const res = await fetch(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${steamIds.join(',')}`,
    { signal: signal() }
  );
  if (!res.ok) return steamIds.map(id => ({ steamid: id, personaname: id, profileurl: '' }));
  const { response } = await res.json();
  const players = response.players || [];
  setCache(key, players);
  return players;
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
