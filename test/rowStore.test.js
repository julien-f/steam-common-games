'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRowStore } = require('../public/rowStore.ts');

// A minimal stand-in for a Solid store setter: applies the produce()-wrapped updater to the
// array at `idx` directly, same shape `setGames`/`setRowsStore` give createRowStore in
// app.tsx/bundles.tsx/library.tsx, without needing a real Solid root.
function fakeStoreSetter(arr) {
  return (idx, updater) => { arr[idx] = updater(arr[idx]); };
}

test('createRowStore: load() populates size()/getRow() keyed by appid', () => {
  const arr = [{ appid: 1, name: 'a' }, { appid: 2, name: 'b' }];
  const store = createRowStore(fakeStoreSetter(arr));
  store.load(arr);
  assert.equal(store.size(), 2);
  assert.deepEqual(store.getRow(1), { appid: 1, name: 'a' });
  assert.deepEqual(store.getRow(2), { appid: 2, name: 'b' });
});

test('createRowStore: load() clones rows into panelRows, not the same references as the input array', () => {
  const arr = [{ appid: 1, name: 'a' }];
  const store = createRowStore(fakeStoreSetter(arr));
  store.load(arr);
  assert.notEqual(store.getRow(1), arr[0]);
});

test('createRowStore: mutateRow() applies fn to both the store array and the panel copy', () => {
  const arr = [{ appid: 1, name: 'a' }];
  const store = createRowStore(fakeStoreSetter(arr));
  store.load(arr);
  const returned = store.mutateRow(1, draft => { draft.name = 'updated'; });
  assert.equal(arr[0].name, 'updated');
  assert.equal(store.getRow(1).name, 'updated');
  assert.equal(returned, store.getRow(1));
});

test('createRowStore: mutateRow() on an appid not in rowIndex returns undefined and touches nothing', () => {
  const arr = [{ appid: 1, name: 'a' }];
  const store = createRowStore(fakeStoreSetter(arr));
  store.load(arr);
  const result = store.mutateRow(999, draft => { draft.name = 'should not happen'; });
  assert.equal(result, undefined);
  assert.equal(arr[0].name, 'a');
});

test('createRowStore: reset() clears both maps', () => {
  const arr = [{ appid: 1, name: 'a' }];
  const store = createRowStore(fakeStoreSetter(arr));
  store.load(arr);
  store.reset();
  assert.equal(store.size(), 0);
  assert.equal(store.getRow(1), undefined);
});

test('createRowStore: getRow() before any load() returns undefined', () => {
  const store = createRowStore(fakeStoreSetter([]));
  assert.equal(store.getRow(1), undefined);
});

test('createRowStore: load() warns once on a duplicate appid, naming it', () => {
  const arr = [{ appid: 1, name: 'a' }, { appid: 1, name: 'b (dup)' }, { appid: 2, name: 'c' }];
  const store = createRowStore(fakeStoreSetter(arr));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    store.load(arr);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /duplicate appid.*: 1/);
});

test('createRowStore: load() does not warn when every appid is unique', () => {
  const arr = [{ appid: 1, name: 'a' }, { appid: 2, name: 'b' }];
  const store = createRowStore(fakeStoreSetter(arr));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    store.load(arr);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 0);
});
