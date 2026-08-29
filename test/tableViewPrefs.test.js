'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreTableView, resetTableView, shareTableView } = require('../public/tableViewPrefs');

// tableViewPrefs.js reads/writes `location`/`history` and prefs.js's own localStorage-backed
// store directly — stub the minimal browser globals it touches, same idea prefs.test.js/
// region.test.js already use for their own localStorage stubbing.
function fakeTable(initial = {}) {
  let state = initial;
  return {
    setViewState: v => { state = v; },
    getViewState: () => state,
  };
}

function withLocation(search, fn) {
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; },
  };
  let currentSearch = search;
  globalThis.location = { search: currentSearch, origin: 'https://example.test', pathname: '/library.html' };
  globalThis.history = { replaceState: (_s, _t, url) => { currentSearch = url.split('?')[1] ? `?${url.split('?')[1]}` : ''; globalThis.location.search = currentSearch; } };
  try {
    const result = fn();
    return (result && typeof result.finally === 'function') ? result.finally(cleanup) : (cleanup(), result);
  } catch (err) { cleanup(); throw err; }
  function cleanup() { delete globalThis.localStorage; delete globalThis.location; delete globalThis.history; }
}

test('restoreTableView: an incoming param wins, is seeded as the stored default, and is stripped from the URL', () => {
  withLocation('?lv=%7B%22pageSize%22%3A25%7D', () => {
    const table = fakeTable();
    restoreTableView(table, 'libraryView', 'lv');
    assert.deepEqual(table.getViewState(), { pageSize: 25 });
    assert.equal(new URLSearchParams(location.search).has('lv'), false, 'param consumed');
  });
});

test('restoreTableView: a malformed param falls through to the stored default', () => {
  withLocation('?lv=not-json', () => {
    const table = fakeTable();
    restoreTableView(table, 'libraryView', 'lv');
    assert.deepEqual(table.getViewState(), {}, 'no stored pref yet either');
  });
});

test('restoreTableView: no param at all falls back to whatever is already stored', () => {
  withLocation('', () => {
    const { setPref } = require('../public/prefs');
    setPref('libraryView', { pageSize: 10 });
    const table = fakeTable();
    restoreTableView(table, 'libraryView', 'lv');
    assert.deepEqual(table.getViewState(), { pageSize: 10 });
  });
});

test('resetTableView: blanks the view and clears the URL param', () => {
  withLocation('?lv=%7B%22pageSize%22%3A25%7D', () => {
    const table = fakeTable({ pageSize: 25 });
    resetTableView(table, 'libraryView', 'lv');
    assert.deepEqual(table.getViewState(), {});
    assert.equal(new URLSearchParams(location.search).has('lv'), false);
  });
});

test('shareTableView: copies a link with the view snapshotted into the param, without touching the live URL', async () => {
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    await withLocation('', async () => {
      const table = fakeTable({ pageSize: 25 });
      let copied = null;
      const stubNav = { clipboard: { writeText: async (text) => { copied = text; } } };
      Object.defineProperty(globalThis, 'navigator', { value: stubNav, configurable: true });
      const btn = { textContent: 'Share view' };
      shareTableView(table, 'lv', btn);
      await Promise.resolve(); await Promise.resolve(); // let writeText()'s .then() microtask run
      assert.match(copied, /\?lv=%7B%22pageSize%22%3A25%7D/);
      assert.equal(location.search, '', 'live URL left untouched');
    });
  } finally {
    if (originalNavDesc) Object.defineProperty(globalThis, 'navigator', originalNavDesc);
  }
});
