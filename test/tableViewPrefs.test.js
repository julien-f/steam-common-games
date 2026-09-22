'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { restoreTableView, resetTableView, shareTableView, saveTableViewToServer, revertTableViewToServer } = require('../public/tableViewPrefs.ts');
const { setBaseline, getBaseline, resetBaselines } = require('../public/tableViewSync.ts');

beforeEach(() => { resetBaselines(); });

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
    const { setPref } = require('../public/prefs.ts');
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

test('saveTableViewToServer: pushes the given value and advances the baseline to match', async () => {
  await withLocation('', async () => {
    const restore = globalThis.fetch;
    let sent;
    globalThis.fetch = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({}) }; };
    const before = Date.now();
    try {
      saveTableViewToServer('libraryView', { pageSize: 25 });
    } finally {
      globalThis.fetch = restore;
    }

    assert.equal(sent.url, '/api/me/prefs/libraryView');
    assert.deepEqual(sent.body.value, { pageSize: 25 });
    const baseline = getBaseline('libraryView');
    assert.deepEqual(baseline.value, { pageSize: 25 });
    assert.ok(baseline.updatedAt >= before);
  });
});

test('saveTableViewToServer: strips page/searchQuery before pushing and before storing the baseline', async () => {
  await withLocation('', async () => {
    const restore = globalThis.fetch;
    let sent;
    globalThis.fetch = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({}) }; };
    try {
      saveTableViewToServer('libraryView', { pageSize: 25, page: 3, searchQuery: 'portal' });
    } finally {
      globalThis.fetch = restore;
    }

    assert.deepEqual(sent.body.value, { pageSize: 25 });
    assert.deepEqual(getBaseline('libraryView').value, { pageSize: 25 });
  });
});

test('revertTableViewToServer: live-patches the table and adopts the baseline locally, without re-pushing it', async () => {
  await withLocation('', async () => {
    const { getPref, setSignedInSteamid, _resetSignedInSteamid } = require('../public/prefs.ts');
    const table = fakeTable({ pageSize: 25 });
    setBaseline('libraryView', { value: { pageSize: 10 }, updatedAt: 42 });
    setSignedInSteamid('76561198000000001');

    const restore = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    try {
      revertTableViewToServer(table, 'libraryView');
    } finally {
      globalThis.fetch = restore;
      _resetSignedInSteamid();
    }

    assert.deepEqual(table.getViewState(), { pageSize: 10 });
    assert.deepEqual(getPref('libraryView'), { pageSize: 10 });
    assert.equal(called, false, 'the reverted-to value must not be pushed back as if it were a fresh edit');
  });
});

test('revertTableViewToServer: with no baseline saved yet, reverts to an empty view', () => {
  return withLocation('', () => {
    const { getPref } = require('../public/prefs.ts');
    const table = fakeTable({ pageSize: 25 });

    revertTableViewToServer(table, 'libraryView');

    assert.deepEqual(table.getViewState(), {});
    assert.deepEqual(getPref('libraryView'), {});
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
