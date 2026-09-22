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
  delete require.cache[require.resolve('../public/prefs.ts')];
  // require.cache deletion above doesn't reach signedInSteamid (a module-level `let`) — see
  // _resetSignedInSteamid's own comment in prefs.ts.
  require('../public/prefs.ts')._resetSignedInSteamid();
});

test('getPref: returns the fallback when the key was never set', () => {
  const { getPref } = require('../public/prefs.ts');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('setPref/getPref: round-trips a value', () => {
  const { getPref, setPref } = require('../public/prefs.ts');
  setPref('region', 'DE');
  assert.equal(getPref('region'), 'DE');
});

test('setPref: multiple keys coexist in the same blob', () => {
  const { getPref, setPref } = require('../public/prefs.ts');
  setPref('region', 'DE');
  setPref('libraryView', { sorts: [{ key: 'name', dir: 'asc' }] });
  assert.equal(getPref('region'), 'DE');
  assert.deepEqual(getPref('libraryView'), { sorts: [{ key: 'name', dir: 'asc' }] });
});

test('setPref: overwriting one key leaves other keys untouched', () => {
  const { getPref, setPref } = require('../public/prefs.ts');
  setPref('region', 'DE');
  setPref('bundlesTableView', { sorts: [] });
  setPref('region', 'US');
  assert.equal(getPref('region'), 'US');
  assert.deepEqual(getPref('bundlesTableView'), { sorts: [] });
});

test('getPref: falls back gracefully when the stored blob is corrupted JSON', () => {
  global.localStorage.setItem('steam.isonoe.net:prefs', '{not json');
  const { getPref } = require('../public/prefs.ts');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('getPref: falls back gracefully when the stored value is not an object', () => {
  global.localStorage.setItem('steam.isonoe.net:prefs', '"just a string"');
  const { getPref } = require('../public/prefs.ts');
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

test('getPref/setPref: never throw when localStorage is unavailable', () => {
  global.localStorage = {
    getItem() { throw new Error('unavailable'); },
    setItem() { throw new Error('unavailable'); },
  };
  delete require.cache[require.resolve('../public/prefs.ts')];
  const { getPref, setPref } = require('../public/prefs.ts');
  assert.doesNotThrow(() => setPref('region', 'DE'));
  assert.equal(getPref('region', 'fallback'), 'fallback');
});

// ── v1 → v2 storage migration (raw value per key → {value, updatedAt} per key) ─────────────────

test('getPref: reads a pre-migration (v1) blob with no schemaVersion at all', () => {
  global.localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify({ region: 'DE' }));
  const { getPref } = require('../public/prefs.ts');
  assert.equal(getPref('region'), 'DE');
});

test('getAllPrefEntries: a migrated v1 key gets updatedAt: 0 — older than anything with a real timestamp', () => {
  global.localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify({ region: 'DE' }));
  const { getAllPrefEntries } = require('../public/prefs.ts');
  assert.deepEqual(getAllPrefEntries().region, { value: 'DE', updatedAt: 0 });
});

test('setPref: after migration, the blob is rewritten as v2 and a fresh setPref gets a real updatedAt', () => {
  global.localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify({ region: 'DE' }));
  const { setPref, getAllPrefEntries } = require('../public/prefs.ts');
  const before = Date.now();
  setPref('libraryView', { sorts: [] });
  assert.ok(getAllPrefEntries().libraryView.updatedAt >= before);
  assert.equal(getAllPrefEntries().region.updatedAt, 0); // untouched key stays migrated-but-unset
});

// ── getAllPrefEntries / adoptPrefEntry ──────────────────────────────────────────────────────────

test('getAllPrefEntries: reflects every key set via setPref, each with its own updatedAt', () => {
  const { setPref, getAllPrefEntries } = require('../public/prefs.ts');
  const before = Date.now();
  setPref('region', 'DE');
  const entries = getAllPrefEntries();
  assert.equal(entries.region.value, 'DE');
  assert.ok(entries.region.updatedAt >= before);
});

test('adoptPrefEntry: sets a key\'s value and updatedAt directly, readable via getPref', () => {
  const { adoptPrefEntry, getPref, getAllPrefEntries } = require('../public/prefs.ts');
  adoptPrefEntry('region', 'GB', 12345);
  assert.equal(getPref('region'), 'GB');
  assert.deepEqual(getAllPrefEntries().region, { value: 'GB', updatedAt: 12345 });
});

test('adoptPrefEntry: does not push to the server, even when signed in', async (t) => {
  const restore = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = restore; });

  const { adoptPrefEntry, setSignedInSteamid } = require('../public/prefs.ts');
  setSignedInSteamid('76561198000000001');
  adoptPrefEntry('region', 'GB', 12345);

  assert.equal(called, false);
});

// ── pushPrefToServer (via setPref once signed in) ───────────────────────────────────────────────

test('setPref: pushes { value, updatedAt } to PUT /api/me/prefs/:key once signed in', async (t) => {
  const restore = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = restore; });

  const { setPref, setSignedInSteamid } = require('../public/prefs.ts');
  setSignedInSteamid('76561198000000001');
  const before = Date.now();
  setPref('region', 'DE');

  assert.equal(seen.url, '/api/me/prefs/region');
  assert.equal(seen.body.value, 'DE');
  assert.ok(seen.body.updatedAt >= before);
});

test('setPref: does not push anywhere when signed out', async (t) => {
  const restore = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = restore; });

  const { setPref } = require('../public/prefs.ts');
  setPref('region', 'DE');

  assert.equal(called, false);
});

test('setPref: never pushes a table-view key, even when signed in — local-only until an explicit Save', async (t) => {
  const restore = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  t.after(() => { globalThis.fetch = restore; });

  const { setPref, setSignedInSteamid } = require('../public/prefs.ts');
  setSignedInSteamid('76561198000000001');
  setPref('ownedListView', { pageSize: 25 });

  assert.equal(called, false);
});
