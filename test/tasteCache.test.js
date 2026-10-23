'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PREFIX = 'steam.isonoe.net:taste:';

// A Storage with a quota in characters (keys + values), throwing as browsers do once it's full.
function makeQuotaLocalStorage(quota = Infinity) {
  const store = new Map();
  const used = () => [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      const before = store.get(k);
      store.set(k, String(v));
      if (used() > quota) {
        if (before === undefined) store.delete(k);
        else store.set(k, before);
        throw new DOMException('full', 'QuotaExceededError');
      }
    },
    removeItem: (k) => store.delete(k),
  };
}

const taste = (at, pad = '') => ({ at, profile: null, idf: {}, unseenIdf: 0, games: [], pad });
const tasteIds = () =>
  [...Array(localStorage.length).keys()]
    .map((i) => localStorage.key(i))
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length))
    .sort();
const store = (id, at) => localStorage.setItem(PREFIX + id, JSON.stringify(taste(at, big)));

// One padded taste under a one-letter account id, in quota characters.
const big = 'x'.repeat(100);
const E = (PREFIX + 'a').length + JSON.stringify(taste(1, big)).length;

beforeEach(() => {
  global.localStorage = makeQuotaLocalStorage();
});

const { loadTaste, saveTaste, setItemMakingRoom, TASTE_CACHE_MAX } = require('../public/tasteCache.ts');

test('saveTaste/loadTaste: round-trips a taste', () => {
  saveTaste('a', taste(1), []);
  assert.equal(loadTaste('a').at, 1);
});

test('saveTaste: keeps at most TASTE_CACHE_MAX tastes, evicting the oldest `at` first', () => {
  assert.equal(TASTE_CACHE_MAX, 5);
  for (const [id, at] of [
    ['a', 3],
    ['b', 1],
    ['c', 5],
    ['d', 2],
    ['e', 4],
  ])
    saveTaste(id, taste(at), []);
  saveTaste('f', taste(6), []);
  assert.deepEqual(tasteIds(), ['a', 'c', 'd', 'e', 'f']);
  saveTaste('g', taste(7), []);
  assert.deepEqual(tasteIds(), ['a', 'c', 'e', 'f', 'g']);
});

test('saveTaste: an unreadable entry counts as the oldest', () => {
  for (const [id, at] of [
    ['a', 1],
    ['b', 2],
    ['c', 3],
    ['d', 4],
  ])
    saveTaste(id, taste(at), []);
  localStorage.setItem(PREFIX + 'old', 'not json');
  saveTaste('e', taste(5), []);
  assert.deepEqual(tasteIds(), ['a', 'b', 'c', 'd', 'e']);
});

test('saveTaste: never evicts the accounts it is told to keep, even the oldest', () => {
  for (const [id, at] of [
    ['mine', 1],
    ['b', 2],
    ['c', 3],
    ['d', 4],
    ['e', 5],
  ])
    saveTaste(id, taste(at), []);
  saveTaste('f', taste(6), ['mine']);
  assert.deepEqual(tasteIds(), ['c', 'd', 'e', 'f', 'mine']);
});

test('saveTaste: on a full storage, evicts older tastes to fit the new one', () => {
  global.localStorage = makeQuotaLocalStorage(2 * E);
  saveTaste('a', taste(1, big), []);
  saveTaste('b', taste(2, big), []);
  saveTaste('c', taste(3, big), []);
  assert.deepEqual(tasteIds(), ['b', 'c']);
});

test('setItemMakingRoom: on a full storage, evicts the oldest tastes until the write fits', () => {
  global.localStorage = makeQuotaLocalStorage(4 * E);
  store('a', 3);
  store('b', 1);
  store('c', 2);
  const value = 'y'.repeat(3 * E - 10);
  assert.equal(setItemMakingRoom('prefs', value), true);
  assert.deepEqual(tasteIds(), ['a']);
  assert.equal(localStorage.getItem('prefs'), value);
});

test('setItemMakingRoom: keeps the tastes it is told to keep', () => {
  global.localStorage = makeQuotaLocalStorage(3 * E);
  store('m', 1);
  store('b', 2);
  assert.equal(setItemMakingRoom('prefs', 'y'.repeat(E + 10), ['m']), true);
  assert.deepEqual(tasteIds(), ['m']);
});

test('setItemMakingRoom: false when evicting every taste still leaves no room', () => {
  global.localStorage = makeQuotaLocalStorage(2 * E);
  store('a', 1);
  assert.equal(setItemMakingRoom('prefs', 'y'.repeat(3 * E)), false);
  assert.deepEqual(tasteIds(), []);
});

test('setItemMakingRoom: evicts nothing on an error other than a full storage', () => {
  store('a', 1);
  const { setItem } = localStorage;
  localStorage.setItem = (k, v) => {
    if (k === 'prefs') throw new DOMException('denied', 'SecurityError');
    setItem(k, v);
  };
  assert.equal(setItemMakingRoom('prefs', 'y'), false);
  assert.deepEqual(tasteIds(), ['a']);
});
