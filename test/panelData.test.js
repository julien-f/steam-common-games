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
