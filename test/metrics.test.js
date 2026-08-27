'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackedFetch, getMetrics, _reset } = require('../lib/metrics');

test.beforeEach(() => _reset());

test('trackedFetch: calls fetch with the same url/opts and returns its result', async () => {
  let seen;
  const t = trackedFetch.bind(null, 'grp', 'label');
  const restore = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, marker: 'res' }; };
  try {
    const res = await t('https://example.com/x', { signal: 'sig' });
    assert.deepEqual(seen, { url: 'https://example.com/x', opts: { signal: 'sig' } });
    assert.equal(res.marker, 'res');
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: counts requests per group/label independently (sinceRestart)', async () => {
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('steam-api', 'getOwnedGames', 'u1');
    await trackedFetch('steam-api', 'getOwnedGames', 'u2');
    await trackedFetch('steam-api', 'getWishlist', 'u3');
    await trackedFetch('itad', 'getPrices', 'u4');

    const { sinceRestart } = getMetrics();
    assert.equal(sinceRestart.groups['steam-api'].getOwnedGames.requests, 2);
    assert.equal(sinceRestart.groups['steam-api'].getWishlist.requests, 1);
    assert.equal(sinceRestart.groups.itad.getPrices.requests, 1);
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: distinguishes labels within the same group (e.g. resolveItadIds vs getPrices)', async () => {
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('itad', 'resolveItadIds', 'u1');
    await trackedFetch('itad', 'resolveItadIds', 'u2');
    await trackedFetch('itad', 'resolveItadIds', 'u3');
    // getPrices never called — should be absent, not present with requests: 0 — so it doesn't
    // look the same as "resolveItadIds is also stalled".
    const { sinceRestart } = getMetrics();
    assert.equal(sinceRestart.groups.itad.resolveItadIds.requests, 3);
    assert.equal(sinceRestart.groups.itad.getPrices, undefined);
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: sinceRestart buckets outcomes by raw HTTP status code, not a blanket error count', async () => {
  const statuses = [200, 200, 429, 403];
  let i = 0;
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: statuses[i] < 400, status: statuses[i++] });
  try {
    for (let n = 0; n < statuses.length; n++) await trackedFetch('steam-store', 'getAppDetails', 'u');

    const entry = getMetrics().sinceRestart.groups['steam-store'].getAppDetails;
    assert.equal(entry.requests, 4);
    assert.deepEqual(entry.statusCounts, { 200: 2, 429: 1, 403: 1 });
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: sinceRestart counts a thrown/network fetch failure separately from statusCounts', async () => {
  const restore = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('timeout'); };
  try {
    await assert.rejects(() => trackedFetch('hltb', 'search', 'u'));
    const entry = getMetrics().sinceRestart.groups.hltb.search;
    assert.equal(entry.requests, 1);
    assert.equal(entry.networkErrors, 1);
    assert.deepEqual(entry.statusCounts, {});
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: lastHour mirrors sinceRestart while everything happened within the hour', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('hltb', 'search', 'u1');
    t.mock.timers.tick(10 * 60 * 1000); // 10 minutes later
    await trackedFetch('hltb', 'search', 'u2');

    const { sinceRestart, lastHour } = getMetrics();
    assert.equal(sinceRestart.groups.hltb.search.requests, 2);
    assert.equal(lastHour.groups.hltb.search.requests, 2);
    assert.deepEqual(lastHour.groups.hltb.search.statusCounts, { 200: 2 });
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: lastHour drops entries older than an hour but sinceRestart keeps them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('hltb', 'search', 'u1'); // this one will age out
    t.mock.timers.tick(61 * 60 * 1000); // 61 minutes later
    await trackedFetch('hltb', 'search', 'u2');

    const { sinceRestart, lastHour } = getMetrics();
    assert.equal(sinceRestart.groups.hltb.search.requests, 2); // lifetime total unaffected
    assert.equal(lastHour.groups.hltb.search.requests, 1);      // only the recent one
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: lastHour re-filters at read time even with no writes since aging out', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('hltb', 'search', 'u1');
    assert.equal(getMetrics().lastHour.groups.hltb.search.requests, 1);

    t.mock.timers.tick(61 * 60 * 1000); // idle for over an hour — no new requests
    assert.equal(getMetrics().lastHour.groups.hltb.search.requests, 0);
  } finally {
    globalThis.fetch = restore;
  }
});

test('getMetrics: includes a stable "since" timestamp', () => {
  const { since } = getMetrics();
  assert.equal(typeof since, 'number');
  assert.ok(since <= Date.now());
});

test('_reset: clears all counters', async () => {
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    await trackedFetch('hltb', 'search', 'u1');
    assert.equal(getMetrics().sinceRestart.groups.hltb.search.requests, 1);
    _reset();
    assert.deepEqual(getMetrics().sinceRestart.groups, {});
  } finally {
    globalThis.fetch = restore;
  }
});
