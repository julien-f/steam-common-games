'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCached, setCache, getCacheStats, getCacheEntryCounts, _reset } = require('../lib/cache');
const { LIBRARY_CACHE_TTL_MS } = require('../lib/config');

// ── getCached ─────────────────────────────────────────────────────────────────

test('getCached: returns undefined for missing key', () => {
  _reset();
  assert.equal(getCached('games:x'), undefined);
});

test('getCached: returns value within TTL', () => {
  _reset();
  setCache('games:k', 'hello');
  assert.equal(getCached('games:k'), 'hello');
});

test('getCached: returns undefined when entry is expired', () => {
  _reset([['games:k', { value: 'stale', ts: Date.now() - LIBRARY_CACHE_TTL_MS - 1 }]]);
  assert.equal(getCached('games:k'), undefined);
});

test('getCached: deletes expired entry from the cache', () => {
  _reset([['games:k', { value: 'stale', ts: Date.now() - LIBRARY_CACHE_TTL_MS - 1 }]]);
  getCached('games:k');
  assert.equal(getCached('games:k'), undefined);
});

test('getCached: returns undefined for entry just past TTL boundary', () => {
  _reset([['games:k', { value: 'v', ts: Date.now() - LIBRARY_CACHE_TTL_MS - 1 }]]);
  assert.equal(getCached('games:k'), undefined);
});

test('getCached: returns value for entry just within TTL boundary', () => {
  _reset([['games:k', { value: 'v', ts: Date.now() - LIBRARY_CACHE_TTL_MS + 5_000 }]]);
  assert.equal(getCached('games:k'), 'v');
});

// ── setCache ──────────────────────────────────────────────────────────────────

test('setCache: stored value is retrievable', () => {
  _reset();
  setCache('games:k', { foo: 1 });
  assert.deepEqual(getCached('games:k'), { foo: 1 });
});

test('setCache: null is a valid cached value, distinct from a miss', () => {
  _reset();
  setCache('hltb:k', null);
  assert.equal(getCached('hltb:k'), null);
});

test('setCache: overwrites an existing entry and resets timestamp', () => {
  _reset([['games:k', { value: 'old', ts: Date.now() - 50_000 }]]);
  setCache('games:k', 'new');
  assert.equal(getCached('games:k'), 'new');
});

// ── getCacheEntryCounts / getCacheStats ────────────────────────────────────────

test('getCacheEntryCounts: counts rows per group label, zero for an untouched group', () => {
  _reset();
  setCache('games:a', 1);
  setCache('games:b', 2);
  setCache('resolve:x', 'id');

  const counts = getCacheEntryCounts();
  assert.equal(counts.library, 2);
  assert.equal(counts.resolve, 1);
  assert.equal(counts.rating, 0);
});

test('getCacheEntryCounts: a deleted (expired, then read) entry is no longer counted', () => {
  _reset([['games:k', { value: 'stale', ts: Date.now() - LIBRARY_CACHE_TTL_MS - 1 }]]);
  getCached('games:k'); // triggers the expired-entry delete
  assert.equal(getCacheEntryCounts().library, 0);
});

test('getCacheStats: entries is the sum of every group in getCacheEntryCounts', () => {
  _reset();
  setCache('games:a', 1);
  setCache('resolve:x', 'id');
  setCache('rating:y', 2);

  assert.equal(getCacheStats().entries, Object.values(getCacheEntryCounts()).reduce((a, b) => a + b, 0));
  assert.equal(getCacheStats().entries, 3);
});
