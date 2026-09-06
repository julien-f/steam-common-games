'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Same localStorage-stub convention as prefs.test.js — recentGames.ts is now backed by
// prefs.ts's shared blob rather than its own standalone localStorage key (see
// docs/list-centric-redesign.md's Phase 1), so clear both modules' require caches per test.
function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

// Same minimal fake-DOM shape as accountsBar.test.js/gameSearch.test.js used to use — enough
// for innerHTML/hidden and the `e.target.closest('.some-class')` delegation pattern, no jsdom
// needed.
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
  return { dataset, closest(sel) { return sel === `.${cls}` ? this : null; } };
}

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
  delete require.cache[require.resolve('../public/prefs.ts')];
  delete require.cache[require.resolve('../public/recentGames.ts')];
});

function mod() {
  return require('../public/recentGames.ts');
}

// ── Recent games list ────────────────────────────────────────────────────────

test('loadRecentGames: returns [] when nothing was ever stored', () => {
  assert.deepEqual(mod().loadRecentGames(), []);
});

test('loadRecentGames: returns [] when the stored prefs blob is corrupt (same fallback prefs.ts already gives)', () => {
  global.localStorage.setItem('steam-common-games:prefs', '{not json');
  assert.deepEqual(mod().loadRecentGames(), []);
});

test('addRecentGame/loadRecentGames: round-trips an entry, defaulting a missing thumbnail to null', () => {
  const { addRecentGame, loadRecentGames } = mod();
  addRecentGame(620, 'Portal 2', null);
  assert.deepEqual(loadRecentGames(), [{ appid: 620, name: 'Portal 2', tinyImage: null }]);
});

test('addRecentGame: re-adding an existing appid moves it to the front instead of duplicating it', () => {
  const { addRecentGame, loadRecentGames } = mod();
  addRecentGame(620, 'Portal 2', 'x');
  addRecentGame(400, 'Portal', 'y');
  addRecentGame(620, 'Portal 2', 'z'); // refreshed thumbnail
  const recents = loadRecentGames();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].appid, 620);
  assert.equal(recents[0].tinyImage, 'z');
  assert.equal(recents[1].appid, 400);
});

test('addRecentGame: caps the list at MAX_RECENT_GAMES, dropping the oldest', () => {
  const { addRecentGame, loadRecentGames, MAX_RECENT_GAMES } = mod();
  for (let i = 0; i < MAX_RECENT_GAMES + 3; i++) addRecentGame(i, `Game ${i}`, null);
  const recents = loadRecentGames();
  assert.equal(recents.length, MAX_RECENT_GAMES);
  assert.equal(recents[0].appid, MAX_RECENT_GAMES + 2); // most recent first
  assert.equal(recents.at(-1).appid, 3); // games 0-2 were dropped
});

test('removeRecentGame: removes only the matching appid', () => {
  const { addRecentGame, removeRecentGame, loadRecentGames } = mod();
  addRecentGame(620, 'Portal 2', null);
  addRecentGame(400, 'Portal', null);
  removeRecentGame(620);
  assert.deepEqual(loadRecentGames().map(g => g.appid), [400]);
});

test('addRecentGame/removeRecentGame: coexist with other prefs keys in the same blob', () => {
  const { setPref, getPref } = require('../public/prefs.ts');
  const { addRecentGame } = mod();
  setPref('region', 'DE');
  addRecentGame(620, 'Portal 2', null);
  assert.equal(getPref('region'), 'DE');
});

// ── recentGameChipHtml ───────────────────────────────────────────────────────

test('recentGameChipHtml: falls back to "App <appid>" when name is missing', () => {
  const html = mod().recentGameChipHtml({ appid: 620 });
  assert.ok(html.includes('App 620'));
});

test('recentGameChipHtml: drops a non-https thumbnail instead of rendering it', () => {
  const html = mod().recentGameChipHtml({ appid: 620, name: 'Portal 2', tinyImage: 'javascript:x' });
  assert.ok(!html.includes('javascript:'));
});

test('recentGameChipHtml: escapes the name', () => {
  const html = mod().recentGameChipHtml({ appid: 620, name: '<b>x</b>' });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

// ── renderRecentGamesBar / bindRecentGamesBar ────────────────────────────────

test('renderRecentGamesBar: hides the container when there is no history', () => {
  const el = fakeContainer();
  mod().renderRecentGamesBar(el);
  assert.equal(el.hidden, true);
});

test('renderRecentGamesBar: renders a chip per entry plus a Clear button', () => {
  const { addRecentGame, renderRecentGamesBar } = mod();
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  renderRecentGamesBar(el);
  assert.equal(el.hidden, false);
  assert.ok(el.innerHTML.includes('Portal 2'));
  assert.ok(el.innerHTML.includes('recents-clear'));
});

test('bindRecentGamesBar: clicking a chip calls onLoad with its appid and name', () => {
  const { addRecentGame, bindRecentGamesBar } = mod();
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  const loaded = [];
  bindRecentGamesBar(el, (appid, name) => loaded.push([appid, name]));
  el.click(fakeButton('recent-chip-btn', { appid: '620' }));
  assert.deepEqual(loaded, [[620, 'Portal 2']]);
});

test('bindRecentGamesBar: clicking remove deletes just that entry and re-renders', () => {
  const { addRecentGame, bindRecentGamesBar, loadRecentGames } = mod();
  addRecentGame(620, 'Portal 2', null);
  addRecentGame(400, 'Portal', null);
  const el = fakeContainer();
  bindRecentGamesBar(el, () => {});
  el.click(fakeButton('recent-chip-remove', { appid: '620' }));
  assert.deepEqual(loadRecentGames().map(g => g.appid), [400]);
  assert.ok(el.innerHTML.includes('Portal') && !el.innerHTML.includes('Portal 2'));
});

test('bindRecentGamesBar: clicking Clear empties the whole list and re-renders hidden', () => {
  const { addRecentGame, bindRecentGamesBar, loadRecentGames } = mod();
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  bindRecentGamesBar(el, () => {});
  el.click(fakeButton('recents-clear'));
  assert.deepEqual(loadRecentGames(), []);
  assert.equal(el.hidden, true);
});
