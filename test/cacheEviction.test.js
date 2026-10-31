'use strict';

process.env.DB_FILE = ''; // _reset() empties the cache tables: never the real db.sqlite
const { mock, test } = require('node:test');
const assert = require('node:assert/strict');

// Faked before lib/cache loads, so the eviction interval it arms on load runs on this clock.
mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
const { getCacheEntryCounts, _reset } = require('../lib/cache');
const { LIBRARY_CACHE_TTL_MS } = require('../lib/config');

test('expired rows are evicted every hour, not only at startup', () => {
  const rows = () => getCacheEntryCounts().library;
  _reset([['games:k', { value: 'v', ts: Date.now() - LIBRARY_CACHE_TTL_MS + 1000 }]]);
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(rows(), 1, 'expired, but not evicted before the hour');
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(rows(), 0);
});
