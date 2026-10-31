'use strict';

// Opts back into the pacing `npm test` turns off; each test file runs in its own process.
process.env.DB_FILE = '';
process.env.UPSTREAM_MIN_INTERVAL_MS = '1000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getProtonDbStatus, getStoreBrowseItem } = require('../lib/steam');
const { getHLTB, _resetAuth } = require('../lib/hltb');
const { _reset } = require('../lib/cache');

const flush = () => new Promise((r) => setImmediate(r));

// HLTB, ProtonDB and the store browse API are unsanctioned: 3 requests in flight each, and a
// slot waits UPSTREAM_MIN_INTERVAL_MS before its next request (≈ 3 req/s).
for (const [name, call, respond] of [
  [
    'ProtonDB',
    (i) => getProtonDbStatus(500 + i),
    () => ({ ok: true, status: 200, json: async () => ({ tier: 'gold', confidence: 'strong', total: 1 }) }),
  ],
  [
    'store browse',
    (i) => getStoreBrowseItem(600 + i),
    () => ({ ok: true, status: 200, json: async () => ({ response: { store_items: [{ success: 1 }] } }) }),
  ],
  [
    'HLTB search',
    (i) => getHLTB(700 + i, `Game ${i}`),
    (url) =>
      url.includes('search/site/init')
        ? { ok: true, status: 200, json: async () => ({ token: 't', hpKey: 'k', hpVal: 'v' }) }
        : { ok: true, status: 200, json: async () => ({ data: [] }) },
  ],
]) {
  // A failed request (here a network error) holds its slot too: an erroring upstream must not get unpaced retries.
  for (const fails of [false, true]) {
    test(`${name}: a slot waits UPSTREAM_MIN_INTERVAL_MS before its next request${fails ? ', even after a failure' : ''}`, async (t) => {
      _reset();
      _resetAuth();
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const urls = [];
      const paced = () => urls.filter((url) => !url.includes('search/site/init')).length;
      t.mock.method(globalThis, 'fetch', async (url) => {
        urls.push(url);
        if (fails && !url.includes('search/site/init')) throw new TypeError('fetch failed');
        return respond(url);
      });

      const calls = Promise.allSettled(Array.from({ length: 6 }, (_, i) => call(i)));
      for (let i = 0; i < 5; i++) await flush();
      assert.equal(paced(), 3, 'only 3 in flight before any slot frees up');

      t.mock.timers.tick(999);
      for (let i = 0; i < 5; i++) await flush();
      assert.equal(paced(), 3, 'a slot stays busy for the whole interval');

      t.mock.timers.tick(1);
      for (let i = 0; i < 5; i++) await flush();
      assert.equal(paced(), 6);
      assert.ok((await calls).every(({ status }) => status === (fails ? 'rejected' : 'fulfilled')));
      // Frees the last slots: the next variant shares this semaphore.
      t.mock.timers.tick(1000);
    });
  }
}
