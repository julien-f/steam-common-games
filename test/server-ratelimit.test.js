'use strict';

// This file exercises the details rate limiter, so it opts INTO rate limiting
// (the main suite bypasses it) and sets a low max. Env must be read before the
// app is required, and node:test runs each file in its own process — so this
// configuration is isolated from the rest of the suite.
process.env.STEAM_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.DETAILS_RATE_LIMIT_MAX = '3';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset, setCache } = require('../lib/cache');
const { _resetAuth } = require('../lib/hltb');

const api = supertest(app);

function workingDetailsFetch(fetchedAppids) {
  return async (url) => {
    const appid = url.match(/appids=(\d+)/)?.[1] || url.match(/appreviews\/(\d+)/)?.[1];
    if (appid) fetchedAppids.add(appid);
    if (url.includes('appreviews')) {
      return { ok: true, json: async () => ({ query_summary: { total_reviews: 1000, total_positive: 900, review_score_desc: 'Very Positive' } }) };
    }
    if (url.includes('appdetails')) {
      return { ok: true, json: async () => ({ [appid]: { success: true, data: { genres: [], categories: [], developers: [], publishers: [] } } }) };
    }
    if (url.includes('bleed/init')) return { ok: true, json: async () => ({ token: 'tok', hpKey: 'k', hpVal: 'v' }) };
    if (url.includes('bleed'))      return { ok: true, json: async () => ({ data: [{ game_name: 'Portal', comp_main: 36000, comp_plus: 72000 }] }) };
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
  setCache('rating:800', { score: 88, desc: 'Very Positive', positive: 900, total: 1000 });
  setCache('hltb:800', { main: 10, extra: 15 });
  setCache('meta:800', { genres: [], categories: [], developers: [], publishers: [] });

  // Three uncached appids consume the budget (max = 3).
  for (const appid of [801, 802, 803]) {
    const res = await api.get(`/api/game-details/${appid}?name=Portal`);
    assert.equal(res.status, 200, `miss ${appid} should succeed within budget`);
  }

  // A fourth cache miss is over budget → 429.
  const over = await api.get('/api/game-details/804?name=Portal');
  assert.equal(over.status, 429, 'a cache miss past the budget should be rate limited');

  // The cached appid is still served even though the budget is exhausted,
  // and crucially does NOT trigger any upstream fetch.
  const cached = await api.get('/api/game-details/800?name=Portal');
  assert.equal(cached.status, 200, 'a cache hit must bypass the limiter');
  assert.equal(cached.body.rating.score, 88);
  assert.ok(!fetchedAppids.has('800'), 'cache hit must not fetch upstream');
});
