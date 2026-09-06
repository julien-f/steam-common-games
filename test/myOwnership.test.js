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

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
});

// createMyOwnershipCache() is imported fresh (not re-required) per test — it's a factory
// specifically so each test gets a clean instance without depending on this repo's usual
// "delete require.cache between tests" pattern, which only resets a *stateless* module (see
// myOwnership.ts's own comment on why that pattern doesn't reset a module-level `let` here).
const { createMyOwnershipCache } = require('../public/myOwnership.ts');
const { setMyAccount } = require('../public/accountsStore.ts');

function makeAccount(id, overrides = {}) {
  return { id, members: [id], rawInputs: [id], lastUsedAt: 0, ...overrides };
}

function withFetch(t, handler) {
  const restore = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = restore; });
}

// A minimal /api/common-games + /api/wishlist responder for one account id ("1" by default),
// owning `ownedAppids` and wishlisting `wishlistAppids`.
function fakeAccountFetch({ ownedAppids = [], wishlistAppids = [], failWishlist = false } = {}) {
  return async url => {
    if (url === '/api/common-games') {
      return {
        ok: true,
        json: async () => ({
          groups: [{ games: ownedAppids.map(appid => ({ appid, name: `Game ${appid}` })) }],
          slots: [[{ steamid: '1' }]],
          playtime: {}, lastPlayed: {},
        }),
      };
    }
    if (failWishlist) return { ok: false, json: async () => ({ error: 'private profile' }) };
    return { ok: true, json: async () => ({ items: wishlistAppids.map(appid => ({ appid, priority: 1, dateAdded: null })) }) };
  };
}

test('getMyOwnershipStatus: null when no myAccount is pinned', async () => {
  const { getMyOwnershipStatus } = createMyOwnershipCache();
  assert.equal(await getMyOwnershipStatus(440), null);
});

test('getMyOwnershipStatus: resolves inLibrary/onWishlist against myAccount', async (t) => {
  withFetch(t, fakeAccountFetch({ ownedAppids: [440, 620], wishlistAppids: [620, 730] }));
  setMyAccount(makeAccount('1'));

  const { getMyOwnershipStatus } = createMyOwnershipCache();
  assert.deepEqual(await getMyOwnershipStatus(440), { inLibrary: true, onWishlist: false });
  assert.deepEqual(await getMyOwnershipStatus(620), { inLibrary: true, onWishlist: true });
  assert.deepEqual(await getMyOwnershipStatus(730), { inLibrary: false, onWishlist: true });
  assert.deepEqual(await getMyOwnershipStatus(999), { inLibrary: false, onWishlist: false });
});

test('getMyOwnershipStatus: a failed wishlist fetch still resolves inLibrary, wishlisted false rather than throwing', async (t) => {
  withFetch(t, fakeAccountFetch({ ownedAppids: [440], failWishlist: true }));
  setMyAccount(makeAccount('1'));

  const { getMyOwnershipStatus } = createMyOwnershipCache();
  assert.deepEqual(await getMyOwnershipStatus(440), { inLibrary: true, onWishlist: false });
});

test('getMyOwnershipStatus: only fetches once per pinned account — a second appid check reuses the cached sets', async (t) => {
  let commonGamesCalls = 0;
  withFetch(t, async (url, opts) => {
    if (url === '/api/common-games') { commonGamesCalls++; }
    return fakeAccountFetch({ ownedAppids: [440] })(url, opts);
  });
  setMyAccount(makeAccount('1'));

  const { getMyOwnershipStatus } = createMyOwnershipCache();
  await getMyOwnershipStatus(440);
  await getMyOwnershipStatus(620);
  await getMyOwnershipStatus(730);
  assert.equal(commonGamesCalls, 1);
});

test('getMyOwnershipStatus: switching myAccount refetches against the new account', async (t) => {
  let seenSlots = [];
  withFetch(t, async (url, opts) => {
    if (url === '/api/common-games') {
      const body = JSON.parse(opts.body);
      seenSlots.push(body.slots[0][0]);
      const appids = body.slots[0][0] === '1' ? [440] : [620];
      return { ok: true, json: async () => ({ groups: [{ games: appids.map(a => ({ appid: a, name: `${a}` })) }], slots: [[{ steamid: body.slots[0][0] }]], playtime: {}, lastPlayed: {} }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });

  const { getMyOwnershipStatus } = createMyOwnershipCache();

  setMyAccount(makeAccount('1'));
  assert.deepEqual(await getMyOwnershipStatus(440), { inLibrary: true, onWishlist: false });

  setMyAccount(makeAccount('2'));
  assert.deepEqual(await getMyOwnershipStatus(440), { inLibrary: false, onWishlist: false });
  assert.deepEqual(await getMyOwnershipStatus(620), { inLibrary: true, onWishlist: false });
  assert.deepEqual(seenSlots, ['1', '2']); // cached per account — one /api/common-games call each, not one per appid check
});

test('peekMyOwnershipStatus: null (not blocking) before the fetch resolves, then real data once it lands', async (t) => {
  let resolveCommonGames;
  withFetch(t, async url => {
    if (url === '/api/common-games') {
      return new Promise(resolve => {
        resolveCommonGames = () => resolve({
          ok: true,
          json: async () => ({ groups: [{ games: [{ appid: 440, name: 'TF2' }] }], slots: [[{ steamid: '1' }]], playtime: {}, lastPlayed: {} }),
        });
      });
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });
  setMyAccount(makeAccount('1'));

  const { peekMyOwnershipStatus } = createMyOwnershipCache();
  assert.equal(peekMyOwnershipStatus(440), null); // still loading
  resolveCommonGames();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(peekMyOwnershipStatus(440), { inLibrary: true, onWishlist: false });
});

test('peekMyOwnershipStatus: null when no myAccount is pinned, with no fetch attempted', async (t) => {
  let called = false;
  withFetch(t, async () => { called = true; return { ok: true, json: async () => ({}) }; });

  const { peekMyOwnershipStatus } = createMyOwnershipCache();
  assert.equal(peekMyOwnershipStatus(440), null);
  assert.equal(called, false);
});

test('onMyOwnershipReady: fires once both sets have landed, not before', async (t) => {
  withFetch(t, fakeAccountFetch({ ownedAppids: [440], wishlistAppids: [620] }));
  setMyAccount(makeAccount('1'));

  const { getMyOwnershipStatus, onMyOwnershipReady } = createMyOwnershipCache();
  let fired = 0;
  onMyOwnershipReady(() => { fired++; });
  await getMyOwnershipStatus(440); // drives both fetches to completion
  assert.equal(fired, 1);
});

test('onMyOwnershipReady: the unsubscribe function prevents a later firing', async (t) => {
  withFetch(t, fakeAccountFetch({ ownedAppids: [440] }));
  setMyAccount(makeAccount('1'));

  const { getMyOwnershipStatus, onMyOwnershipReady } = createMyOwnershipCache();
  let fired = 0;
  const unsub = onMyOwnershipReady(() => { fired++; });
  unsub();
  await getMyOwnershipStatus(440);
  assert.equal(fired, 0);
});
