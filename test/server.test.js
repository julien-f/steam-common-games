'use strict';

// Set env before requiring the app so module-level reads see test values.
process.env.STEAM_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
// Force the in-memory DB regardless of how this file is invoked — `npm test`
// already does this via a shell-level `DB_FILE=`, but running this file
// directly (e.g. `node --test test/server.test.js`, an IDE test runner) would
// otherwise fall through to default.env's DB_FILE=db.sqlite and let _reset()
// wipe the real cache.
process.env.DB_FILE = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

// Fixture tag ids/names shared across tests — Steam tags are now fetched as an
// (appid → tagids) call plus a separate, shared (tagid → name) map.
const TAG_IDS = [1001, 1002];
const TAG_NAME_MAP = { 1001: 'Action', 1002: 'Co-op' };
// The demo link (getGameDemo) rides on the exact same IStoreBrowseService item as the
// tagids above — see the `tagsOk` flag below, which gates both.
const DEMO_APPID = 999900;

function makeDetailsFetch({ ratingOk = true, metaOk = true, tagsOk = true } = {}) {
  return async (url) => {
    if (url.includes('appreviews')) {
      if (!ratingOk) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('IStoreBrowseService')) {
      if (!tagsOk) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, tagids: TAG_IDS, related_items: { demo_appid: [DEMO_APPID] } }] } }) };
    }
    if (url.includes('ajaxgetstoretags')) {
      if (!tagsOk) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ tags: Object.entries(TAG_NAME_MAP).map(([tagid, name]) => ({ tagid: Number(tagid), name })) }) };
    }
    if (url.includes('appdetails')) {
      if (!metaOk) return { ok: false, status: 503 };
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { name: 'Portal', genres: [{ id: '1', description: 'Action' }], categories: [{ id: '9', description: 'Co-op' }], developers: ['Valve'], publishers: ['Valve'] } } }) };
    }
    if (url.includes('protondb.com')) {
      return { ok: true, json: async () => ({ tier: 'gold', confidence: 'strong', total: 500 }) };
    }
    if (url.includes('GetNewsForApp')) {
      return { ok: true, json: async () => ({ appnews: { newsitems: [
        { title: 'Patch 1.2 released', url: 'https://store.steampowered.com/news/app/1/view/123', date: 1700000000, feedlabel: 'Community Announcements', feedname: 'steam_community_announcements' },
      ] } }) };
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

test('POST /api/common-games: 200 with full library when only one slot is provided', async (t) => {
  _reset();
  const GAME = { appid: 400, name: 'Portal' };
  t.mock.method(globalThis, 'fetch', makeLibraryFetch([GAME], []));

  const res = await api.post('/api/common-games').send({ slots: [[ID1]] });
  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].games[0].appid, 400);
  assert.equal(res.body.slots.length, 1);
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
  assert.equal(res.body.slots[0][0].gameCount, 1, 'gameCount reflects that account\'s own library size');
});

test('POST /api/common-games: lastPlayed carries rtime_last_played per account, 0 when absent', async (t) => {
  _reset();
  const GAME1 = { appid: 400, name: 'Portal', rtime_last_played: 1751846400 };
  const GAME2 = { appid: 400, name: 'Portal' }; // no rtime_last_played from this account
  t.mock.method(globalThis, 'fetch', makeLibraryFetch([GAME1], [GAME2]));

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] });
  assert.equal(res.status, 200);
  assert.equal(res.body.lastPlayed[400][ID1], 1751846400);
  assert.equal(res.body.lastPlayed[400][ID2], 0);
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

test('POST /api/common-games: refreshIds re-fetches only the listed account, not the whole slot', async (t) => {
  _reset();
  let gamesFetchCount1 = 0, gamesFetchCount2 = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('GetOwnedGames') && url.includes(ID1)) {
      gamesFetchCount1++;
      return { ok: true, json: async () => ({ response: { games: [{ appid: 400, name: 'Portal' }] } }) };
    }
    if (url.includes('GetOwnedGames') && url.includes(ID2)) {
      gamesFetchCount2++;
      return { ok: true, json: async () => ({ response: { games: [{ appid: 400, name: 'Portal' }] } }) };
    }
    if (url.includes('GetPlayerSummaries')) {
      const players = [ID1, ID2].map(id => ({ steamid: id, personaname: id, profileurl: '' }));
      return { ok: true, json: async () => ({ response: { players } }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  await api.post('/api/common-games').send({ slots: [[ID1], [ID2]] }); // primes the cache
  assert.equal(gamesFetchCount1, 1);
  assert.equal(gamesFetchCount2, 1);

  const res = await api.post('/api/common-games').send({ slots: [[ID1], [ID2]], refreshIds: [ID2] });
  assert.equal(res.status, 200);
  assert.equal(gamesFetchCount1, 1, 'ID1 was not in refreshIds — served from cache');
  assert.equal(gamesFetchCount2, 2, 'ID2 was in refreshIds — re-fetched');
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

// ── POST /api/wishlist — input validation ─────────────────────────────────────

test('POST /api/wishlist: 400 when body has no members field', async () => {
  const res = await api.post('/api/wishlist').send({});
  assert.equal(res.status, 400);
});

test('POST /api/wishlist: 400 when members is an empty array', async () => {
  const res = await api.post('/api/wishlist').send({ members: [] });
  assert.equal(res.status, 400);
});

test('POST /api/wishlist: 400 when a member value is an empty string', async () => {
  const res = await api.post('/api/wishlist').send({ members: [''] });
  assert.equal(res.status, 400);
});

test('POST /api/wishlist: 400 when members exceeds MAX_USERS', async () => {
  // Default MAX_USERS is 10.
  const members = Array.from({ length: 11 }, (_, i) => `7656119800000000${i}`);
  const res = await api.post('/api/wishlist').send({ members });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Too many users/);
});

// ── POST /api/wishlist — happy path ───────────────────────────────────────────

function makeWishlistFetch(items1 = [], items2 = []) {
  return async (url) => {
    if (url.includes('GetWishlist') && url.includes(ID1)) {
      return { ok: true, json: async () => ({ response: { items: items1 } }) };
    }
    if (url.includes('GetWishlist') && url.includes(ID2)) {
      return { ok: true, json: async () => ({ response: { items: items2 } }) };
    }
    if (url.includes('GetPlayerSummaries')) {
      const players = [ID1, ID2].map(id => ({ steamid: id, personaname: id, profileurl: '' }));
      return { ok: true, json: async () => ({ response: { players } }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test('POST /api/wishlist: 200 with items for a single account', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeWishlistFetch([{ appid: 400, priority: 1, date_added: 1433965886 }]));

  const res = await api.post('/api/wishlist').send({ members: [ID1] });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].appid, 400);
  assert.equal(res.body.items[0].priority, 1);
  assert.equal(res.body.items[0].dateAdded, '2015-06-10');
  assert.equal(res.body.players.length, 1);
  assert.equal(res.body.players[0].itemCount, 1);
});

test('POST /api/wishlist: unions two accounts, dedupes shared appid keeping first-seen', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeWishlistFetch(
    [{ appid: 400, priority: 1, date_added: 1433965886 }],
    [{ appid: 400, priority: 5, date_added: 1500000000 }, { appid: 440, priority: 2, date_added: 1500000000 }],
  ));

  const res = await api.post('/api/wishlist').send({ members: [ID1, ID2] });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 2);
  const shared = res.body.items.find(i => i.appid === 400);
  assert.equal(shared.priority, 1, 'first-seen account wins for a shared appid');
  assert.ok(res.body.items.some(i => i.appid === 440));
});

test('POST /api/wishlist: an account with no items field contributes nothing', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('GetPlayerSummaries')) return { ok: true, json: async () => ({ response: { players: [] } }) };
    if (url.includes(ID1)) return { ok: true, json: async () => ({ response: {} }) }; // private/empty
    if (url.includes(ID2)) return { ok: true, json: async () => ({ response: { items: [{ appid: 400, priority: 1, date_added: 1433965886 }] } }) };
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.post('/api/wishlist').send({ members: [ID1, ID2] });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].appid, 400);
});

test('POST /api/wishlist: 502 when Steam API returns a server error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  const res = await api.post('/api/wishlist').send({ members: [ID1] });
  assert.equal(res.status, 502);
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
  setCache('rating:400',   { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' });
  setCache('hltb:400',     [{ game_id: 42, game_name: 'Portal', comp_main: 36000, comp_plus: 54000 }]);
  setCache('meta:400',     { name: 'Portal', genres: [{ id: '1', description: 'Action' }], categories: [{ id: '9', description: 'Co-op' }], developers: ['Valve'], publishers: ['Valve'] });
  setCache('browse:400',   { tagids: TAG_IDS, related_items: { demo_appid: [1714800] } });
  setCache('tagnames:all', TAG_NAME_MAP);
  setCache('protondb:400', { tier: 'gold', confidence: 'strong', total: 500 });

  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });

  const res = await api.get('/api/game-details/400');
  assert.equal(res.status, 200);
  assert.equal(res.body.rating?.total, 1000);
  assert.equal(res.body.rating?.desc, 'Very Positive');
  assert.equal(res.body.hltb?.main, 10);
  assert.deepEqual(res.body.meta?.genres, ['Action']);
  assert.deepEqual(res.body.tags, ['Action', 'Co-op']);
  assert.equal(res.body.demo, 1714800);
  assert.equal(res.body.protondb?.tier, 'gold');
  assert.equal(fetchCalled, false);
});

test('GET /api/game-details/:appid: 200 fetching fresh rating, HLTB, meta and tags', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch());

  const res = await api.get('/api/game-details/401');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.rating?.score, 'number');
  assert.equal(res.body.hltb?.main, 10);
  assert.deepEqual(res.body.meta?.genres, ['Action']);
  assert.deepEqual(res.body.meta?.categories, ['Co-op']);
  assert.ok(Array.isArray(res.body.tags), 'tags should be an array');
  assert.ok(res.body.tags.includes('Action'));
  assert.equal(res.body.demo, DEMO_APPID);
});

// ── GET /api/game-news/:appid ─────────────────────────────────────────────────
// Deliberately its own endpoint, not part of /api/game-details — see newsLimit's
// comment in server.js for why (no table column, so fetched on-demand per panel open
// rather than for every game in a whole loaded library/comparison).

test('GET /api/game-news/abc: 400 for non-numeric appid', async () => {
  const res = await api.get('/api/game-news/abc');
  assert.equal(res.status, 400);
});

test('GET /api/game-news/:appid: 200 with recent news items', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch());

  const res = await api.get('/api/game-news/407');
  assert.equal(res.status, 200);
  assert.equal(res.body.news.length, 1);
  assert.equal(res.body.news[0].title, 'Patch 1.2 released');
  assert.equal(res.body.news[0].feedLabel, 'Community Announcements');
});

test('GET /api/game-news/:appid: 200 from cache without fetching', async (t) => {
  _reset();
  setCache('news:408', []);
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });

  const res = await api.get('/api/game-news/408');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.news, []);
  assert.equal(fetchCalled, false);
});

test('GET /api/game-details/:appid: 200 with null rating when reviews fetch fails', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch({ ratingOk: false }));

  const res = await api.get('/api/game-details/402');
  assert.equal(res.status, 200);
  assert.equal(res.body.rating, null);
  assert.equal(res.body.hltb?.main, 10);
  assert.ok(res.body.meta !== undefined, 'meta should still be present');
});

test('GET /api/game-details/:appid: 200 with null meta when appdetails fetch fails', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch({ metaOk: false }));

  const res = await api.get('/api/game-details/403');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.rating?.score, 'number');
  assert.equal(res.body.meta, null);
});

test('GET /api/game-details/:appid: 200 with null tags and null demo when the Steam store browse fetch fails (same call backs both)', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch({ tagsOk: false }));

  const res = await api.get('/api/game-details/404');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.rating?.score, 'number');
  assert.ok(res.body.meta !== undefined, 'meta should still be present');
  assert.equal(res.body.tags, null);
  assert.equal(res.body.demo, null);
});

test('GET /api/game-details/:appid: only fetches sources not already cached', async (t) => {
  _reset();
  _resetAuth();
  setCache('rating:405', { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' });
  setCache('meta:405',   { name: 'Portal', genres: [{ id: '1', description: 'Action' }], categories: [{ id: '9', description: 'Co-op' }], developers: ['Valve'], publishers: ['Valve'] });

  let fetchedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('IStoreBrowseService')) return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, tagids: TAG_IDS }] } }) };
    if (url.includes('ajaxgetstoretags'))    return { ok: true, json: async () => ({ tags: Object.entries(TAG_NAME_MAP).map(([tagid, name]) => ({ tagid: Number(tagid), name })) }) };
    if (url.includes('bleed/init'))   return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('bleed'))        return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.get('/api/game-details/405');
  assert.equal(res.status, 200);
  assert.equal(res.body.rating?.total, 1000);
  assert.deepEqual(res.body.meta?.genres, ['Action']);
  assert.equal(res.body.hltb?.main, 10);
  assert.ok(Array.isArray(res.body.tags));
  assert.ok(!fetchedUrls.some(u => u.includes('appreviews')), 'rating should not be re-fetched');
  assert.ok(!fetchedUrls.some(u => u.includes('steampowered.com') && u.includes('appdetails')), 'meta should not be re-fetched');
});

// ── GET /api/game-details/:appid — "fast refresh" cache / dedup ──────────────
// A browser refresh fires the same /api/game-details/:appid requests again.
// These tests verify the server does NOT re-fetch upstream when it shouldn't.

// fetch mock that tallies how many times each upstream source is hit.
function makeCountingDetailsFetch(counts, { delayMs = 0 } = {}) {
  return async (url) => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    if (url.includes('appreviews')) {
      counts.rating++;
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('IStoreBrowseService')) {
      counts.tags++;
      return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, tagids: TAG_IDS }] } }) };
    }
    if (url.includes('ajaxgetstoretags')) {
      counts.tags++;
      return { ok: true, json: async () => ({ tags: Object.entries(TAG_NAME_MAP).map(([tagid, name]) => ({ tagid: Number(tagid), name })) }) };
    }
    if (url.includes('appdetails')) {
      counts.meta++;
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { name: 'Portal', genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('bleed/init')) {
      counts.hltbInit++;
      return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    }
    if (url.includes('bleed')) {
      counts.hltb++;
      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

// #1 — sequential refresh: second request must be served entirely from cache.
test('GET /api/game-details/:appid: a repeated request is served from cache, no re-fetch', async (t) => {
  _reset();
  _resetAuth();
  const counts = { rating: 0, hltb: 0, hltbInit: 0, meta: 0, tags: 0 };
  t.mock.method(globalThis, 'fetch', makeCountingDetailsFetch(counts));

  const res1 = await api.get('/api/game-details/500');
  assert.equal(res1.status, 200);
  assert.equal(counts.rating, 1);
  assert.equal(counts.hltb, 1);
  assert.equal(counts.meta, 1);
  assert.equal(counts.tags, 2, 'tags fetch = one IStoreBrowseService call + one ajaxgetstoretags call');

  // Simulates the page being refreshed: same appid requested again.
  const res2 = await api.get('/api/game-details/500');
  assert.equal(res2.status, 200);
  assert.deepEqual(res2.body, res1.body);
  assert.equal(counts.rating, 1, 'rating must not be re-fetched on refresh');
  assert.equal(counts.hltb, 1, 'HLTB must not be re-fetched on refresh');
  assert.equal(counts.meta, 1, 'meta must not be re-fetched on refresh');
  assert.equal(counts.tags, 2, 'tags must not be re-fetched on refresh');
});

// #2 — concurrent refresh: overlapping in-flight requests for the same appid
// must collapse onto a single upstream fetch via dedup.
test('GET /api/game-details/:appid: concurrent requests for the same appid dedup to one fetch', async (t) => {
  _reset();
  _resetAuth();
  const counts = { rating: 0, hltb: 0, hltbInit: 0, meta: 0, tags: 0 };
  t.mock.method(globalThis, 'fetch', makeCountingDetailsFetch(counts, { delayMs: 50 }));

  // Fire both without awaiting the first — they overlap in flight.
  const [res1, res2] = await Promise.all([
    api.get('/api/game-details/501'),
    api.get('/api/game-details/501'),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.deepEqual(res1.body, res2.body);
  assert.equal(counts.rating, 1, 'rating fetched once for two concurrent requests');
  assert.equal(counts.hltb, 1, 'HLTB fetched once for two concurrent requests');
  assert.equal(counts.meta, 1, 'meta fetched once for two concurrent requests');
  assert.equal(counts.tags, 2, 'tags fetched once for two concurrent requests (one browse + one name-map call)');
});

// #3 — real browser-abort on fast refresh. supertest awaits the full response,
// so this uses a raw http request destroyed mid-flight against app.listen().
// Question: when the client disconnects before setCache runs, does the server
// still complete the upstream work and cache it (so the refresh is a cache hit),
// or is the work stranded (forcing the refresh to re-fetch)?
function abortedGet(port, path, abortAfterMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => res.resume());
    req.on('error', () => {}); // destroy() surfaces ECONNRESET — expected, ignore
    setTimeout(() => { req.destroy(); resolve(); }, abortAfterMs);
  });
}

test('GET /api/game-details/:appid: a request aborted mid-flight still caches, so refresh does not re-fetch', async (t) => {
  _reset();
  _resetAuth();
  const counts = { rating: 0, hltb: 0, hltbInit: 0, meta: 0, tags: 0 };
  t.mock.method(globalThis, 'fetch', makeCountingDetailsFetch(counts, { delayMs: 100 }));

  const server = app.listen(0);
  t.after(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  // Fire and kill the socket after 20ms — the handler has started upstream
  // fetches (~100ms each) but no response has been sent yet.
  await abortedGet(port, '/api/game-details/600', 20);

  // Give the stranded handler time to finish its upstream work and setCache. HLTB now
  // waits on meta before searching (see fetchGameDetails — it always resolves the search
  // name from store metadata rather than trusting a client-supplied one), so that chain is
  // meta → bleed/init → bleed, three sequential ~100ms hops instead of running in parallel
  // with meta — comfortably under this budget but no longer as slack as it used to be.
  await new Promise(r => setTimeout(r, 500));

  // The refresh: same appid requested again.
  const res = await api.get('/api/game-details/600');
  assert.equal(res.status, 200);
  assert.equal(counts.rating, 1, 'aborted request should have completed and cached the rating — refresh must not re-fetch');
  assert.equal(counts.hltb, 1, 'aborted request should have completed and cached HLTB');
  assert.equal(counts.meta, 1, 'aborted request should have completed and cached meta');
  assert.equal(counts.tags, 2, 'aborted request should have completed and cached tags');
});

test('GET /api/game-details/:appid: failed fetch is not cached, retried on next request', async (t) => {
  _reset();
  _resetAuth();
  let hltbCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appreviews')) return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    if (url.includes('appdetails')) {
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { name: 'Portal', genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('bleed/init')) return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('bleed')) { hltbCalls++; return { ok: false, status: 503 }; }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res1 = await api.get('/api/game-details/406');
  assert.equal(res1.status, 200);
  assert.equal(res1.body.hltb, null);

  const res2 = await api.get('/api/game-details/406');
  assert.equal(res2.status, 200);
  assert.equal(hltbCalls, 2, 'HLTB should be retried — failed fetch must not be cached');
});

// ── POST /api/game-details/stream ────────────────────────────────────────────

function parseSseEvents(body) {
  return body.split('\n\n').filter(c => c.startsWith('data: ')).map(c => JSON.parse(c.slice(6)));
}

function ssePost(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

test('POST /api/game-details/stream: 400 for empty games list', async () => {
  const res = await api.post('/api/game-details/stream').send({ games: [] });
  assert.equal(res.status, 400);
});

test('POST /api/game-details/stream: 400 for invalid appid in list', async () => {
  const res = await api.post('/api/game-details/stream').send({ games: [{ appid: 'abc' }] });
  assert.equal(res.status, 400);
});

test('POST /api/game-details/stream: 400 when games list exceeds STREAM_MAX_GAMES', async () => {
  const max = Number(process.env.STREAM_MAX_GAMES);
  const games = Array.from({ length: max + 1 }, (_, i) => ({ appid: i + 1 }));
  const res = await api.post('/api/game-details/stream').send({ games });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Too many games/);
});

test('POST /api/game-details/stream: streams one event per game plus a done event from cache', async (t) => {
  _reset();
  const rawRating = { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' };
  const rawHltb   = [{ game_id: 42, game_name: 'Portal', comp_main: 36000, comp_plus: 54000 }];
  const rawMeta   = { name: 'Portal', genres: [{ id: '1', description: 'Action' }], categories: [{ id: '9', description: 'Co-op' }], developers: ['Valve'], publishers: ['Valve'] };
  const rawProtonDb = { tier: 'gold', confidence: 'strong', total: 500 };
  setCache('rating:400',   rawRating);
  setCache('hltb:400',     rawHltb);
  setCache('meta:400',     rawMeta);
  setCache('browse:400',   { tagids: TAG_IDS });
  setCache('protondb:400', rawProtonDb);
  setCache('rating:401',   rawRating);
  setCache('hltb:401',     rawHltb);
  setCache('meta:401',     rawMeta);
  setCache('browse:401',   { tagids: TAG_IDS });
  setCache('protondb:401', rawProtonDb);
  setCache('tagnames:all', TAG_NAME_MAP);

  const server = app.listen(0);
  t.after(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));

  const res = await ssePost(server.address().port, '/api/game-details/stream',
    { games: [{ appid: 400 }, { appid: 401 }] });

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  const events = parseSseEvents(res.body);
  const gameEvents = events.filter(e => !e.done);
  const doneEvent  = events.find(e => e.done);
  assert.equal(gameEvents.length, 2);
  assert.ok(gameEvents.some(e => e.appid === 400));
  assert.ok(gameEvents.some(e => e.appid === 401));
  assert.ok(doneEvent, 'must end with a done event');
});

test('POST /api/game-details/stream: fetches fresh details and streams them', async (t) => {
  _reset();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', makeDetailsFetch());

  const server = app.listen(0);
  t.after(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));

  const res = await ssePost(server.address().port, '/api/game-details/stream',
    { games: [{ appid: 700 }] });

  assert.equal(res.status, 200);
  const events = parseSseEvents(res.body);
  const gameEvent = events.find(e => e.appid === 700);
  assert.ok(gameEvent, 'must emit an event for the requested appid');
  assert.equal(typeof gameEvent.rating?.score, 'number');
  assert.equal(gameEvent.hltb?.main, 10);
  assert.deepEqual(gameEvent.meta?.genres, ['Action']);
});

// The client never sends a name (see fetchGameDetails in server.js — the server always
// resolves it from store metadata itself, keyed on the appid, rather than trusting one from
// the client). This must still work for wishlist rows, which have no name of their own to
// begin with (GetWishlist returns only appid/priority/date_added) — getHLTB would otherwise
// short-circuit to null immediately on an empty name (`if (!name) return null`).
test('POST /api/game-details/stream: resolves HLTB name from store metadata', async (t) => {
  _reset();
  _resetAuth();
  let hltbSearchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appreviews')) {
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('IStoreBrowseService')) {
      return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, tagids: TAG_IDS }] } }) };
    }
    if (url.includes('ajaxgetstoretags')) {
      return { ok: true, json: async () => ({ tags: Object.entries(TAG_NAME_MAP).map(([tagid, name]) => ({ tagid: Number(tagid), name })) }) };
    }
    if (url.includes('appdetails')) {
      const appid = url.match(/appids=(\d+)/)?.[1];
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { name: 'Portal', genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('protondb.com')) {
      return { ok: true, json: async () => ({ tier: 'gold', confidence: 'strong', total: 500 }) };
    }
    if (url.includes('bleed/init')) {
      return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    }
    if (url.includes('bleed')) {
      hltbSearchCalls++;
      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 54000 }] }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const server = app.listen(0);
  t.after(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));

  const res = await ssePost(server.address().port, '/api/game-details/stream',
    { games: [{ appid: 701 }] });

  assert.equal(res.status, 200);
  const events = parseSseEvents(res.body);
  const gameEvent = events.find(e => e.appid === 701);
  assert.ok(gameEvent, 'must emit an event for the requested appid');
  assert.equal(gameEvent.meta?.name, 'Portal');
  assert.equal(hltbSearchCalls, 1, 'HLTB should have been searched using the name resolved from store metadata');
  assert.equal(gameEvent.hltb?.main, 10, 'HLTB result should be present, not short-circuited to null');
});

// ── GET /api/search-games ─────────────────────────────────────────────────────

test('GET /api/search-games: empty results (no fetch) when q is missing', async (t) => {
  _reset();
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });
  const res = await api.get('/api/search-games');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { results: [] });
  assert.equal(fetchCalled, false);
});

test('GET /api/search-games: empty results (no fetch) when q is below the minimum length', async (t) => {
  _reset();
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });
  const res = await api.get('/api/search-games?q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { results: [] });
  assert.equal(fetchCalled, false);
});

test('GET /api/search-games: 200 with results shaped for the frontend dropdown', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(url, /storesearch/);
    return { ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal', tiny_image: 'https://example.com/400.jpg' }] }) };
  });
  const res = await api.get('/api/search-games?q=portal');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { results: [{ appid: 400, name: 'Portal', tinyImage: 'https://example.com/400.jpg' }] });
});

test('GET /api/search-games: a repeated query is served from cache, no re-fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));
  await api.get('/api/search-games?q=portal');
  await api.get('/api/search-games?q=portal');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('GET /api/search-games: 502 when the store search endpoint errors', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  const res = await api.get('/api/search-games?q=portal');
  assert.equal(res.status, 502);
});

// ── GET /api/achievements/:appid ─────────────────────────────────────────────

function makeAchievementsFetch({ achieved = [] } = {}) {
  return async (url) => {
    if (url.includes('GetSchemaForGame')) {
      return { ok: true, json: async () => ({ game: { availableGameStats: { achievements: [
        { name: 'ACH_1', displayName: 'First', description: 'Do the thing', icon: 'i1', icongray: 'g1', hidden: 0 },
        { name: 'ACH_2', displayName: 'Second', description: 'Do another thing', icon: 'i2', icongray: 'g2', hidden: 0 },
      ] } } }) };
    }
    if (url.includes('GetGlobalAchievementPercentagesForApp')) {
      return { ok: true, json: async () => ({ achievementpercentages: { achievements: [
        { name: 'ACH_1', percent: '42.0' }, { name: 'ACH_2', percent: '8.5' },
      ] } }) };
    }
    if (url.includes('GetPlayerAchievements')) {
      return { ok: true, json: async () => ({ playerstats: { success: true, achievements: [
        { apiname: 'ACH_1', achieved: achieved.includes('ACH_1') ? 1 : 0, unlocktime: achieved.includes('ACH_1') ? 1700000000 : 0 },
        { apiname: 'ACH_2', achieved: achieved.includes('ACH_2') ? 1 : 0, unlocktime: achieved.includes('ACH_2') ? 1700000001 : 0 },
      ] } }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test('GET /api/achievements/:appid: no steamids returns the achievement list with playerCount 0, no progress claimed', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeAchievementsFetch());

  const res = await api.get('/api/achievements/400');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.unlocked, 0);
  assert.equal(res.body.private, false);
  assert.equal(res.body.playerCount, 0);
  assert.equal(res.body.achievements[0].globalPct, 42);
  assert.equal(res.body.achievements.every(a => a.achieved === false), true);
});

test('GET /api/achievements/:appid: with steamids returns unlock progress and playerCount', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', makeAchievementsFetch({ achieved: ['ACH_1'] }));

  const res = await api.get(`/api/achievements/400?steamids=${ID1}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.playerCount, 1);
  assert.equal(res.body.unlocked, 1);
  assert.equal(res.body.private, false);
  const first = res.body.achievements.find(a => a.apiname === 'ACH_1');
  assert.equal(first.achieved, true);
  assert.equal(first.unlocktime, 1700000000);
});

test('GET /api/achievements/:appid: private/no-data account is distinguished from no steamids at all', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('GetSchemaForGame')) {
      return { ok: true, json: async () => ({ game: { availableGameStats: { achievements: [
        { name: 'ACH_1', displayName: 'First', description: '', icon: 'i1', icongray: 'g1', hidden: 0 },
      ] } } }) };
    }
    if (url.includes('GetGlobalAchievementPercentagesForApp')) return { ok: false, status: 403 };
    if (url.includes('GetPlayerAchievements')) return { ok: false, status: 403 }; // private profile
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.get(`/api/achievements/400?steamids=${ID1}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.playerCount, 1);
  assert.equal(res.body.private, true);
});

test('GET /api/achievements/:appid: short-circuits on appdetails-confirmed zero achievements — schema/rarity/player calls are never made', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appdetails')) {
      return { ok: true, json: async () => ({ '400': { success: true, data: { achievements: { total: 0, highlighted: [] } } } }) };
    }
    // Any of these firing would mean the short-circuit didn't work — fail loudly rather
    // than silently answering with fabricated achievement data.
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.get(`/api/achievements/400?steamids=${ID1}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { achievements: [], total: 0, unlocked: 0, private: false, playerCount: 1 });
});

test('GET /api/achievements/:appid: appdetails failure falls back to the schema fetch instead of erroring', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appdetails')) return { ok: false, status: 503 };
    return makeAchievementsFetch()(url);
  });

  const res = await api.get('/api/achievements/400');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
});

test('GET /api/achievements/:appid: schema-confirmed zero achievements skips rarity/per-player calls', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('appdetails')) {
      // achievementCount unknown (field absent) — forces the route to actually ask the schema.
      return { ok: true, json: async () => ({ '400': { success: true, data: {} } }) };
    }
    if (url.includes('GetSchemaForGame')) {
      return { ok: true, json: async () => ({ game: { availableGameStats: {} } }) }; // no achievements key
    }
    // Rarity/per-player firing here would mean the sequencing regressed back to batching
    // them alongside the schema fetch.
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await api.get(`/api/achievements/400?steamids=${ID1}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { achievements: [], total: 0, unlocked: 0, private: false, playerCount: 1 });
});

test('GET /api/achievements/:appid: too many steamids is a 400', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `7656119800000${String(i).padStart(4, '0')}`).join(',');
  const res = await api.get(`/api/achievements/400?steamids=${ids}`);
  assert.equal(res.status, 400);
});

test('GET /api/achievements/abc: 400 for non-numeric appid', async () => {
  const res = await api.get('/api/achievements/abc');
  assert.equal(res.status, 400);
});
