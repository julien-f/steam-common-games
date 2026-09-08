'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCached, getCachedAt, setCache, getCacheStats, getCacheEntryCounts, _reset } = require('../lib/cache');
const { LIBRARY_CACHE_TTL_MS, BUNDLES_CACHE_TTL_MS } = require('../lib/config');

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

// ── getCachedAt ───────────────────────────────────────────────────────────────

test('getCachedAt: returns the write time of a cached entry', () => {
  _reset();
  const before = Date.now();
  setCache('games:when', ['a']);
  const at = getCachedAt('games:when');
  assert.ok(at >= before && at <= Date.now());
});

test('getCachedAt: undefined for a missing key, and for an expired one', () => {
  _reset([['games:old', { value: ['a'], ts: Date.now() - LIBRARY_CACHE_TTL_MS - 1000 }]]);
  assert.equal(getCachedAt('games:missing'), undefined);
  assert.equal(getCachedAt('games:old'), undefined);
});

// ── group routing ─────────────────────────────────────────────────────────────

test('ITAD identity mappings outlive the bundle/price tier they used to share', () => {
  // Written well past BUNDLES_CACHE_TTL_MS ago: a bundle listing that old is gone, while the
  // appid↔gid mapping — which nothing about time invalidates — is still there.
  const old = Date.now() - BUNDLES_CACHE_TTL_MS - 1000;
  _reset([
    ['itad-bundles:US:-publish:false:0:20', { value: [{ id: 1 }], ts: old }],
    ['itad-appid:some-gid', { value: 440, ts: old }],
    ['itad-gid:440', { value: 'some-gid', ts: old }],
    ['itad-shop:steam', { value: 61, ts: old }],
  ]);
  assert.equal(getCached('itad-bundles:US:-publish:false:0:20'), undefined);
  assert.equal(getCached('itad-appid:some-gid'), 440);
  assert.equal(getCached('itad-gid:440'), 'some-gid');
  assert.equal(getCached('itad-shop:steam'), 61);
});

test('getCacheEntryCounts: lists the itad-ids group separately from bundles', () => {
  _reset();
  setCache('itad-appid:g', 1);
  setCache('itad-bundles:k', []);
  const counts = getCacheEntryCounts();
  assert.equal(counts['itad-ids'], 1);
  assert.equal(counts.bundles, 1);
});

// ── per-entry TTL (cached misses) ─────────────────────────────────────────────

test('setCache: ttlMs overrides the group TTL for that one entry', () => {
  _reset();
  setCache('meta:1', null, { ttlMs: 50 });
  setCache('meta:2', { name: 'Portal' });
  // Both sit in the meta group (TTL measured in months), but the first carries its own expiry.
  _reset([
    ['meta:1', { value: null, ts: Date.now() - 1000, expires: Date.now() - 500 }],
    ['meta:2', { value: { name: 'Portal' }, ts: Date.now() - 1000 }],
  ]);
  assert.equal(getCached('meta:1'), undefined, 'per-entry expiry applies');
  assert.deepEqual(getCached('meta:2'), { name: 'Portal' }, 'group TTL still applies to the rest');
});

test('getCachedAt: honours a per-entry expiry too', () => {
  _reset([['meta:3', { value: null, ts: Date.now() - 1000, expires: Date.now() - 500 }]]);
  assert.equal(getCachedAt('meta:3'), undefined);
});
