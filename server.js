'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { getCached, setCache, setMaxAge } = require('./lib/cache');
const { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating } = require('./lib/steam');
const { getHLTB } = require('./lib/hltb');
const { groupByOwnership } = require('./lib/groupGames');

const STEAM_KEY = process.env.STEAM_API_KEY;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;
const DETAILS_CACHE_TTL_MS = Number(process.env.DETAILS_CACHE_TTL_MINUTES || 10080) * 60 * 1000;
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const TRUST_PROXY = process.env.TRUST_PROXY;

setMaxAge(DETAILS_CACHE_TTL_MS);

const app = express();
if (TRUST_PROXY !== undefined) app.set('trust proxy', TRUST_PROXY);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stricter limit for searches — each uncached user triggers Steam API calls
const searchLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please wait a minute and try again.' },
});

// Generous limit for details — responses are almost always served from cache
const detailsLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: !!STEAM_KEY });
});

app.post('/api/common-games', searchLimit, async (req, res) => {
  if (!STEAM_KEY) {
    return res.status(503).json({
      error: 'STEAM_API_KEY is not configured. Restart: STEAM_API_KEY=yourkey node server.js',
    });
  }

  const { users } = req.body;
  if (!Array.isArray(users) || users.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 Steam users' });
  }
  if (users.length > MAX_USERS) {
    return res.status(400).json({ error: `Too many users — maximum is ${MAX_USERS}` });
  }

  try {
    const steamIds = [...new Set(await Promise.all(users.map(resolveSteamId)))];
    if (steamIds.length < 2) {
      return res.status(400).json({ error: 'All provided users resolve to the same Steam account' });
    }
    const [libraries, players] = await Promise.all([
      Promise.all(steamIds.map(getOwnedGames)),
      getPlayerSummaries(steamIds),
    ]);

    const groups = groupByOwnership(libraries);

    res.json({ groups, players });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/game-details/:appid', detailsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }

  const hit = getCached(`details:${appid}`, DETAILS_CACHE_TTL_MS);
  if (hit) return res.json(hit);

  const name = (req.query.name || '').trim();
  const [ratingRes, hltbRes] = await Promise.allSettled([
    getGameRating(appid),
    getHLTB(name),
  ]);

  const result = {
    rating: ratingRes.status === 'fulfilled' ? ratingRes.value : null,
    hltb: hltbRes.status === 'fulfilled' ? hltbRes.value : null,
  };
  setCache(`details:${appid}`, result);
  res.json(result);
});

app.listen(PORT, HOST, () => {
  console.log(`\nSteam Common Games → http://${HOST}:${PORT}\n`);
  if (!STEAM_KEY) {
    console.warn('  ⚠  STEAM_API_KEY is not set!');
    console.warn('  Get your key: https://steamcommunity.com/dev/apikey');
    console.warn('  Then run: STEAM_API_KEY=yourkey node server.js\n');
  }
});
