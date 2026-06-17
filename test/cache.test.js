'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCached, setCache, _reset } = require('../lib/cache');

// ── getCached ─────────────────────────────────────────────────────────────────

test('getCached: returns null for missing key', () => {
  _reset();
  assert.equal(getCached('x', 60_000), null);
});

test('getCached: returns value within TTL', () => {
  _reset();
  setCache('k', 'hello', 60_000);
  assert.equal(getCached('k', 60_000), 'hello');
});

test('getCached: returns null when entry is expired', () => {
  _reset([['k', { value: 'stale', ts: Date.now() - 10_000, ttlMs: 5_000 }]]);
  assert.equal(getCached('k', 5_000), null);
});

test('getCached: deletes expired entry from the cache', () => {
  _reset([['k', { value: 'stale', ts: Date.now() - 10_000, ttlMs: 5_000 }]]);
  getCached('k', 5_000);
  // A second read with a generous TTL should still return null — entry is gone
  assert.equal(getCached('k', 999_999), null);
});

test('getCached: returns null for entry just past TTL boundary', () => {
  _reset([['k', { value: 'v', ts: Date.now() - 1001, ttlMs: 1_000 }]]);
  assert.equal(getCached('k', 1_000), null);
});

test('getCached: returns value for entry just within TTL boundary', () => {
  _reset([['k', { value: 'v', ts: Date.now() - 500, ttlMs: 1_000 }]]);
  assert.equal(getCached('k', 1_000), 'v');
});

// ── setCache ──────────────────────────────────────────────────────────────────

test('setCache: stored value is retrievable', () => {
  _reset();
  setCache('k', { foo: 1 }, 60_000);
  assert.deepEqual(getCached('k', 60_000), { foo: 1 });
});

test('setCache: overwrites an existing entry and resets timestamp', () => {
  // Seed with a very old entry
  _reset([['k', { value: 'old', ts: Date.now() - 50_000, ttlMs: 60_000 }]]);
  setCache('k', 'new', 60_000);
  assert.equal(getCached('k', 60_000), 'new');
});

test('getCached: per-call TTL applies even when entry has no stored ttlMs', () => {
  // Seed an old entry written without a TTL (legacy / no-TTL path)
  _reset([['k', { value: 'v', ts: Date.now() - 10_000 }]]);
  assert.equal(getCached('k', 5_000), null);     // 10 s old, 5 s TTL → expired
  assert.equal(getCached('k', 999_999), null);   // entry was deleted by prior call
});

// ── evictExpired (via _reset seeding) ─────────────────────────────────────────

test('evictExpired: entries without ttlMs are not evicted', () => {
  // Only accessible indirectly — seed a no-TTL entry then confirm getCached
  // with a very long TTL still finds it (evict can't touch it; getCached won't either)
  _reset([['k', { value: 'v', ts: Date.now() - 1_000_000 }]]);
  assert.equal(getCached('k', 999_999_999), 'v');
});
