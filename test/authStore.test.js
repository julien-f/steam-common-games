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
  delete require.cache[require.resolve('../public/listsStore.ts')];
  delete require.cache[require.resolve('../public/accountsStore.ts')];
  delete require.cache[require.resolve('../public/accountData.ts')];
  delete require.cache[require.resolve('../public/authStore.ts')];
  require('../public/accountsStore.ts').setAccountOverride(null);
});

function auth() {
  return require('../public/authStore.ts');
}
function accounts() {
  return require('../public/accountsStore.ts');
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
