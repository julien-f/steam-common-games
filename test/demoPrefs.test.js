'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { PREFS_KEY, BACKUP_KEY, DEMO_STEAMID, demoPrefs, seedFn, restoreFn } = require('../scripts/demo-prefs');

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function run(fnSource, localStorage) {
  return new Function('localStorage', `return (${fnSource})()`)(localStorage);
}

test('demo prefs name only the demo account', () => {
  const prefs = demoPrefs(0);
  assert.strictEqual(prefs.schemaVersion, 2);
  for (const key of ['myAccount', 'currentAccount']) assert.deepStrictEqual(prefs[key].value.members, [DEMO_STEAMID]);
  assert.deepStrictEqual(
    prefs.recentAccounts.value.map((a) => a.id),
    [DEMO_STEAMID],
  );
});

test('seed backs up the real prefs, restore puts them back', () => {
  const ls = fakeStorage({ [PREFS_KEY]: 'real' });
  run(seedFn(), ls);
  assert.strictEqual(JSON.parse(ls.getItem(PREFS_KEY)).currentAccount.value.id, DEMO_STEAMID);
  run(restoreFn(), ls);
  assert.strictEqual(ls.getItem(PREFS_KEY), 'real');
  assert.strictEqual(ls.getItem(BACKUP_KEY), null);
});

test('restore removes the prefs when there were none', () => {
  const ls = fakeStorage();
  run(seedFn(), ls);
  run(restoreFn(), ls);
  assert.strictEqual(ls.store.size, 0);
});

test('seed refuses to overwrite an existing backup', () => {
  const ls = fakeStorage({ [BACKUP_KEY]: '{"prefs":"real"}' });
  assert.throws(() => run(seedFn(), ls), /backup already exists/);
  assert.strictEqual(ls.getItem(BACKUP_KEY), '{"prefs":"real"}');
});

test('restore without a backup fails', () => {
  assert.throws(() => run(restoreFn(), fakeStorage()), /No prefs backup/);
});
