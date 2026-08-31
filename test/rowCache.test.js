'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRowCache } = require('../public/rowCache.ts');

test('rowCache: caches a copy on first reveal, reused verbatim on later renders', () => {
  const cache = createRowCache();
  const rows = [{ appid: 1, name: 'A' }];
  const first = cache.visibleRowsForTable(rows, r => r.appid);
  rows[0].name = 'A (mutated)'; // mutate the canonical row in place
  const second = cache.visibleRowsForTable(rows, r => r.appid);
  assert.equal(second[0], first[0], 'same cached reference reused until markChanged');
  assert.equal(second[0].name, 'A', 'cached copy is stale until markChanged');
});

test('rowCache: markChanged forces a fresh copy on the next render', () => {
  const cache = createRowCache();
  const rows = [{ appid: 1, name: 'A' }];
  const first = cache.visibleRowsForTable(rows, r => r.appid)[0];
  rows[0].name = 'B';
  cache.markChanged(1);
  const second = cache.visibleRowsForTable(rows, r => r.appid)[0];
  assert.notEqual(second, first, 'a new reference is created after markChanged');
  assert.equal(second.name, 'B');
});

test('rowCache: reset clears every cached entry', () => {
  const cache = createRowCache();
  const rows = [{ appid: 1, name: 'A' }];
  const first = cache.visibleRowsForTable(rows, r => r.appid)[0];
  cache.reset();
  const second = cache.visibleRowsForTable(rows, r => r.appid)[0];
  assert.notEqual(second, first);
});
