'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDedup } = require('../lib/dedup');

test('dedup: calls fn and returns its resolved value', async () => {
  const withDedup = createDedup();
  const result = await withDedup('k', async () => 42);
  assert.equal(result, 42);
});

test('dedup: concurrent calls with same key share one in-flight promise, fn called once', async () => {
  const withDedup = createDedup();
  let callCount = 0;
  let resolve;

  const p1 = withDedup('k', () => {
    callCount++;
    return new Promise(r => { resolve = r; });
  });
  const p2 = withDedup('k', () => {
    callCount++;               // must not be reached
    return Promise.resolve('wrong');
  });

  assert.equal(callCount, 1); // p2 reused p1's promise without calling fn
  resolve('shared');

  assert.equal(await p1, 'shared');
  assert.equal(await p2, 'shared');
  assert.equal(callCount, 1);
});

test('dedup: after resolution, next call with same key invokes fn again', async () => {
  const withDedup = createDedup();
  let callCount = 0;
  const fn = async () => ++callCount;

  const r1 = await withDedup('k', fn);
  const r2 = await withDedup('k', fn);

  assert.equal(r1, 1);
  assert.equal(r2, 2);
  assert.equal(callCount, 2);
});

test('dedup: after rejection, next call with same key invokes fn again', async () => {
  const withDedup = createDedup();
  let callCount = 0;
  const fn = async () => { callCount++; throw new Error('fail'); };

  await assert.rejects(() => withDedup('k', fn));
  await assert.rejects(() => withDedup('k', fn));
  assert.equal(callCount, 2);
});

test('dedup: different keys invoke fn independently', async () => {
  const withDedup = createDedup();
  let callCount = 0;
  const fn = async () => ++callCount;

  const [r1, r2] = await Promise.all([
    withDedup('a', fn),
    withDedup('b', fn),
  ]);

  assert.equal(callCount, 2);
  assert.notEqual(r1, r2);
});
