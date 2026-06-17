'use strict';

require('dotenv').config();

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

const express = require('express');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { getCached, setCache } = require('./lib/cache');
const { createDedup } = require('./lib/dedup');
const { DETAILS_CACHE_TTL_MS } = require('./lib/config');
const { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating } = require('./lib/steam');
const { getHLTB } = require('./lib/hltb');
const { groupByOwnership } = require('./lib/groupGames');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const TRUST_PROXY = process.env.TRUST_PROXY;

const app = express();
if (TRUST_PROXY !== undefined) app.set('trust proxy', TRUST_PROXY);
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stricter limit for searches — each uncached user triggers Steam API calls
const searchLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please wait a minute and try again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Generous limit for details — responses are almost always served from cache
const detailsLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: !!process.env.STEAM_API_KEY });
});

app.post('/api/common-games', searchLimit, async (req, res) => {
  if (!process.env.STEAM_API_KEY) {
    return res.status(503).json({
      error: 'STEAM_API_KEY is not configured. Restart: STEAM_API_KEY=yourkey node server.js',
    });
  }

  // Accept { slots: [["alice", "bob"], ["charlie"]] }
  // or legacy { users: ["alice", "charlie"] } (each user becomes a single-member slot)
  let rawSlots = req.body.slots;
  if (!rawSlots && Array.isArray(req.body.users)) {
    rawSlots = req.body.users.map(u => [u]);
  }

  if (
    !Array.isArray(rawSlots) ||
    rawSlots.length < 2 ||
    !rawSlots.every(s => Array.isArray(s) && s.length > 0 && s.every(u => typeof u === 'string' && u.trim().length > 0))
  ) {
    return res.status(400).json({ error: 'Provide at least 2 players' });
  }
  if (rawSlots.reduce((n, s) => n + s.length, 0) > MAX_USERS) {
    return res.status(400).json({ error: `Too many users — maximum is ${MAX_USERS}` });
  }

  try {
    // Resolve all users; deduplicate within each slot
    const resolvedSlots = await Promise.all(
      rawSlots.map(async slot => [...new Set(await Promise.all(slot.map(resolveSteamId)))])
    );

    // Fetch all unique Steam IDs in one pass
    const uniqueIds = [...new Set(resolvedSlots.flat())];
    const [playerList, libraryList] = await Promise.all([
      getPlayerSummaries(uniqueIds),
      Promise.all(uniqueIds.map(getOwnedGames)),
    ]);

    const libraryById = new Map(uniqueIds.map((id, i) => [id, libraryList[i]]));
    const playerById = new Map(playerList.map(p => [p.steamid, p]));

    // Union libraries within each slot, group player summaries by slot
    const slotLibraries = resolvedSlots.map(ids => {
      const merged = new Map();
      for (const id of ids) {
        for (const game of libraryById.get(id) || []) {
          if (!merged.has(game.appid)) merged.set(game.appid, game);
        }
      }
      return [...merged.values()];
    });

    const playerSlots = resolvedSlots.map(ids =>
      ids.map(id => playerById.get(id) || { steamid: id, personaname: id, profileurl: '' })
    );

    const groups = groupByOwnership(slotLibraries);
    res.json({ groups, slots: playerSlots });
  } catch (err) {
    if (err.isUpstream || err.name === 'TimeoutError') console.error('[upstream]', err.message);
    const status = err.isUpstream ? 502 : err.name === 'TimeoutError' ? 504 : 400;
    res.status(status).json({ error: err.message });
  }
});

const dedupDetails = createDedup();

app.get('/api/game-details/:appid', detailsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }

  const cacheKey = `details:${appid}`;
  const hit = getCached(cacheKey, DETAILS_CACHE_TTL_MS);
  if (hit) return res.json(hit);

  const name = (req.query.name || '').trim();
  const result = await dedupDetails(cacheKey, () =>
    Promise.allSettled([getGameRating(appid), getHLTB(name)]).then(([ratingRes, hltbRes]) => {
      if (ratingRes.status === 'rejected') console.warn('[game-details] rating:', ratingRes.reason?.message);
      if (hltbRes.status  === 'rejected') console.warn('[game-details] hltb:',   hltbRes.reason?.message);
      const r = {
        rating: ratingRes.status === 'fulfilled' ? ratingRes.value : null,
        hltb: hltbRes.status === 'fulfilled' ? hltbRes.value : null,
      };
      setCache(cacheKey, r, DETAILS_CACHE_TTL_MS);
      return r;
    })
  );
  res.json(result);
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\nSteam Common Games → http://${HOST}:${PORT}\n`);
    if (!process.env.STEAM_API_KEY) {
      console.warn('  ⚠  STEAM_API_KEY is not set!');
      console.warn('  Get your key: https://steamcommunity.com/dev/apikey');
      console.warn('  Then run: STEAM_API_KEY=yourkey node server.js\n');
    }
  });
}

module.exports = { app };
