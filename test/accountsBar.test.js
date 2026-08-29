'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNT_STATE_LABELS, MAX_RECENTS, accountChipHtml, renderAccountChips, renderAccountChipsGrouped,
  bindAccountRefresh, loadRecents, saveRecents, addRecent, removeRecent, recentChipHtml,
  renderRecentsBar, bindRecentsBar,
} = require('../public/accountsBar');

// Same localStorage-stub convention as prefs.test.js/region.test.js — accountsBar.js's
// recent-list functions read/write it live on every call, no module-level state to reset.
function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

// Minimal fake DOM — just enough surface for the innerHTML/hidden assignments and the
// `e.target.closest('.some-class')` delegation pattern every bind*/render* function here uses.
// No real DOM/jsdom dependency needed since nothing here actually parses the rendered HTML.
function fakeContainer() {
  return {
    hidden: false,
    innerHTML: '',
    _handlers: [],
    addEventListener(type, fn) { this._handlers.push(fn); },
    click(target) { this._handlers.forEach(fn => fn({ target })); },
  };
}
function fakeButton(cls, dataset = {}) {
  return {
    dataset,
    disabled: false,
    textContent: '',
    closest(sel) { return sel === `.${cls}` ? this : null; },
  };
}

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
});

// ── accountChipHtml ──────────────────────────────────────────────────────────

test('accountChipHtml: escapes the persona name', () => {
  const html = accountChipHtml({ steamid: '1', personaname: '<script>' }, 'games');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('accountChipHtml: falls back to the steamid when personaname is absent', () => {
  const html = accountChipHtml({ steamid: '76561198000000001' }, 'games');
  assert.ok(html.includes('76561198000000001'));
});

test('accountChipHtml: drops a non-http(s) profile URL/avatar instead of rendering it', () => {
  const html = accountChipHtml({
    steamid: '1', personaname: 'x',
    profileurl: 'javascript:alert(1)', avatarmedium: 'javascript:alert(1)',
  }, 'games');
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('<span class="account-identity">')); // not an <a> — unsafe URL dropped
});

test('accountChipHtml: keeps a real https profile URL as an outbound link', () => {
  const html = accountChipHtml({ steamid: '1', personaname: 'x', profileurl: 'https://steamcommunity.com/id/x/' }, 'games');
  assert.ok(html.includes('<a class="account-identity" href="https://steamcommunity.com/id/x/"'));
});

test('accountChipHtml: shows the 🔒 Private badge when communityvisibilitystate is not 3', () => {
  const priv = accountChipHtml({ steamid: '1', personaname: 'x', communityvisibilitystate: 1 }, 'games');
  const pub = accountChipHtml({ steamid: '1', personaname: 'x', communityvisibilitystate: 3 }, 'games');
  assert.ok(priv.includes('🔒 Private'));
  assert.ok(!pub.includes('🔒 Private'));
});

test('accountChipHtml: status label prioritizes gameextrainfo over personastate', () => {
  const html = accountChipHtml({ steamid: '1', personaname: 'x', personastate: 1, gameextrainfo: 'Hades' }, 'games');
  assert.ok(html.includes('Playing Hades'));
});

test('accountChipHtml: falls back to Offline for an out-of-range personastate', () => {
  const html = accountChipHtml({ steamid: '1', personaname: 'x', personastate: 99 }, 'games');
  assert.ok(html.includes(`${ACCOUNT_STATE_LABELS[0]} (as of this search)`));
});

test('accountChipHtml: renders the game count when present', () => {
  const html = accountChipHtml({ steamid: '1', personaname: 'x', gameCount: 1234 }, 'games');
  assert.ok(html.includes('1,234 games'));
});

// ── renderAccountChips / renderAccountChipsGrouped ───────────────────────────

test('renderAccountChips: hides and clears the container when there are no players', () => {
  const el = fakeContainer();
  el.innerHTML = 'stale';
  renderAccountChips(el, [], 'games');
  assert.equal(el.hidden, true);
  assert.equal(el.innerHTML, '');
});

test('renderAccountChips: renders one chip per player and unhides the container', () => {
  const el = fakeContainer();
  renderAccountChips(el, [{ steamid: '1', personaname: 'a' }, { steamid: '2', personaname: 'b' }], 'games');
  assert.equal(el.hidden, false);
  assert.equal((el.innerHTML.match(/account-chip/g) || []).length, 2);
});

test('renderAccountChipsGrouped: hides when every group is empty', () => {
  const el = fakeContainer();
  renderAccountChipsGrouped(el, [{ label: 'A', players: [] }, { players: null }], 'games');
  assert.equal(el.hidden, true);
});

test('renderAccountChipsGrouped: omits the slot-label span when a group has no label', () => {
  const el = fakeContainer();
  renderAccountChipsGrouped(el, [{ players: [{ steamid: '1', personaname: 'a' }] }], 'games');
  assert.ok(!el.innerHTML.includes('slot-label'));
});

test('renderAccountChipsGrouped: renders a slot-label per labeled group', () => {
  const el = fakeContainer();
  renderAccountChipsGrouped(el, [
    { label: 'Player 1', players: [{ steamid: '1', personaname: 'a' }] },
    { label: 'Player 2', players: [{ steamid: '2', personaname: 'b' }] },
  ], 'games');
  assert.equal((el.innerHTML.match(/slot-label/g) || []).length, 2);
  assert.ok(el.innerHTML.includes('Player 1'));
  assert.ok(el.innerHTML.includes('Player 2'));
});

// ── bindAccountRefresh ───────────────────────────────────────────────────────

test('bindAccountRefresh: clicking a refresh button disables it and calls onRefresh with its steamid', () => {
  const el = fakeContainer();
  const calls = [];
  bindAccountRefresh(el, (steamid, btn) => calls.push([steamid, btn]));
  const btn = fakeButton('account-refresh-btn', { steamid: '76561198000000001' });
  el.click(btn);
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, '⋯');
  assert.deepEqual(calls, [['76561198000000001', btn]]);
});

test('bindAccountRefresh: ignores a click outside the refresh button', () => {
  const el = fakeContainer();
  const calls = [];
  bindAccountRefresh(el, (...args) => calls.push(args));
  el.click(fakeButton('account-identity'));
  assert.equal(calls.length, 0);
});

test('bindAccountRefresh: ignores a click on an already-disabled button', () => {
  const el = fakeContainer();
  const calls = [];
  bindAccountRefresh(el, (...args) => calls.push(args));
  const btn = fakeButton('account-refresh-btn', { steamid: '1' });
  btn.disabled = true;
  el.click(btn);
  assert.equal(calls.length, 0);
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

// ── recentChipHtml ───────────────────────────────────────────────────────────

test('recentChipHtml: joins accounts within a group with " + " and groups with ", "', () => {
  const html = recentChipHtml({
    id: 'x',
    players: [
      [{ personaname: 'alice' }, { personaname: 'bob' }],
      [{ personaname: 'carol' }],
    ],
  });
  assert.ok(html.includes('alice + bob, carol'));
});

test('recentChipHtml: normalizes a legacy flat players array (pre-grouping entries)', () => {
  const html = recentChipHtml({ id: 'x', players: [{ personaname: 'alice' }, { personaname: 'bob' }] });
  // Each element gets wrapped as its own one-account group — same as two separate slots.
  assert.ok(html.includes('alice, bob'));
});

test('recentChipHtml: falls back to the steamid, then the entry id, when personaname is missing', () => {
  const html = recentChipHtml({ id: 'fallback-id', players: [] });
  assert.ok(html.includes('fallback-id'));
});

test('recentChipHtml: drops a non-https avatar instead of rendering it', () => {
  const html = recentChipHtml({ id: 'x', players: [[{ personaname: 'alice', avatarmedium: 'javascript:x' }]] });
  assert.ok(!html.includes('javascript:'));
});

// ── renderRecentsBar / bindRecentsBar ────────────────────────────────────────

test('renderRecentsBar: hides the container when there is no history', () => {
  const el = fakeContainer();
  renderRecentsBar(el, 'recent-key');
  assert.equal(el.hidden, true);
});

test('renderRecentsBar: renders a chip per entry plus a Clear button', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1', personaname: 'alice' }]], 'alice');
  const el = fakeContainer();
  renderRecentsBar(el, 'recent-key');
  assert.equal(el.hidden, false);
  assert.ok(el.innerHTML.includes('recent-chip'));
  assert.ok(el.innerHTML.includes('recents-clear'));
});

test('bindRecentsBar: clicking a chip calls onLoad with that entry\'s data', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1' }]], { slots: [['alice']] });
  const el = fakeContainer();
  const loaded = [];
  bindRecentsBar(el, 'recent-key', data => loaded.push(data));
  el.click(fakeButton('recent-chip-btn', { id: 'alice' }));
  assert.deepEqual(loaded, [{ slots: [['alice']] }]);
});

test('bindRecentsBar: clicking remove deletes just that entry and re-renders', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1' }]], 'alice');
  addRecent('recent-key', 'bob', [[{ steamid: '2' }]], 'bob');
  const el = fakeContainer();
  bindRecentsBar(el, 'recent-key', () => {});
  el.click(fakeButton('recent-chip-remove', { id: 'alice' }));
  assert.deepEqual(loadRecents('recent-key').map(r => r.id), ['bob']);
  assert.ok(el.innerHTML.includes('bob'));
});

test('bindRecentsBar: clicking Clear empties the whole list and re-renders hidden', () => {
  addRecent('recent-key', 'alice', [[{ steamid: '1' }]], 'alice');
  const el = fakeContainer();
  bindRecentsBar(el, 'recent-key', () => {});
  el.click(fakeButton('recents-clear'));
  assert.deepEqual(loadRecents('recent-key'), []);
  assert.equal(el.hidden, true);
});
