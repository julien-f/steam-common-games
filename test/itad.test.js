'use strict';

// Force the in-memory DB regardless of how this file is invoked — see steam.test.js's own
// comment on why this must be set before requiring lib/cache.
process.env.DB_FILE = '';
process.env.ITAD_API_KEY = 'test-itad-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSteamShopId, getBundles, resolveSteamAppIds, getPrices, extractPriceInfo } = require('../lib/itad');
const { _reset } = require('../lib/cache');

const SHOPS = [
  { id: 2, title: 'AllYouPlay' },
  { id: 61, title: 'Steam' },
  { id: 8, title: 'Fanatical' },
];

test('getSteamShopId: finds and caches the Steam entry', async (t) => {
  _reset();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, json: async () => SHOPS }; });
  const id = await getSteamShopId();
  assert.equal(id, 61);
  await getSteamShopId();
  assert.equal(calls, 1, 'second call should hit the cache, not fetch again');
});

test('getSteamShopId: throws when no Steam entry is present', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ id: 2, title: 'AllYouPlay' }] }));
  await assert.rejects(() => getSteamShopId(), err => err.isUpstream === true);
});

test('getBundles: throws on upstream error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => getBundles(), err => err.isUpstream === true);
});

test('getBundles: returns and caches the bundle list', async (t) => {
  _reset();
  const bundles = [{ id: 1, title: 'Test Bundle' }];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, json: async () => bundles }; });
  const result = await getBundles({ country: 'US', offset: 0, limit: 20 });
  assert.deepEqual(result, bundles);
  await getBundles({ country: 'US', offset: 0, limit: 20 });
  assert.equal(calls, 1, 'identical params should hit the cache');
  await getBundles({ country: 'DE', offset: 0, limit: 20 });
  assert.equal(calls, 2, 'a different country is a different cache key');
});

test('resolveSteamAppIds: resolves, caches, and treats a missing mapping as null', async (t) => {
  _reset();
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    fetchCalls++;
    if (String(url).includes('/service/shops/')) return { ok: true, json: async () => SHOPS };
    // lookup/{shopId}/gid/v1
    const gids = JSON.parse(opts.body);
    const body = {};
    for (const gid of gids) body[gid] = gid === 'gid-known' ? ['app/292030', 'sub/1234'] : null;
    return { ok: true, json: async () => body };
  });

  const result = await resolveSteamAppIds(['gid-known', 'gid-missing']);
  assert.equal(result.get('gid-known'), 292030);
  assert.equal(result.get('gid-missing'), null);

  const callsBefore = fetchCalls;
  const again = await resolveSteamAppIds(['gid-known', 'gid-missing']);
  assert.equal(again.get('gid-known'), 292030);
  assert.equal(fetchCalls, callsBefore, 'both gids should now be cached individually');
});

test('resolveSteamAppIds: a gid listed only as a Steam "sub" (package), not "app", resolves to null', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/service/shops/')) return { ok: true, json: async () => SHOPS };
    const gids = JSON.parse(opts.body);
    return { ok: true, json: async () => Object.fromEntries(gids.map(g => [g, ['sub/1234']])) };
  });
  const result = await resolveSteamAppIds(['gid-sub-only']);
  assert.equal(result.get('gid-sub-only'), null);
});

test('resolveSteamAppIds: throws when the lookup call fails', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/service/shops/')) return { ok: true, json: async () => SHOPS };
    return { ok: false, status: 502 };
  });
  await assert.rejects(() => resolveSteamAppIds(['gid-x']), err => err.isUpstream === true);
});

const PRICE_ENTRY = {
  id: 'gid-1',
  historyLow: {
    all: { amount: 0.99, amountInt: 99, currency: 'USD' },
    y1:  { amount: 0.99, amountInt: 99, currency: 'USD' },
    m3:  { amount: 9.99, amountInt: 999, currency: 'USD' },
  },
  deals: [
    { shop: { id: 61, name: 'Steam' }, regular: { amount: 19.99, amountInt: 1999, currency: 'USD' } },
    { shop: { id: 6, name: 'Fanatical' }, regular: { amount: 14.99, amountInt: 1499, currency: 'USD' } },
  ],
};

test('getPrices: fetches, caches per (gid, country), and treats a missing gid as null', async (t) => {
  _reset();
  let priceCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/games/prices/v3')) { priceCalls++; return { ok: true, json: async () => [PRICE_ENTRY] }; }
    return { ok: false, status: 500 };
  });
  const result = await getPrices(['gid-1', 'gid-missing'], { country: 'US' });
  assert.deepEqual(result.get('gid-1'), PRICE_ENTRY);
  assert.equal(result.get('gid-missing'), null);

  const callsBefore = priceCalls;
  await getPrices(['gid-1', 'gid-missing'], { country: 'US' });
  assert.equal(priceCalls, callsBefore, 'both should now be cached');

  await getPrices(['gid-1'], { country: 'DE' });
  assert.equal(priceCalls, callsBefore + 1, 'a different country is a different cache entry');
});

test('getPrices: throws on upstream error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => getPrices(['gid-1'], { country: 'US' }), err => err.isUpstream === true);
});

test('extractPriceInfo: pulls Steam\'s regular price and the three historical lows', () => {
  const info = extractPriceInfo(PRICE_ENTRY, 61);
  assert.deepEqual(info.steamRegular, { amount: 19.99, amountInt: 1999, currency: 'USD' });
  assert.deepEqual(info.lowAll, PRICE_ENTRY.historyLow.all);
  assert.deepEqual(info.lowY1, PRICE_ENTRY.historyLow.y1);
  assert.deepEqual(info.lowM3, PRICE_ENTRY.historyLow.m3);
});

test('extractPriceInfo: all fields null for a missing entry or a shop with no Steam deal', () => {
  assert.deepEqual(extractPriceInfo(null, 61), { steamRegular: null, lowAll: null, lowY1: null, lowM3: null });
  const noSteam = { ...PRICE_ENTRY, deals: [PRICE_ENTRY.deals[1]] };
  assert.equal(extractPriceInfo(noSteam, 61).steamRegular, null);
});
