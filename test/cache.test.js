'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCached, setCache, _reset } = require('../lib/cache');
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
