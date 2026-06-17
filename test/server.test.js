'use strict';

// Set env before requiring the app so module-level reads see test values.
process.env.STEAM_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset, setCache } = require('../lib/cache');
const { _resetAuth } = require('../lib/hltb');

const api = supertest(app);

// Fixed Steam64 IDs that bypass the vanity-URL resolve step.
const ID1 = '76561198000000001';
const ID2 = '76561198000000002';

function makeLibraryFetch(games1 = [], games2 = []) {
  return async (url) => {
    if (url.includes('GetOwnedGames') && url.includes(ID1)) {
      return { ok: true, json: async () => ({ response: { games: games1 } }) };
    }
    if (url.includes('GetOwnedGames') && url.includes(ID2)) {
      return { ok: true, json: async () => ({ response: { games: games2 } }) };
    }
    if (url.includes('GetPlayerSummaries')) {
      const players = [ID1, ID2].map(id => ({ steamid: id, personaname: id, profileurl: '' }));
      return { ok: true, json: async () => ({ response: { players } }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function makeDetailsFetch({ ratingOk = true, metaOk = true } = {}) {
  return async (url) => {
    if (url.includes('appreviews')) {
      if (!ratingOk) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('appdetails')) {
      if (!metaOk) return { ok: false, status: 429 };
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { genres: [{ id: '1', description: 'Action' }], categories: [{ id: '9', description: 'Co-op' }], developers: ['Valve'], publishers: ['Valve'] } } }) };
    }
    if (url.includes('bleed/init')) {
      return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    }
    if (url.includes('bleed')) {
      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

// ── GET /api/health ───────────────────────────────────────────────────────────

test('GET /api/health: 200 with ok=true, configured=true, and cache stats', async () => {
  const res = await api.get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.configured, true);
  assert.equal(typeof res.body.cache?.entries, 'number');
});

test('GET /api/health: configured=false when STEAM_API_KEY is absent', async (t) => {
  const saved = process.env.STEAM_API_KEY;
  delete process.env.STEAM_API_KEY;
  t.after(() => { process.env.STEAM_API_KEY = saved; });

  const res = await api.get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, false);
});

// ── POST /api/common-games — input validation ─────────────────────────────────

test('POST /api/common-games: 400 when body has no slots field', async () => {
  const res = await api.post('/api/common-games').send({});
  assert.equal(res.status, 400);
});

test('POST /api/common-games: 400 when only one slot is provided', async () => {
  const res = await api.post('/api/common-games').send({ slots: [[ID1]] });
  assert.equal(res.status, 400);
});

test('POST /api/common-games: 400 when a slot is an empty array', async () => {
  const res = await api.post('/api/common-games').send({ slots: [[], [ID1]] });
  assert.equal(res.status, 400);
});

test('POST /api/common-games: 400 when a slot value is null', async () => {
  const res = await api.post('/api/common-games').send({ slots: [[null], [ID1]] });
  assert.equal(res.status, 400);
});

test('POST /api/common-games: 400 when a slot value is an empty string', async () => {
  const res = await api.post('/api/common-games').send({ slots: [[''], [ID1]] });
  assert.equal(res.status, 400);
});

test('POST /api/common-games: 400 when total users exceeds MAX_USERS', async () => {
  // Default MAX_USERS is 10; send 11 slots of 1 user each.
  const slots = Array.from({ length: 11 }, (_, i) => [`7656119800000000${i}`]);
  const res = await api.post('/api/common-games').send({ slots });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Too many users/);
});

test('POST /api/common-games: 503 when STEAM_API_KEY is absent', async (t) => {
  const saved = process.env.STEAM_API_KEY;
  delete process.env.STEAM_API_KEY;
  t.after(() => { process.env.STEAM_API_KEY = saved; });

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 503);
});

// ── POST /api/common-games — happy path ──────────────────────────────────────

test('POST /api/common-games: 200 with groups and slots', async (t) => {
  _reset();
  const GAME = { appid: 400, name: 'Portal' };
  t.mock.method(globalThis, 'fetch', makeLibraryFetch([GAME], [GAME]));

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.groups));
  assert.ok(Array.isArray(res.body.slots));
  assert.equal(res.body.groups[0].games[0].appid, 400);
  assert.equal(res.body.slots.length, 2);
});

test('POST /api/common-games: 200 accepts legacy users array', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeLibraryFetch([], []));

  const res = await api.post('/api/common-games').send({ users: [ID1, ID2] });
  assert.equal(res.status, 200);
});

test('POST /api/common-games: groups contains only games shared by both players', async (t) => {
  _reset();
  const SHARED = { appid: 400, name: 'Portal' };
  const SOLO   = { appid: 440, name: 'TF2' };
  t.mock.method(globalThis, 'fetch', makeLibraryFetch([SHARED, SOLO], [SHARED]));

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].games.length, 1);
  assert.equal(res.body.groups[0].games[0].appid, 400);
});

// ── POST /api/common-games — upstream / user errors ──────────────────────────

test('POST /api/common-games: 502 when Steam API returns a server error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 502);
});

test('POST /api/common-games: 400 when a library is private', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('GetPlayerSummaries')) {
      return { ok: true, json: async () => ({ response: { players: [] } }) };
    }
    // No `games` field → steam.js throws the private-library error
    return { ok: true, json: async () => ({ response: {} }) };
  });

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /private/);
});

// ── GET /api/game-details/:appid — input validation ──────────────────────────

test('GET /api/game-details/abc: 400 for non-numeric appid', async () => {
  const res = await api.get('/api/game-details/abc');
  assert.equal(res.status, 400);
});

test('GET /api/game-details/0: 400 for zero appid', async () => {
  const res = await api.get('/api/game-details/0');
  assert.equal(res.status, 400);
});

test('GET /api/game-details/-1: 400 for negative appid', async () => {
  const res = await api.get('/api/game-details/-1');
  assert.equal(res.status, 400);
});

// ── GET /api/game-details/:appid — happy path ────────────────────────────────

test('GET /api/game-details/:appid: 200 from cache without fetching', async (t) => {
  _reset();
  const rating = { score: 88, desc: 'Very Positive', positive: 900, total: 1000 };
  const hltb   = { main: 10, extra: 15 };
  const meta   = { genres: ['Action'], categories: ['Co-op'], developers: ['Valve'], publishers: ['Valve'] };
  setCache('rating:400', rating);
  setCache('hltb:400', hltb);
  setCache('meta:400', meta);

  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });

  const res = await api.get('/api/game-details/400');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { rating, hltb, meta });
  assert.equal(fetchCalled, false);
});

test('GET /api/game-details/:appid: 200 fetching fresh rating, HLTB and meta', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch());

  const res = await api.get('/api/game-details/401?name=Portal');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.rating?.score, 'number');
  assert.equal(res.body.hltb?.main, 10);
  assert.deepEqual(res.body.meta?.genres, ['Action']);
  assert.deepEqual(res.body.meta?.categories, ['Co-op']);
});

test('GET /api/game-details/:appid: 200 with null rating when reviews fetch fails', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch({ ratingOk: false }));

  const res = await api.get('/api/game-details/402?name=Portal');
  assert.equal(res.status, 200);
  assert.equal(res.body.rating, null);
  assert.equal(res.body.hltb?.main, 10);
  assert.ok(res.body.meta !== undefined, 'meta should still be present');
});

test('GET /api/game-details/:appid: 200 with null meta when appdetails fetch fails', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch({ metaOk: false }));

  const res = await api.get('/api/game-details/403?name=Portal');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.rating?.score, 'number');
  assert.equal(res.body.meta, null);
});

test('GET /api/game-details/:appid: only fetches sources not already cached', async (t) => {
  _reset();
  _resetAuth();
  const rating = { score: 88, desc: 'Very Positive', positive: 900, total: 1000 };
  const meta   = { genres: ['Action'], categories: ['Co-op'], developers: ['Valve'], publishers: ['Valve'] };
  setCache('rating:405', rating);
  setCache('meta:405', meta);

  let fetchedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('bleed/init')) return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('bleed'))      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.get('/api/game-details/405?name=Portal');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rating, rating);
  assert.deepEqual(res.body.meta, meta);
  assert.equal(res.body.hltb?.main, 10);
  assert.ok(!fetchedUrls.some(u => u.includes('appreviews')), 'rating should not be re-fetched');
  assert.ok(!fetchedUrls.some(u => u.includes('appdetails')), 'meta should not be re-fetched');
});

test('GET /api/game-details/:appid: failed fetch is not cached, retried on next request', async (t) => {
  _reset();
  _resetAuth();
  let hltbCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appreviews')) return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    if (url.includes('appdetails')) {
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('bleed/init')) return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('bleed')) { hltbCalls++; return { ok: false, status: 503 }; }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res1 = await api.get('/api/game-details/406?name=Portal');
  assert.equal(res1.status, 200);
  assert.equal(res1.body.hltb, null);

  const res2 = await api.get('/api/game-details/406?name=Portal');
  assert.equal(res2.status, 200);
  assert.equal(hltbCalls, 2, 'HLTB should be retried — failed fetch must not be cached');
});
