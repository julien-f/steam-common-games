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
  delete require.cache[require.resolve('../public/prefs.ts')];
  delete require.cache[require.resolve('../public/listsStore.ts')];
  delete require.cache[require.resolve('../public/accountsStore.ts')];
  // The `?u=` override is module-level state, not a pref — so unlike everything else in this
  // file it survives the require.cache reset above (see myOwnership.ts's own comment on why a
  // TS-stripped ESM module's `let` isn't reachable through require.cache). Cleared by hand so
  // each test starts with no override rather than inheriting the previous one's.
  require('../public/accountsStore.ts').setAccountOverride(null);
});

function store() {
  return require('../public/accountsStore.ts');
}

function makeAccount(id, overrides = {}) {
  return { id, members: [id], rawInputs: [id], lastUsedAt: 0, ...overrides };
}

test('accountIdFor: sorts members so the same Family always produces the same id', () => {
  const { accountIdFor } = store();
  assert.equal(accountIdFor(['b', 'a']), accountIdFor(['a', 'b']));
  assert.equal(accountIdFor(['a', 'b']), 'a+b');
});

test('getMyAccount/getCurrentAccount: null when never set', () => {
  const { getMyAccount, getCurrentAccount } = store();
  assert.equal(getMyAccount(), null);
  assert.equal(getCurrentAccount(), null);
});

test('setMyAccount/setCurrentAccount: round-trip independently, clearing recents orphans neither', () => {
  const { setMyAccount, setCurrentAccount, getMyAccount, getCurrentAccount, clearRecentAccounts, getRecentAccounts } = store();
  const me = makeAccount('me');
  const other = makeAccount('other');
  setMyAccount(me);
  setCurrentAccount(other);

  clearRecentAccounts();

  assert.deepEqual(getMyAccount(), me);
  assert.deepEqual(getCurrentAccount(), other);
  assert.equal(getRecentAccounts().length, 0);
});

test('setCurrentAccount: upserts into recentAccounts (dedupe by id, bumps lastUsedAt)', async () => {
  const { setCurrentAccount, getRecentAccounts } = store();
  setCurrentAccount(makeAccount('acc1', { lastUsedAt: 1 }));
  const firstStamp = getRecentAccounts()[0].lastUsedAt;
  await new Promise(r => setTimeout(r, 2));
  setCurrentAccount(makeAccount('acc1', { lastUsedAt: 1 }));

  const recents = getRecentAccounts();
  assert.equal(recents.length, 1);
  assert.ok(recents[0].lastUsedAt > firstStamp);
});

test('setMyAccount: also upserts into recentAccounts (starring is itself a use)', () => {
  const { setMyAccount, getRecentAccounts } = store();
  setMyAccount(makeAccount('me'));
  assert.equal(getRecentAccounts().some(a => a.id === 'me'), true);
});

test('getRecentAccounts: most-recently-used first', async () => {
  const { setCurrentAccount, getRecentAccounts } = store();
  setCurrentAccount(makeAccount('older'));
  await new Promise(r => setTimeout(r, 2));
  setCurrentAccount(makeAccount('newer'));

  assert.deepEqual(getRecentAccounts().map(a => a.id), ['newer', 'older']);
});

test('removeRecentAccount: hard-removes an account nothing references', () => {
  const { setCurrentAccount, removeRecentAccount, getRecentAccounts } = store();
  setCurrentAccount(makeAccount('acc1'));
  const result = removeRecentAccount('acc1');
  assert.equal(result.softRemoved, false);
  assert.equal(getRecentAccounts().length, 0);
});

test('removeRecentAccount: soft-removes an account still referenced by a dynamic list', () => {
  const { setCurrentAccount, removeRecentAccount, getRecentAccounts } = store();
  const { createList } = require('../public/listsStore.ts');
  setCurrentAccount(makeAccount('acc1'));
  createList({
    name: 'Watcher', kind: 'dynamic', op: 'union',
    sources: [{ kind: 'account-owned', accountId: 'acc1' }],
  });

  const result = removeRecentAccount('acc1');
  assert.equal(result.softRemoved, true);
  assert.equal(getRecentAccounts().length, 0); // hidden from the default view
  assert.equal(getRecentAccounts({ includeRemoved: true }).length, 1);
});

test('restoreRecentAccount: clears removedAt, account reappears in the default view', () => {
  const { setCurrentAccount, removeRecentAccount, restoreRecentAccount, getRecentAccounts } = store();
  const { createList } = require('../public/listsStore.ts');
  setCurrentAccount(makeAccount('acc1'));
  createList({
    name: 'Watcher', kind: 'dynamic', op: 'union',
    sources: [{ kind: 'account-owned', accountId: 'acc1' }],
  });
  removeRecentAccount('acc1');

  restoreRecentAccount('acc1');
  assert.equal(getRecentAccounts().some(a => a.id === 'acc1'), true);
});

test('clearRecentAccounts: soft-removes referenced accounts, hard-removes the rest', () => {
  const { setCurrentAccount, clearRecentAccounts, getRecentAccounts } = store();
  const { createList } = require('../public/listsStore.ts');
  setCurrentAccount(makeAccount('referenced'));
  setCurrentAccount(makeAccount('unreferenced'));
  createList({
    name: 'Watcher', kind: 'dynamic', op: 'union',
    sources: [{ kind: 'account-wishlist', accountId: 'referenced' }],
  });

  clearRecentAccounts();

  assert.equal(getRecentAccounts().length, 0);
  const all = getRecentAccounts({ includeRemoved: true });
  assert.deepEqual(all.map(a => a.id), ['referenced']);
});

test('sweepRemovedAccounts: purges a soft-removed account once its last reference is gone', () => {
  const { setCurrentAccount, removeRecentAccount, sweepRemovedAccounts, getRecentAccounts } = store();
  const { createList, updateDynamicList } = require('../public/listsStore.ts');
  setCurrentAccount(makeAccount('acc1'));
  const watcher = createList({
    name: 'Watcher', kind: 'dynamic', op: 'union',
    sources: [{ kind: 'account-owned', accountId: 'acc1' }],
  });
  removeRecentAccount('acc1');

  assert.equal(sweepRemovedAccounts(), 0); // still referenced
  updateDynamicList(watcher.id, 'union', []); // drop the reference
  assert.equal(sweepRemovedAccounts(), 1);
  assert.equal(getRecentAccounts({ includeRemoved: true }).length, 0);
});

// ── The ?u= override ──────────────────────────────────────────────────────────

test('setAccountOverride/getEffectiveCurrentAccount: the override wins over the stored account', () => {
  const { setCurrentAccount, setAccountOverride, getEffectiveCurrentAccount, getCurrentAccount } = store();
  setCurrentAccount(makeAccount('mine'));
  setAccountOverride(makeAccount('theirs'));

  assert.equal(getEffectiveCurrentAccount().id, 'theirs');
  assert.equal(getCurrentAccount().id, 'mine', 'the stored preference itself is untouched');
});

test('setAccountOverride: falls back to the stored account once cleared', () => {
  const { setCurrentAccount, setAccountOverride, getEffectiveCurrentAccount } = store();
  setCurrentAccount(makeAccount('mine'));
  setAccountOverride(makeAccount('theirs'));
  setAccountOverride(null);

  assert.equal(getEffectiveCurrentAccount().id, 'mine');
});

test('setAccountOverride: is never persisted, and never lands in recentAccounts', () => {
  const { setAccountOverride, getCurrentAccount, getRecentAccounts, getEffectiveCurrentAccount } = store();
  setAccountOverride(makeAccount('theirs'));

  assert.equal(getEffectiveCurrentAccount().id, 'theirs');
  assert.equal(getCurrentAccount(), null, 'no stored currentAccount was written');
  assert.deepEqual(getRecentAccounts(), [], 'browsing a link is not the same act as picking an account');
});

test('getEffectiveCurrentAccount: null when there is neither an override nor a stored account', () => {
  assert.equal(store().getEffectiveCurrentAccount(), null);
});

test('setAccountOverride/setCurrentAccount: broadcast ACCOUNT_CHANGED_EVENT', () => {
  const events = [];
  global.window = { dispatchEvent: e => events.push(e.type) };
  const { setAccountOverride, setCurrentAccount, ACCOUNT_CHANGED_EVENT } = store();

  setAccountOverride(makeAccount('theirs'));
  setCurrentAccount(makeAccount('mine'));
  delete global.window;

  assert.deepEqual(events, [ACCOUNT_CHANGED_EVENT, ACCOUNT_CHANGED_EVENT]);
});

test('setAccountOverride: re-setting the same account id broadcasts nothing', () => {
  const events = [];
  global.window = { dispatchEvent: e => events.push(e.type) };
  const { setAccountOverride } = store();

  setAccountOverride(makeAccount('theirs'));
  setAccountOverride(makeAccount('theirs'));
  setAccountOverride(null);
  setAccountOverride(null);
  delete global.window;

  assert.equal(events.length, 2, 'one for the set, one for the clear');
});

test('setAccountOverride: never throws when window is undefined (Node/test environment)', () => {
  const { setAccountOverride } = store();
  assert.doesNotThrow(() => setAccountOverride(makeAccount('theirs')));
});

// ── accountIdentifiers ───────────────────────────────────────────────────────

test('accountIdentifiers: prefers the stored custom-URL name over the steam64 id', () => {
  const { accountIdentifiers } = store();
  const account = makeAccount('1', { vanities: { 1: 'gaben' } });
  assert.deepEqual(accountIdentifiers(account), [{ steamid: '1', identifier: 'gaben' }]);
});

test('accountIdentifiers: falls back to the steam64 id per member, including for accounts stored before vanities existed', () => {
  const { accountIdentifiers } = store();
  const family = { id: '1+2', members: ['1', '2'], rawInputs: [], vanities: { 2: 'bob' }, lastUsedAt: 0 };
  assert.deepEqual(accountIdentifiers(family), [
    { steamid: '1', identifier: '1' },
    { steamid: '2', identifier: 'bob' },
  ]);
  assert.deepEqual(accountIdentifiers(makeAccount('1')), [{ steamid: '1', identifier: '1' }]);
});

// ── accountDisplayLabel ──────────────────────────────────────────────────────

test('accountDisplayLabel: prefers the cached Steam label', () => {
  const { accountDisplayLabel } = store();
  assert.equal(accountDisplayLabel(makeAccount('1', { label: 'Alice', rawInputs: ['alice_url'] })), 'Alice');
});

test('accountDisplayLabel: falls back to what the user typed, joined for a Family', () => {
  const { accountDisplayLabel } = store();
  assert.equal(accountDisplayLabel({ id: 'a+b', members: ['a', 'b'], rawInputs: ['alice', 'bob'], lastUsedAt: 0 }), 'alice + bob');
});

test('accountDisplayLabel: falls back to the member ids when nothing else is known', () => {
  // A `?u=` link's account before its resolve lands carries neither a label nor typed inputs.
  const { accountDisplayLabel } = store();
  assert.equal(accountDisplayLabel({ id: 'a+b', members: ['a', 'b'], rawInputs: [], lastUsedAt: 0 }), 'a + b');
});
