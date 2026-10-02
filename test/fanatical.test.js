'use strict';

process.env.DB_FILE = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickAndMixSlug, parsePickAndMix, getPickAndMix, withPickAndMix } = require('../lib/fanatical');
const { _reset, setCache } = require('../lib/cache');

const ITAD_URL =
  'https://www.awin1.com/cread.php?awinmid=118821&awinaffid=235265&ued=https%3A%2F%2Fwww.fanatical.com%2Fen%2Fpick-and-mix%2Fbuild-your-own-killer-bundle';

const FEED = {
  pickandmix: [
    {
      slug: 'build-your-own-killer-bundle',
      tiers: [
        { quantity: 6, price: { USD: 699, CAD: 1789.9999999999998 } },
        { quantity: 1, price: { USD: 149, CAD: 250 } },
      ],
    },
    { slug: 'no-tiers', tiers: [] },
  ],
};

const fanaticalBundle = (over = {}) => ({
  id: 1,
  page: { name: 'Fanatical' },
  url: ITAD_URL,
  tiers: [{ price: null, games: [] }],
  ...over,
});

test('pickAndMixSlug: reads the slug out of ITAD affiliate redirects and direct links', () => {
  assert.equal(pickAndMixSlug(ITAD_URL), 'build-your-own-killer-bundle');
  assert.equal(pickAndMixSlug('https://www.fanatical.com/de/pick-and-mix/foo-bar?x=1'), 'foo-bar');
  assert.equal(pickAndMixSlug('https://www.fanatical.com/en/bundle/foo'), null);
  assert.equal(pickAndMixSlug(null), null);
  assert.equal(pickAndMixSlug('%E0%A4%A'), null); // malformed escape
});

test('parsePickAndMix: major units, rounded, quantity-ascending, empty bundles dropped', () => {
  assert.deepEqual(parsePickAndMix(FEED), {
    'build-your-own-killer-bundle': [
      { quantity: 1, prices: { USD: 1.49, CAD: 2.5 } },
      { quantity: 6, prices: { USD: 6.99, CAD: 17.9 } },
    ],
  });
  assert.deepEqual(parsePickAndMix(null), {});
});

test('withPickAndMix: enriches only null-price Fanatical bundles, one cached fetch', async (t) => {
  _reset();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => FEED };
  });
  const priced = fanaticalBundle({ id: 2, tiers: [{ price: { amount: 5, currency: 'USD' } }] });
  const humble = { id: 3, page: { name: 'Humble Bundle' }, url: ITAD_URL, tiers: [{ price: null }] };
  const [a, b, c] = await withPickAndMix([fanaticalBundle(), priced, humble]);
  assert.equal(a.pickAndMix.length, 2);
  assert.equal(b, priced);
  assert.equal(c, humble);
  await withPickAndMix([fanaticalBundle()]);
  assert.equal(calls, 1);
});

test('withPickAndMix: no fetch at all when nothing needs it', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => assert.fail('should not fetch'));
  const bundles = [{ id: 1, page: { name: 'Humble Bundle' }, tiers: [{ price: null }] }];
  assert.equal(await withPickAndMix(bundles), bundles);
});

test('getPickAndMix: a failed fetch degrades to no tiers and is not retried per request', async (t) => {
  _reset();
  let calls = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: false, status: 403 };
  });
  const [b] = await withPickAndMix([fanaticalBundle()]);
  assert.equal(b.pickAndMix, undefined);
  await getPickAndMix();
  assert.equal(calls, 1);
});

test('getPickAndMix: re-fetches for an unknown slug once the map is old, keeping it on failure', async (t) => {
  _reset();
  t.mock.method(console, 'warn', () => {});
  const old = { known: [{ quantity: 1, prices: { USD: 1 } }] };
  setCache('fanatical-pnm:all', old);
  const later = Date.now() + 2 * 60 * 60 * 1000;
  t.mock.method(Date, 'now', () => later);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: false, status: 500 };
  });
  assert.deepEqual(await getPickAndMix(['known']), old);
  assert.equal(calls, 0);
  assert.deepEqual(await getPickAndMix(['new-one']), old);
  assert.equal(calls, 1);
});
