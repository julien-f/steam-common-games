'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStaleGuard } = require('../public/staleGuard.ts');

test('createStaleGuard: a single call is never stale', () => {
  const guard = createStaleGuard();
  const gen = guard.next();
  assert.equal(guard.isStale(gen), false);
});

test('createStaleGuard: an earlier call becomes stale once a newer one starts', () => {
  const guard = createStaleGuard();
  const first = guard.next();
  const second = guard.next();
  assert.equal(guard.isStale(first), true);
  assert.equal(guard.isStale(second), false);
});

test('createStaleGuard: three overlapping calls — only the last is current', () => {
  const guard = createStaleGuard();
  const a = guard.next();
  const b = guard.next();
  const c = guard.next();
  assert.equal(guard.isStale(a), true);
  assert.equal(guard.isStale(b), true);
  assert.equal(guard.isStale(c), false);
});

test('createStaleGuard: current() reflects the generation in effect without bumping it', () => {
  const guard = createStaleGuard();
  assert.equal(guard.current(), 0);
  const gen = guard.next();
  assert.equal(guard.current(), gen);
  assert.equal(guard.current(), gen); // reading again doesn't bump it
});
