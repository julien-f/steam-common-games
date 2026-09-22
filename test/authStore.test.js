'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

function withFetch(t, handler) {
  const restore = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = restore; });
}

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
  delete require.cache[require.resolve('../public/prefs.ts')];
  delete require.cache[require.resolve('../public/tableViewSync.ts')];
  delete require.cache[require.resolve('../public/listsStore.ts')];
  delete require.cache[require.resolve('../public/accountsStore.ts')];
  delete require.cache[require.resolve('../public/accountData.ts')];
  delete require.cache[require.resolve('../public/authStore.ts')];
  require('../public/accountsStore.ts').setAccountOverride(null);
  // require.cache deletion above doesn't reach signedInSteamid/the table-view baselines (both
  // module-level state) — see _resetSignedInSteamid's own comment in prefs.ts.
  require('../public/prefs.ts')._resetSignedInSteamid();
  require('../public/tableViewSync.ts').resetBaselines();
});

function auth() {
  return require('../public/authStore.ts');
}
function accounts() {
  return require('../public/accountsStore.ts');
}
function prefs() {
  return require('../public/prefs.ts');
}
function tableViewSync() {
  return require('../public/tableViewSync.ts');
}

function makeAccount(id) {
  return { id, members: [id], rawInputs: [id], lastUsedAt: 0 };
}

// Same shape resolveAccountSummary's own tests use (test/accountData.test.js) — a single member
// resolving through /api/common-games (owned) and /api/wishlist.
function mockResolveFetch(steamid = '76561198000000201') {
  return async url => {
    if (url === '/api/common-games') {
      return {
        ok: true,
        json: async () => ({
          groups: [],
          slots: [[{ steamid, personaname: 'Alice', avatarmedium: 'https://x/a.jpg', profileurl: 'https://steamcommunity.com/id/alice/' }]],
          playtime: {}, lastPlayed: {},
        }),
      };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
}

// ── syncPrefsWithServer ───────────────────────────────────────────────────────

const STEAMID = '76561198000000301';

// Matches authStore.ts's own SYNCED_FLAG_PREFIX format — sets up the "this device has already
// synced with this account before" state so a test can exercise ongoing (not first-sync) merges.
function markAlreadySynced(steamid = STEAMID) {
  global.localStorage.setItem(`steam.isonoe.net:prefs-synced:${steamid}`, '1');
}

// -- first sync (never synced with this account on this browser before) --

test('syncPrefsWithServer (first sync): a local-only key is pushed to the server, nothing adopted', async (t) => {
  prefs().setPref('region', 'DE');
  let sent;
  withFetch(t, async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ ok: true }) }; });

  const adopted = await auth().syncPrefsWithServer(STEAMID, {});

  assert.equal(adopted, false);
  assert.equal(sent.url, '/api/me/prefs/region');
  assert.equal(sent.body.value, 'DE');
});

test('syncPrefsWithServer (first sync): a server-only key is adopted locally', async (t) => {
  withFetch(t, async () => { throw new Error('should not push anything'); });

  const adopted = await auth().syncPrefsWithServer(STEAMID, { region: { value: 'GB', updatedAt: 500 } });

  assert.equal(adopted, true);
  assert.deepEqual(prefs().getAllPrefEntries().region, { value: 'GB', updatedAt: 500 });
});

test('syncPrefsWithServer (first sync): server always wins a key both sides have, even if local is newer', async (t) => {
  prefs().setPref('region', 'DE'); // updatedAt = Date.now(), well after 500 — must not matter here
  let pushed = false;
  withFetch(t, async () => { pushed = true; return { ok: true, json: async () => ({ ok: true }) }; });

  const adopted = await auth().syncPrefsWithServer(STEAMID, { region: { value: 'GB', updatedAt: 500 } });

  assert.equal(adopted, true, 'server\'s value must be adopted, not the newer-but-untrusted local one');
  assert.equal(pushed, false, 'local must never push over an existing server key on first sync');
  assert.equal(prefs().getPref('region'), 'GB');
});

test('syncPrefsWithServer (first sync): marks this device as synced, so a later call uses ongoing rules', async (t) => {
  withFetch(t, async () => ({ ok: true, json: async () => ({ ok: true }) }));
  await auth().syncPrefsWithServer(STEAMID, {});
  assert.equal(global.localStorage.getItem(`steam.isonoe.net:prefs-synced:${STEAMID}`), '1');
});

// -- ongoing sync (this device has already synced with this account before) --

test('syncPrefsWithServer (ongoing): local newer than server for the same key pushes, does not adopt', async (t) => {
  markAlreadySynced();
  prefs().setPref('region', 'DE'); // updatedAt = Date.now(), well after 500
  let pushed = false;
  withFetch(t, async () => { pushed = true; return { ok: true, json: async () => ({ ok: true }) }; });

  const adopted = await auth().syncPrefsWithServer(STEAMID, { region: { value: 'GB', updatedAt: 500 } });

  assert.equal(adopted, false);
  assert.equal(pushed, true);
  assert.equal(prefs().getPref('region'), 'DE');
});

test('syncPrefsWithServer (ongoing): server newer than local for the same key adopts, does not push', async (t) => {
  markAlreadySynced();
  const entries = { schemaVersion: 2, region: { value: 'DE', updatedAt: 500 } };
  global.localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify(entries));
  let pushed = false;
  withFetch(t, async () => { pushed = true; return { ok: true, json: async () => ({ ok: true }) }; });

  const adopted = await auth().syncPrefsWithServer(STEAMID, { region: { value: 'GB', updatedAt: 999999999999 } });

  assert.equal(adopted, true);
  assert.equal(pushed, false);
  assert.equal(prefs().getPref('region'), 'GB');
});

test('syncPrefsWithServer (ongoing): equal timestamps on both sides are left alone', async (t) => {
  markAlreadySynced();
  const entries = { schemaVersion: 2, region: { value: 'DE', updatedAt: 500 } };
  global.localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify(entries));
  let called = false;
  withFetch(t, async () => { called = true; return { ok: true, json: async () => ({ ok: true }) }; });

  const adopted = await auth().syncPrefsWithServer(STEAMID, { region: { value: 'DE', updatedAt: 500 } });

  assert.equal(adopted, false);
  assert.equal(called, false);
});

// ── syncPrefsWithServer: table-view keys (baseline tracking, never adopted or pushed) ────

test('syncPrefsWithServer: a table-view key is never adopted or pushed, regardless of what either side has', async (t) => {
  markAlreadySynced();
  prefs().setPref('ownedListView', { sorts: [{ key: 'name', dir: 'asc' }] });
  withFetch(t, async () => { throw new Error('should not push or adopt'); });

  const adopted = await auth().syncPrefsWithServer(STEAMID, {
    ownedListView: { value: { sorts: [{ key: 'rating', dir: 'desc' }] }, updatedAt: 999999999999 },
  });

  assert.equal(adopted, false);
  assert.deepEqual(prefs().getPref('ownedListView'), { sorts: [{ key: 'name', dir: 'asc' }] }, 'local value left untouched');
});

test('syncPrefsWithServer: a table-view key the server has refreshes its baseline', async (t) => {
  withFetch(t, async () => { throw new Error('should not push'); });

  const serverEntry = { value: { sorts: [{ key: 'rating', dir: 'desc' }] }, updatedAt: 500 };
  await auth().syncPrefsWithServer(STEAMID, { ownedListView: serverEntry });

  assert.deepEqual(tableViewSync().getBaseline('ownedListView'), serverEntry);
});

test('syncPrefsWithServer: a table-view key the server has never saved clears its baseline', async (t) => {
  tableViewSync().setBaseline('ownedListView', { value: { pageSize: 25 }, updatedAt: 1 });
  withFetch(t, async () => { throw new Error('should not push'); });

  await auth().syncPrefsWithServer(STEAMID, {});

  assert.equal(tableViewSync().getBaseline('ownedListView'), undefined);
});

// ── autoPopulateAccountFromLogin ─────────────────────────────────────────────

test('autoPopulateAccountFromLogin: sets both myAccount and currentAccount when neither is set', async (t) => {
  withFetch(t, mockResolveFetch());
  await auth().autoPopulateAccountFromLogin('76561198000000201');

  const { getMyAccount, getCurrentAccount } = accounts();
  assert.deepEqual(getMyAccount()?.members, ['76561198000000201']);
  assert.deepEqual(getCurrentAccount()?.members, ['76561198000000201']);
  assert.equal(getMyAccount()?.label, 'Alice');
});

test('autoPopulateAccountFromLogin: never overwrites an already-set myAccount', async (t) => {
  const existing = makeAccount('existing');
  accounts().setMyAccount(existing);
  withFetch(t, mockResolveFetch());

  await auth().autoPopulateAccountFromLogin('76561198000000201');

  assert.deepEqual(accounts().getMyAccount(), existing);
  assert.deepEqual(accounts().getCurrentAccount()?.members, ['76561198000000201']);
});

test('autoPopulateAccountFromLogin: never overwrites an already-set currentAccount', async (t) => {
  const existing = makeAccount('existing');
  accounts().setCurrentAccount(existing);
  withFetch(t, mockResolveFetch());

  await auth().autoPopulateAccountFromLogin('76561198000000201');

  assert.deepEqual(accounts().getCurrentAccount(), existing);
  assert.deepEqual(accounts().getMyAccount()?.members, ['76561198000000201']);
});

test('autoPopulateAccountFromLogin: makes no request once both are already set', async (t) => {
  const existing = makeAccount('existing');
  accounts().setMyAccount(existing);
  accounts().setCurrentAccount(existing);
  let called = false;
  withFetch(t, async () => { called = true; return { ok: true, json: async () => ({}) }; });

  await auth().autoPopulateAccountFromLogin('76561198000000201');

  assert.equal(called, false);
});

test('autoPopulateAccountFromLogin: a failed resolve leaves both unset instead of throwing', async (t) => {
  t.mock.method(console, 'error', () => {});
  withFetch(t, async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));

  await assert.doesNotReject(auth().autoPopulateAccountFromLogin('76561198000000201'));

  assert.equal(accounts().getMyAccount(), null);
  assert.equal(accounts().getCurrentAccount(), null);
});
