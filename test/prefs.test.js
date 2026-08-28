'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// prefs.js reads/writes the bare `localStorage` global (it's loaded as a plain script in the
// browser, not a module) — stub it before requiring so getPref/setPref have something to hit.
function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
  delete require.cache[require.resolve('../public/prefs')];
});

test('getPref: returns the fallback when the key was never set', () => {
  const { getPref } = require('../public/prefs');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('setPref/getPref: round-trips a value', () => {
  const { getPref, setPref } = require('../public/prefs');
  setPref('region', 'DE');
  assert.equal(getPref('region'), 'DE');
});

test('setPref: multiple keys coexist in the same blob', () => {
  const { getPref, setPref } = require('../public/prefs');
  setPref('region', 'DE');
  setPref('libraryView', { sorts: [{ key: 'name', dir: 'asc' }] });
  assert.equal(getPref('region'), 'DE');
  assert.deepEqual(getPref('libraryView'), { sorts: [{ key: 'name', dir: 'asc' }] });
});

test('setPref: overwriting one key leaves other keys untouched', () => {
  const { getPref, setPref } = require('../public/prefs');
  setPref('region', 'DE');
  setPref('bundlesTableView', { sorts: [] });
  setPref('region', 'US');
  assert.equal(getPref('region'), 'US');
  assert.deepEqual(getPref('bundlesTableView'), { sorts: [] });
});

test('getPref: falls back gracefully when the stored blob is corrupted JSON', () => {
  global.localStorage.setItem('steam-common-games:prefs', '{not json');
  const { getPref } = require('../public/prefs');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('getPref: falls back gracefully when the stored value is not an object', () => {
  global.localStorage.setItem('steam-common-games:prefs', '"just a string"');
  const { getPref } = require('../public/prefs');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('getPref/setPref: never throw when localStorage is unavailable', () => {
  global.localStorage = {
    getItem() { throw new Error('unavailable'); },
    setItem() { throw new Error('unavailable'); },
  };
  delete require.cache[require.resolve('../public/prefs')];
  const { getPref, setPref } = require('../public/prefs');
  assert.doesNotThrow(() => setPref('region', 'DE'));
  assert.equal(getPref('region', 'fallback'), 'fallback');
});
