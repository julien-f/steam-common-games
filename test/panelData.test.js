'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPanelDataCache } = require('../public/panelData.ts');

const meta = (id) => ({ name: `DLC ${id}`, capsule: `c${id}.jpg`, releaseDate: '1 Jan, 2020', comingSoon: false });

test('fetchDlc: store metadata only, at most 4 requests at once, each DLC fetched once', async (t) => {
  const urls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const id = Number(url.split('/').pop());
    return { ok: true, json: async () => ({ meta: meta(id) }) };
  });
  const { fetchDlc } = createPanelDataCache();

  const ids = Array.from({ length: 10 }, (_, i) => 100 + i);
  const first = await fetchDlc(ids.slice(0, 6));
  assert.deepEqual(
    first.map((d) => d.name),
    ids.slice(0, 6).map((id) => `DLC ${id}`),
  );
  assert.ok(urls.every((u) => u.startsWith('/api/game-meta/')));
  assert.ok(maxInFlight <= 4, `${maxInFlight} in flight`);

  const more = await fetchDlc(ids); // "Show more": the first 6 are already known
  assert.equal(more.length, 10);
  assert.equal(urls.length, 10);
});

test('fetchDlc: a DLC that fails to load is left out', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.endsWith('/201')
      ? { ok: false, json: async () => ({ error: 'x' }) }
      : { ok: true, json: async () => ({ meta: meta(200) }) },
  );
  const { fetchDlc } = createPanelDataCache();
  assert.deepEqual(
    (await fetchDlc([200, 201])).map((d) => d.appid),
    [200],
  );
});

// Answers the panel's routes from `data`, or fails every one but /api/health while `state.down`.
function mockPanelRoutes(t, data, { itadConfigured = true } = {}) {
  const state = { down: false, urls: [] };
  t.mock.method(globalThis, 'fetch', async (url) => {
    state.urls.push(url);
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => body });
    if (url === '/api/health') return json({ itadConfigured });
    if (state.down) return json({ error: 'upstream down' }, false);
    if (url.startsWith('/api/game-news/')) return json({ news: data.news });
    if (url.startsWith('/api/achievements/')) return json(data.achievements);
    if (url.startsWith('/api/prices')) return json({ prices: { 620: data.price } });
    if (url.startsWith('/api/game-bundles/')) return json({ bundles: data.bundles });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return state;
}

const DATA = {
  news: [{ title: 'Patch' }],
  achievements: { achievements: [{ name: 'A' }], total: 1, unlocked: 0, private: false, playerCount: 1 },
  price: { steamRegular: { amount: 10, currency: 'EUR' } },
  bundles: [{ title: 'Bundle' }],
};

test('a failed forced refresh keeps what each source last loaded', async (t) => {
  const state = mockPanelRoutes(t, DATA);
  const cache = createPanelDataCache();
  const members = ['76561198000000001'];
  const loadAll = (opts) =>
    Promise.all([
      cache.fetchNews(620, opts),
      cache.fetchAchievements(620, members, opts),
      cache.fetchPrice(620, opts),
      cache.fetchBundles(620, opts),
    ]);

  const [news, achievements, price, bundles] = await loadAll();
  assert.deepEqual(news, DATA.news);
  assert.equal(achievements.total, 1);
  assert.equal(price.steamRegular, 10);
  assert.deepEqual(bundles, DATA.bundles);

  state.down = true;
  assert.deepEqual(await loadAll({ force: true }), [news, achievements, price, bundles]);
  assert.equal(cache.peekAchievements(620, members), achievements);
  assert.equal(cache.peekPrice(620), price);
});

test("a source that fails before loading anything reads as null (didn't answer)", async (t) => {
  const state = mockPanelRoutes(t, DATA);
  state.down = true;
  const cache = createPanelDataCache();
  assert.deepEqual(
    await Promise.all([
      cache.fetchNews(620),
      cache.fetchAchievements(620, []),
      cache.fetchPrice(620),
      cache.fetchBundles(620),
    ]),
    [null, null, null, null],
  );
});

test('fetchAchievements: achievementCount 0 answers "no achievements" without a request', async (t) => {
  const state = mockPanelRoutes(t, DATA);
  const { fetchAchievements } = createPanelDataCache();
  const result = await fetchAchievements(620, ['a', 'b'], { achievementCount: 0 });
  assert.deepEqual(result, {
    achievements: [],
    total: 0,
    unlocked: 0,
    private: false,
    playerCount: 2,
    steamUrl: null,
  });
  assert.deepEqual(state.urls, []);
});

test('isItadOff: only once /api/health says ITAD is not configured', async (t) => {
  const state = mockPanelRoutes(t, DATA, { itadConfigured: false });
  const cache = createPanelDataCache();
  assert.equal(cache.isItadOff(), false, 'not asked yet');
  assert.equal(await cache.fetchPrice(620), null);
  assert.equal(await cache.fetchBundles(620), null);
  assert.equal(cache.isItadOff(), true);
  assert.deepEqual(state.urls, ['/api/health'], 'asked once, and no ITAD route called');
});

test('isItadOff: a failed /api/health is not "off", and is asked again next time', async (t) => {
  let healthCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/health') {
      healthCalls++;
      return { ok: false, status: 502, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const cache = createPanelDataCache();
  assert.equal(await cache.fetchPrice(620), null);
  assert.equal(cache.isItadOff(), false);
  await cache.fetchPrice(620);
  assert.equal(healthCalls, 2);
});
