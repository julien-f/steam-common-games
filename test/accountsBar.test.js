'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNT_STATE_LABELS, MAX_RECENTS, computeAccountChipView, computeRecentChipView,
  loadRecents, saveRecents, addRecent, removeRecent,
} = require('../public/accountsBar.ts');

// Same localStorage-stub convention as prefs.test.js/region.test.js — accountsBar.ts's
// recent-list functions read/write it live on every call, no module-level state to reset.
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

// ── computeAccountChipView ───────────────────────────────────────────────────
// The rendering itself (accountsBar.tsx's real Solid components — AccountChip/AccountIdentityInner)
// isn't unit-tested here, same convention every other Solid-converted module in this codebase
// already follows (panel.tsx/nav.tsx/etc.) — only the pure view-model function feeding it is.

test('computeAccountChipView: falls back to the steamid when personaname is absent', () => {
  const v = computeAccountChipView({ steamid: '76561198000000001' }, 'games');
  assert.equal(v.name, '76561198000000001');
});

test('computeAccountChipView: drops a non-http(s) profile URL/avatar instead of exposing it', () => {
  const v = computeAccountChipView({
    steamid: '1', personaname: 'x',
    profileurl: 'javascript:alert(1)', avatarmedium: 'javascript:alert(1)',
  }, 'games');
  assert.equal(v.safeUrl, '');
  assert.equal(v.safeAvatar, '');
});

test('computeAccountChipView: keeps a real https profile URL', () => {
  const v = computeAccountChipView({ steamid: '1', personaname: 'x', profileurl: 'https://steamcommunity.com/id/x/' }, 'games');
  assert.equal(v.safeUrl, 'https://steamcommunity.com/id/x/');
});

test('computeAccountChipView: isPrivate is true only when communityvisibilitystate is not 3', () => {
  assert.equal(computeAccountChipView({ steamid: '1', personaname: 'x', communityvisibilitystate: 1 }, 'games').isPrivate, true);
  assert.equal(computeAccountChipView({ steamid: '1', personaname: 'x', communityvisibilitystate: 3 }, 'games').isPrivate, false);
});

test('computeAccountChipView: status prioritizes gameextrainfo over personastate', () => {
  const v = computeAccountChipView({ steamid: '1', personaname: 'x', personastate: 1, gameextrainfo: 'Hades' }, 'games');
  assert.equal(v.statusClass, 'ingame');
  assert.equal(v.statusTitle, 'Playing Hades (as of this search)');
});

test('computeAccountChipView: falls back to Offline for an out-of-range personastate', () => {
  const v = computeAccountChipView({ steamid: '1', personaname: 'x', personastate: 99 }, 'games');
  assert.equal(v.statusTitle, `${ACCOUNT_STATE_LABELS[0]} (as of this search)`);
});

test('computeAccountChipView: exposes the game count and label when present', () => {
  const v = computeAccountChipView({ steamid: '1', personaname: 'x', gameCount: 1234 }, 'games');
  assert.equal(v.count, 1234);
  assert.equal(v.countLabel, 'games');
});

test('computeAccountChipView: count is undefined with neither gameCount nor itemCount', () => {
  assert.equal(computeAccountChipView({ steamid: '1', personaname: 'x' }, 'games').count, undefined);
});

// ── Recent searches: loadRecents/saveRecents/addRecent/removeRecent ─────────

test('loadRecents: returns [] when nothing was ever stored', () => {
  assert.deepEqual(loadRecents('recent-key'), []);
});

test('loadRecents: returns [] when the stored value is corrupt/not an array', () => {
  global.localStorage.setItem('recent-key', '{not json');
  assert.deepEqual(loadRecents('recent-key'), []);
  global.localStorage.setItem('recent-key', '"just a string"');
  assert.deepEqual(loadRecents('recent-key'), []);
});

test('addRecent/loadRecents: round-trips an entry', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1', personaname: 'alice', avatarmedium: 'x' }]], 'alice');
  const recents = loadRecents('recent-key');
  assert.equal(recents.length, 1);
  assert.equal(recents[0].id, 'alice');
  assert.equal(recents[0].data, 'alice');
  assert.deepEqual(recents[0].players, [[{ steamid: '1', personaname: 'alice', avatarmedium: 'x' }]]);
});

test('addRecent: re-adding an existing id moves it to the front instead of duplicating it', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1' }]], 'alice');
  addRecent('recent-key', 'bob', [[{ steamid: '2' }]], 'bob');
  addRecent('recent-key', 'alice', [[{ steamid: '1', personaname: 'renamed' }]], 'alice');
  const recents = loadRecents('recent-key');
  assert.equal(recents.length, 2);
  assert.equal(recents[0].id, 'alice');
  assert.equal(recents[0].players[0][0].personaname, 'renamed');
  assert.equal(recents[1].id, 'bob');
});

test('addRecent: caps the list at MAX_RECENTS, dropping the oldest', () => {
  for (let i = 0; i < MAX_RECENTS + 3; i++) addRecent('recent-key', `id${i}`, [[{ steamid: String(i) }]], `id${i}`);
  const recents = loadRecents('recent-key');
  assert.equal(recents.length, MAX_RECENTS);
  assert.equal(recents[0].id, `id${MAX_RECENTS + 2}`); // most recent first
  assert.equal(recents.at(-1).id, 'id3'); // the oldest 3 (id0-id2) were dropped
});

test('removeRecent: removes only the matching id', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1' }]], 'alice');
  addRecent('recent-key', 'bob', [[{ steamid: '2' }]], 'bob');
  removeRecent('recent-key', 'alice');
  assert.deepEqual(loadRecents('recent-key').map(r => r.id), ['bob']);
});

// ── computeRecentChipView ─────────────────────────────────────────────────────

test('computeRecentChipView: joins accounts within a group with " + " and groups with ", "', () => {
  const v = computeRecentChipView({
    id: 'x',
    players: [
      [{ personaname: 'alice' }, { personaname: 'bob' }],
      [{ personaname: 'carol' }],
    ],
  });
  assert.equal(v.label, 'alice + bob, carol');
});

test('computeRecentChipView: normalizes a legacy flat players array (pre-grouping entries)', () => {
  const v = computeRecentChipView({ id: 'x', players: [{ personaname: 'alice' }, { personaname: 'bob' }] });
  // Each element gets wrapped as its own one-account group — same as two separate slots.
  assert.equal(v.label, 'alice, bob');
});

test('computeRecentChipView: falls back to the steamid, then the entry id, when personaname is missing', () => {
  const v = computeRecentChipView({ id: 'fallback-id', players: [] });
  assert.equal(v.label, 'fallback-id');
});

test('computeRecentChipView: drops a non-https avatar instead of exposing it', () => {
  const v = computeRecentChipView({ id: 'x', players: [[{ personaname: 'alice', avatarmedium: 'javascript:x' }]] });
  assert.equal(v.safeAvatar, '');
});
