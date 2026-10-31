'use strict';

process.env.DB_FILE = '';
process.env.ITAD_API_KEY = 'test-itad-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCatalog, getGamePass, isGamePassCached } = require('../lib/gamepass');
const { lookupShopGids } = require('../lib/itad');
const { _reset } = require('../lib/cache');

const json = (body) => ({ ok: true, json: async () => body });
const SHOPS = [
  { id: 48, title: 'Microsoft Store' },
  { id: 61, title: 'Steam' },
];

// One catalog: A and A2 (two editions of game g1, on Steam), B (g2, not on Steam), C (unknown to ITAD).
function mockUpstreams(t, { catalog, titlesOk = true } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push(url);
    if (url.startsWith('https://catalog.gamepass.com/')) {
      return json(
        catalog ?? [{ siglId: 'x', title: 'All PC Games' }, { id: 'A' }, { id: 'A2' }, { id: 'B' }, { id: 'C' }],
      );
    }
    if (url.includes('/service/shops/v1')) return json(SHOPS);
    if (url.includes('/lookup/id/shop/48/v1')) {
      // The live reply keys some ids lowercased.
      return json({ A: 'g1', a2: 'g1', B: 'g2', C: null });
    }
    if (url.includes('/lookup/shop/61/id/v1')) {
      assert.deepEqual(JSON.parse(opts.body).sort(), ['g1', 'g2']);
      return json({ g1: ['app/10'], g2: null });
    }
    if (url.startsWith('https://displaycatalog.mp.microsoft.com/')) {
      if (!titlesOk) return { ok: false, status: 500 };
      return json({
        Products: [
          { ProductId: 'B', LocalizedProperties: [{ ProductTitle: 'Bee' }] },
          { ProductId: 'C', LocalizedProperties: [{ ProductTitle: 'Sea' }] },
        ],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

test('parseCatalog: skips the collection header and dedupes ids', () => {
  assert.deepEqual(parseCatalog([{ siglId: 's', title: 'All PC Games' }, { id: 'A' }, { id: 'A' }, { id: '' }, {}]), [
    'A',
  ]);
  assert.deepEqual(parseCatalog(null), []);
});

test('lookupShopGids: matches ids case-insensitively, in chunks of 200', async (t) => {
  _reset();
  const ids = Array.from({ length: 250 }, (_, i) => `ID${i}`);
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (url.includes('/service/shops/v1')) return json(SHOPS);
    const sent = JSON.parse(opts.body);
    bodies.push(sent.length);
    return json(Object.fromEntries(sent.map((id) => [id.toLowerCase(), `gid-${id}`])));
  });
  const gids = await lookupShopGids('Microsoft Store', ids);
  assert.deepEqual(bodies, [200, 50]);
  assert.equal(gids.get('ID249'), 'gid-ID249');
});

test('getGamePass: Steam appids, one per game, and named games not on Steam', async (t) => {
  _reset();
  mockUpstreams(t);
  assert.deepEqual(await getGamePass('US'), {
    appids: [10],
    notOnSteam: [
      { id: 'B', title: 'Bee' },
      { id: 'C', title: 'Sea' },
    ],
    failed: 0,
  });
});

test('getGamePass: the catalog is cached per market, refetched when forced', async (t) => {
  _reset();
  const calls = mockUpstreams(t);
  await getGamePass('US');
  await getGamePass('US');
  const catalogCalls = () => calls.filter((u) => u.startsWith('https://catalog.gamepass.com/'));
  assert.equal(catalogCalls().length, 1);
  assert.equal(calls.filter((u) => u.startsWith('https://displaycatalog')).length, 1, 'titles cached per product');
  await getGamePass('JP');
  await getGamePass('US', { force: true });
  assert.equal(catalogCalls().length, 3);
  assert.match(catalogCalls()[1], /market=JP/);
});

test('getGamePass: an empty catalog throws an upstream error and caches nothing', async (t) => {
  _reset();
  const calls = mockUpstreams(t, { catalog: [{ siglId: 'x' }] });
  await assert.rejects(
    () => getGamePass('US'),
    (err) => err.isUpstream === true,
  );
  await assert.rejects(() => getGamePass('US'));
  assert.equal(calls.filter((u) => u.startsWith('https://catalog.gamepass.com/')).length, 2);
});

test('getGamePass: titles that fail degrade to null', async (t) => {
  _reset();
  mockUpstreams(t, { titlesOk: false });
  t.mock.method(console, 'warn', () => {});
  const { notOnSteam } = await getGamePass('US');
  assert.deepEqual(notOnSteam, [
    { id: 'B', title: null },
    { id: 'C', title: null },
  ]);
});

test('getGamePass: a game whose Steam lookup errored counts as failed, not as not on Steam', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.startsWith('https://catalog.gamepass.com/')) return json([{ id: 'A' }, { id: 'B' }]);
    if (url.includes('/service/shops/v1')) return json(SHOPS);
    if (url.includes('/lookup/id/shop/48/v1')) return json({ A: 'g1', B: 'g2' });
    // g1 is a Steam package whose expansion then errors.
    if (url.includes('/lookup/shop/61/id/v1')) return json({ g1: ['sub/5'], g2: null });
    if (url.startsWith('https://displaycatalog')) {
      return json({ Products: [{ ProductId: 'B', LocalizedProperties: [{ ProductTitle: 'Bee' }] }] });
    }
    return { ok: false, status: 500 };
  });
  assert.deepEqual(await getGamePass('US'), { appids: [], notOnSteam: [{ id: 'B', title: 'Bee' }], failed: 1 });
});

test('getGamePass: a product a successful reply leaves out is cached as untitled, not asked again', async (t) => {
  _reset();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    if (url.startsWith('https://catalog.gamepass.com/')) return json([{ id: 'B' }, { id: 'D' }]);
    if (url.includes('/service/shops/v1')) return json(SHOPS);
    if (url.includes('/lookup/id/shop/48/v1')) return json({ B: null, D: null });
    if (url.startsWith('https://displaycatalog')) {
      return json({ Products: [{ ProductId: 'B', LocalizedProperties: [{ ProductTitle: 'Bee' }] }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const expected = {
    appids: [],
    notOnSteam: [
      { id: 'B', title: 'Bee' },
      { id: 'D', title: null },
    ],
    failed: 0,
  };
  assert.deepEqual(await getGamePass('US'), expected);
  assert.deepEqual(await getGamePass('US'), expected);
  assert.equal(calls.filter((u) => u.startsWith('https://displaycatalog')).length, 1);
  assert.equal(isGamePassCached('US'), true, 'a reload skips the limiter');
});
