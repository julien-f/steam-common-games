'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  restoreTableView,
  resetTableView,
  prefViewStore,
  shareTableView,
  saveTableViewToServer,
  revertTableViewToServer,
} = require('../public/tableViewPrefs.ts');
const { setBaseline, getBaseline, resetBaselines } = require('../public/tableViewSync.ts');

// Just enough DOM for clipboard.ts's copy announcement.
globalThis.document = { createElement: () => ({ setAttribute() {}, style: {} }), body: { append() {} } };

beforeEach(() => {
  resetBaselines();
});

// tableViewPrefs.js reads/writes `location`/`history` and prefs.js's own localStorage-backed
// store directly — stub the minimal browser globals it touches, same idea prefs.test.js/
// region.test.js already use for their own localStorage stubbing.
function fakeTable(initial = {}) {
  let state = initial;
  return {
    setViewState: (v) => {
      state = v;
    },
    getViewState: () => state,
  };
}

function withLocation(search, fn) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  let currentSearch = search;
  globalThis.location = { search: currentSearch, origin: 'https://example.test', pathname: '/library.html' };
  globalThis.history = {
    replaceState: (_s, _t, url) => {
      currentSearch = url.split('?')[1] ? `?${url.split('?')[1]}` : '';
      globalThis.location.search = currentSearch;
    },
  };
  try {
    const result = fn();
    return result && typeof result.finally === 'function' ? result.finally(cleanup) : (cleanup(), result);
  } catch (err) {
    cleanup();
    throw err;
  }
  function cleanup() {
    delete globalThis.localStorage;
    delete globalThis.location;
    delete globalThis.history;
  }
}

test('restoreTableView: an incoming param wins for this visit only — applied, not stored, stripped from the URL', () => {
  withLocation('?tv=%7B%22pageSize%22%3A25%7D', () => {
    const { getPref, setPref } = require('../public/prefs.ts');
    setPref('libraryView', { pageSize: 10 });
    const table = fakeTable();
    assert.equal(restoreTableView(table, prefViewStore('libraryView')), true, 'reports a shared view');
    assert.deepEqual(table.getViewState(), { pageSize: 25 });
    assert.deepEqual(getPref('libraryView'), { pageSize: 10 }, "the viewer's own view is untouched");
    assert.equal(new URLSearchParams(location.search).has('tv'), false, 'param consumed');
  });
});

test('restoreTableView: a malformed param falls through to the stored default', () => {
  withLocation('?tv=not-json', () => {
    const table = fakeTable();
    assert.equal(restoreTableView(table, prefViewStore('libraryView')), false);
    assert.deepEqual(table.getViewState(), {}, 'no stored pref yet either');
    assert.equal(new URLSearchParams(location.search).has('tv'), false, 'param consumed anyway');
  });
});

test('restoreTableView: valid JSON of the wrong shape falls through to the stored default', () => {
  const bad = [
    '{"filters":{"name":5}}',
    '[]',
    '5',
    'null',
    '{"sorts":[{"key":"name","dir":"up"}]}',
    '{"rangeFilters":{"price":{"min":1}}}',
    '{"filterModes":{"tags":"xor"}}',
    '{"pageSize":"25"}',
    '{"pageSize":0}',
    '{"page":-3}',
    '{"page":1.5}',
    '{"visibleCols":"name"}',
  ];
  for (const raw of bad) {
    withLocation(`?tv=${encodeURIComponent(raw)}`, () => {
      const { setPref } = require('../public/prefs.ts');
      setPref('libraryView', { pageSize: 10 });
      const table = fakeTable();
      assert.equal(restoreTableView(table, prefViewStore('libraryView')), false, raw);
      assert.deepEqual(table.getViewState(), { pageSize: 10 }, raw);
    });
  }
});

test('restoreTableView: a full well-formed view is applied', () => {
  const view = {
    visibleCols: ['name'],
    columnOrder: ['name', 'price'],
    sorts: [{ key: 'name', dir: 'asc' }],
    filters: { tags: ['RPG'] },
    excludeFilters: { tags: ['Horror'] },
    filterModes: { tags: 'and' },
    rangeFilters: { price: { min: '1', max: '' } },
    groupBy: ['tags'],
    collapsedGroups: ['RPG'],
    page: 2,
    pageSize: 25,
    searchQuery: 'portal',
  };
  withLocation(`?tv=${encodeURIComponent(JSON.stringify(view))}`, () => {
    const table = fakeTable();
    assert.equal(restoreTableView(table, prefViewStore('libraryView')), true);
    assert.deepEqual(table.getViewState(), view);
  });
});

test('restoreTableView: no param at all falls back to whatever is already stored', () => {
  withLocation('', () => {
    const { setPref } = require('../public/prefs.ts');
    setPref('libraryView', { pageSize: 10 });
    const table = fakeTable();
    restoreTableView(table, prefViewStore('libraryView'));
    assert.deepEqual(table.getViewState(), { pageSize: 10 });
  });
});

test('resetTableView: blanks the view and the stored default', () => {
  withLocation('', () => {
    const { getPref, setPref } = require('../public/prefs.ts');
    setPref('libraryView', { pageSize: 25 });
    const table = fakeTable({ pageSize: 25 });
    resetTableView(table, prefViewStore('libraryView'));
    assert.deepEqual(table.getViewState(), {});
    assert.deepEqual(getPref('libraryView'), {});
  });
});

test('saveTableViewToServer: pushes the given value and advances the baseline to match', async () => {
  await withLocation('', async () => {
    const restore = globalThis.fetch;
    let sent;
    globalThis.fetch = async (url, opts) => {
      sent = { url, body: JSON.parse(opts.body) };
      return { ok: true, json: async () => ({}) };
    };
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
    globalThis.fetch = async (url, opts) => {
      sent = { url, body: JSON.parse(opts.body) };
      return { ok: true, json: async () => ({}) };
    };
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
    const { getPref, setSignedInSteamid, _resetPrefsState } = require('../public/prefs.ts');
    const table = fakeTable({ pageSize: 25 });
    setBaseline('libraryView', { value: { pageSize: 10 }, updatedAt: 42 });
    setSignedInSteamid('76561198000000001');

    const restore = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    };
    try {
      revertTableViewToServer(table, 'libraryView');
    } finally {
      globalThis.fetch = restore;
      _resetPrefsState();
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
      const stubNav = {
        clipboard: {
          writeText: async (text) => {
            copied = text;
          },
        },
      };
      Object.defineProperty(globalThis, 'navigator', { value: stubNav, configurable: true });
      const btn = { textContent: 'Share view', childNodes: [], replaceChildren() {} };
      shareTableView(table, btn);
      await Promise.resolve();
      await Promise.resolve(); // let writeText()'s .then() microtask run
      assert.match(copied, /\?tv=%7B%22pageSize%22%3A25%7D/);
      assert.equal(location.search, '', 'live URL left untouched');
    });
  } finally {
    if (originalNavDesc) Object.defineProperty(globalThis, 'navigator', originalNavDesc);
  }
});

test('shareTableView: an unchanged view sends no param, so the link opens on the defaults', async () => {
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    await withLocation('?q=x', async () => {
      let copied = null;
      const stubNav = { clipboard: { writeText: async (text) => (copied = text) } };
      Object.defineProperty(globalThis, 'navigator', { value: stubNav, configurable: true });
      shareTableView(fakeTable({}), { textContent: 'Share view', childNodes: [], replaceChildren() {} });
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(new URL(copied).searchParams.has('tv'), false);
      assert.equal(new URL(copied).searchParams.get('q'), 'x');
    });
  } finally {
    if (originalNavDesc) Object.defineProperty(globalThis, 'navigator', originalNavDesc);
  }
});

test('shareTableView: adds extra params, but never over one the URL already sets', async () => {
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    let copied = null;
    const stubNav = {
      clipboard: {
        writeText: async (text) => {
          copied = text;
        },
      },
    };
    Object.defineProperty(globalThis, 'navigator', { value: stubNav, configurable: true });
    const share = async (search) => {
      await withLocation(search, async () => {
        shareTableView(
          fakeTable({}),
          { textContent: 'Share view', childNodes: [], replaceChildren() {} },
          { u: 'alice' },
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      return new URL(copied).searchParams.getAll('u');
    };
    assert.deepEqual(await share(''), ['alice']);
    assert.deepEqual(await share('?u=bob'), ['bob'], 'a shared link keeps the account it names');
  } finally {
    if (originalNavDesc) Object.defineProperty(globalThis, 'navigator', originalNavDesc);
  }
});
