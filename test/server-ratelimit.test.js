'use strict';

// This file exercises the details rate limiter, so it opts INTO rate limiting
// (the main suite bypasses it) and sets a low max. Env must be read before the
// app is required, and node:test runs each file in its own process — so this
// configuration is isolated from the rest of the suite.
process.env.STEAM_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.DETAILS_RATE_LIMIT_MAX = '3';
process.env.GAME_SEARCH_RATE_LIMIT_MAX = '2';
process.env.ITAD_API_KEY = 'test-itad-key';
process.env.BUNDLES_RATE_LIMIT_MAX = '2';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset, setCache } = require('../lib/cache');
const { _resetAuth } = require('../lib/hltb');
const { _reset: _resetMetrics } = require('../lib/metrics');

const api = supertest(app);

function workingDetailsFetch(fetchedAppids) {
  return async (url) => {
    const appid = url.match(/appids=(\d+)/)?.[1] || url.match(/appreviews\/(\d+)/)?.[1] || url.match(/appid=(\d+)/)?.[1];
    if (appid) fetchedAppids.add(appid);
    if (url.includes('appreviews')) {
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('IStoreBrowseService')) {
      return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, tagids: [1001] }] } }) };
    }
    if (url.includes('ajaxgetstoretags')) {
      return { ok: true, json: async () => ({ tags: [{ tagid: 1001, name: 'Action' }] }) };
    }
    if (url.includes('appdetails')) {
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { name: 'Portal', genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('protondb.com')) {
      return { ok: true, json: async () => ({ tier: 'gold', confidence: 'strong', total: 500 }) };
    }
    if (url.includes('search/site/init')) return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('search/site'))      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

// Cache misses count against the budget; once exhausted, further misses 429.
// But a cache hit must always be served — it makes no upstream call, so the
// limiter skips it. This is the fix for "fast refresh 429s itself".
test('details limiter: counts cache misses but never counts cache hits', async (t) => {
  _reset();
  _resetAuth();
  const fetchedAppids = new Set();
  t.mock.method(globalThis, 'fetch', workingDetailsFetch(fetchedAppids));

  // Pre-cache appid 800 fully — this one should always be served.
  setCache('rating:800',   { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' });
  setCache('hltb:800',     [{ game_id: 42, game_name: 'Portal', comp_main: 36000, comp_plus: 54000 }]);
  setCache('meta:800',     { name: 'Portal', genres: [], categories: [], developers: [], publishers: [] });
  setCache('browse:800',   { tagids: [1001] });
  setCache('tagnames:all', { 1001: 'Action' });
  setCache('protondb:800', { tier: 'gold', confidence: 'strong', total: 500 });

  // Three uncached appids consume the budget (max = 3).
  for (const appid of [801, 802, 803]) {
    const res = await api.get(`/api/game-details/${appid}`);
    assert.equal(res.status, 200, `miss ${appid} should succeed within budget`);
  }

  // A fourth cache miss is over budget → 429.
  const over = await api.get('/api/game-details/804');
  assert.equal(over.status, 429, 'a cache miss past the budget should be rate limited');

  // The cached appid is still served even though the budget is exhausted,
  // and crucially does NOT trigger any upstream fetch.
  const cached = await api.get('/api/game-details/800');
  assert.equal(cached.status, 200, 'a cache hit must bypass the limiter');
  assert.equal(cached.body.rating.score, 88);
  assert.ok(!fetchedAppids.has('800'), 'cache hit must not fetch upstream');
});

// Same "cache hits never count" rule as above, applied to the game-search limiter.
test('game search limiter: counts cache misses but never counts cache hits', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));

  setCache('search:cached term', [{ appid: 900, name: 'Pre-cached', tinyImage: null }]);

  // Two uncached terms consume the budget (max = 2).
  for (const term of ['term one', 'term two']) {
    const res = await api.get(`/api/search-games?q=${encodeURIComponent(term)}`);
    assert.equal(res.status, 200, `miss "${term}" should succeed within budget`);
  }

  // A third cache miss is over budget → 429.
  const over = await api.get('/api/search-games?q=term three');
  assert.equal(over.status, 429, 'a cache miss past the budget should be rate limited');

  // The cached term is still served even though the budget is exhausted.
  const cached = await api.get('/api/search-games?q=cached term');
  assert.equal(cached.status, 200, 'a cache hit must bypass the limiter');
  assert.deepEqual(cached.body.results, [{ appid: 900, name: 'Pre-cached', tinyImage: null }]);
});

// Regression test for the bug reported live: reloading the Bundles page a handful of times (or
// re-opening the same deep-linked bundle) used to burn the whole per-minute budget on requests
// that never made an upstream call, since bundlesLimit's original skip() was just
// rateLimitBypassed() — every request counted, cache hit or not (unlike every other limiter in
// this file). GET /api/bundles/:id (bundlesByIdLimit) has no skip of its own — see its own
// comment in server.js — so it isn't covered here.
test('bundles list limiter: counts cache misses but never counts cache hits', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ id: 1, title: 'Bundle' }] }));

  setCache('itad-bundles:US:-publish:false:false:100:20', [{ id: 99, title: 'Pre-cached Page' }]);

  // Two uncached pages consume the budget (max = 2).
  for (const offset of [0, 20]) {
    const res = await api.get(`/api/bundles?offset=${offset}`);
    assert.equal(res.status, 200, `miss offset=${offset} should succeed within budget`);
  }

  const over = await api.get('/api/bundles?offset=40');
  assert.equal(over.status, 429, 'a cache miss past the budget should be rate limited');

  const cached = await api.get('/api/bundles?offset=100');
  assert.equal(cached.status, 200, 'a cache hit must bypass the limiter');
  assert.deepEqual(cached.body.bundles, [{ id: 99, title: 'Pre-cached Page' }]);
});

test('bundles resolve limiter: counts cache misses but never counts fully-cached gid batches', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/service/shops/')) return { ok: true, json: async () => [{ id: 61, title: 'Steam' }] };
    const gids = JSON.parse(opts.body);
    return { ok: true, json: async () => Object.fromEntries(gids.map(g => [g, ['app/1']])) };
  });

  setCache('itad-appid:cached-gid', 555);

  for (const gid of ['gid-a', 'gid-b']) {
    const res = await api.post('/api/bundles/resolve').send({ gids: [gid] });
    assert.equal(res.status, 200, `miss "${gid}" should succeed within budget`);
  }

  const over = await api.post('/api/bundles/resolve').send({ gids: ['gid-c'] });
  assert.equal(over.status, 429, 'a cache miss past the budget should be rate limited');

  const cached = await api.post('/api/bundles/resolve').send({ gids: ['cached-gid'] });
  assert.equal(cached.status, 200, 'an all-cached gid batch must bypass the limiter');
  assert.deepEqual(cached.body.appids, { 'cached-gid': 555 });
});

// A limiter actually rejecting a request must be visible in GET /api/metrics's own
// rateLimiters field (lib/metrics.js's recordLimiterTrip) — not just returned as a 429 to the
// caller that hit it, with no server-side trail of how often that's happening overall.
test('a rejected request is recorded in GET /api/metrics rateLimiters', async (t) => {
  _reset();
  _resetMetrics();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));

  // gameSearchLimit's own window-based budget is shared process-wide across every test in this
  // file (not reset by _reset()/_resetMetrics() above, which only touch the app cache/metrics
  // counters) — so exactly how many of these are rejected depends on what earlier tests in this
  // file already consumed. Firing several distinct-term requests and counting the rejections
  // ourselves, rather than assuming "first N succeed", keeps this robust to that shared state.
  let rejected = 0;
  for (let i = 0; i < 5; i++) {
    const res = await api.get(`/api/search-games?q=metrics-trip-term-${i}`);
    if (res.status === 429) rejected++;
  }
  assert.ok(rejected >= 1, 'expected at least one rejection to exercise the metrics path');

  const metrics = await api.get('/api/metrics');
  assert.equal(metrics.body.rateLimiters.gameSearch.sinceRestart, rejected);
  assert.equal(metrics.body.rateLimiters.gameSearch.lastHour, rejected);
});
