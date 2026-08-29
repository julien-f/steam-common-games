'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  GAME_SEARCH_DEBOUNCE_MS, GAME_SEARCH_MIN_CHARS, RECENT_GAMES_KEY, MAX_RECENT_GAMES,
  parseDirectAppid, gameSearchResultHtml, loadRecentGames, saveRecentGames, addRecentGame,
  removeRecentGame, recentGameChipHtml, renderRecentGamesBar, bindRecentGamesBar,
} = require('../public/gameSearch');

// Same localStorage-stub convention as accountsBar.test.js/region.test.js/prefs.test.js.
function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

// Same minimal fake-DOM shape as accountsBar.test.js — enough for innerHTML/hidden and the
// `e.target.closest('.some-class')` delegation pattern, no jsdom needed.
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
});

// `initGameSearch` itself (the debounced fetch/keyboard-nav widget) isn't covered here — it
// needs a real input/results element pair plus fetch/timer mocking for meaningful coverage,
// disproportionate to its risk next to the pure logic below. The pure pieces it's built from
// (parseDirectAppid, gameSearchResultHtml, the recent-games list) are what's tested.

// ── parseDirectAppid ─────────────────────────────────────────────────────────

test('parseDirectAppid: recognizes a bare numeric appid', () => {
  assert.equal(parseDirectAppid('1245620'), 1245620);
});

test('parseDirectAppid: recognizes an appid embedded in a store URL', () => {
  assert.equal(parseDirectAppid('https://store.steampowered.com/app/1245620/ELDEN_RING/'), 1245620);
  assert.equal(parseDirectAppid('store.steampowered.com/app/1245620'), 1245620);
});

test('parseDirectAppid: trims surrounding whitespace', () => {
  assert.equal(parseDirectAppid('  1245620  '), 1245620);
});

test('parseDirectAppid: returns null for a plain game name', () => {
  assert.equal(parseDirectAppid('Elden Ring'), null);
});

test('parseDirectAppid: returns null for a non-numeric string that merely contains digits', () => {
  assert.equal(parseDirectAppid('Portal 2'), null);
});

// ── gameSearchResultHtml ─────────────────────────────────────────────────────

test('gameSearchResultHtml: escapes the name and marks the active result', () => {
  const html = gameSearchResultHtml({ appid: 620, name: '<b>Portal 2</b>' }, true);
  assert.ok(html.includes('&lt;b&gt;Portal 2&lt;/b&gt;'));
  assert.ok(html.includes('class="game-search-result active"'));
  assert.ok(html.includes('aria-selected="true"'));
});

test('gameSearchResultHtml: renders a placeholder thumb when tinyImage is absent', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false);
  assert.ok(html.includes('game-search-thumb--empty'));
  assert.ok(!html.includes('<img'));
});

test('gameSearchResultHtml: renders an <img> thumb when tinyImage is present', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2', tinyImage: 'https://x/y.jpg' }, false);
  assert.ok(html.includes('<img class="game-search-thumb" src="https://x/y.jpg"'));
});

// ── Recent games list ────────────────────────────────────────────────────────

test('loadRecentGames: returns [] when nothing was ever stored', () => {
  assert.deepEqual(loadRecentGames(), []);
});

test('loadRecentGames: returns [] when the stored value is corrupt/not an array', () => {
  global.localStorage.setItem(RECENT_GAMES_KEY, '{not json');
  assert.deepEqual(loadRecentGames(), []);
});

test('addRecentGame/loadRecentGames: round-trips an entry, defaulting a missing thumbnail to null', () => {
  addRecentGame(620, 'Portal 2', null);
  assert.deepEqual(loadRecentGames(), [{ appid: 620, name: 'Portal 2', tinyImage: null }]);
});

test('addRecentGame: re-adding an existing appid moves it to the front instead of duplicating it', () => {
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
  for (let i = 0; i < MAX_RECENT_GAMES + 3; i++) addRecentGame(i, `Game ${i}`, null);
  const recents = loadRecentGames();
  assert.equal(recents.length, MAX_RECENT_GAMES);
  assert.equal(recents[0].appid, MAX_RECENT_GAMES + 2); // most recent first
  assert.equal(recents.at(-1).appid, 3); // games 0-2 were dropped
});

test('removeRecentGame: removes only the matching appid', () => {
  addRecentGame(620, 'Portal 2', null);
  addRecentGame(400, 'Portal', null);
  removeRecentGame(620);
  assert.deepEqual(loadRecentGames().map(g => g.appid), [400]);
});

// ── recentGameChipHtml ───────────────────────────────────────────────────────

test('recentGameChipHtml: falls back to "App <appid>" when name is missing', () => {
  const html = recentGameChipHtml({ appid: 620 });
  assert.ok(html.includes('App 620'));
});

test('recentGameChipHtml: drops a non-https thumbnail instead of rendering it', () => {
  const html = recentGameChipHtml({ appid: 620, name: 'Portal 2', tinyImage: 'javascript:x' });
  assert.ok(!html.includes('javascript:'));
});

test('recentGameChipHtml: escapes the name', () => {
  const html = recentGameChipHtml({ appid: 620, name: '<b>x</b>' });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

// ── renderRecentGamesBar / bindRecentGamesBar ────────────────────────────────

test('renderRecentGamesBar: hides the container when there is no history', () => {
  const el = fakeContainer();
  renderRecentGamesBar(el);
  assert.equal(el.hidden, true);
});

test('renderRecentGamesBar: renders a chip per entry plus a Clear button', () => {
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  renderRecentGamesBar(el);
  assert.equal(el.hidden, false);
  assert.ok(el.innerHTML.includes('Portal 2'));
  assert.ok(el.innerHTML.includes('recents-clear'));
});

test('bindRecentGamesBar: clicking a chip calls onLoad with its appid and name', () => {
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  const loaded = [];
  bindRecentGamesBar(el, (appid, name) => loaded.push([appid, name]));
  el.click(fakeButton('recent-chip-btn', { appid: '620' }));
  assert.deepEqual(loaded, [[620, 'Portal 2']]);
});

test('bindRecentGamesBar: clicking remove deletes just that entry and re-renders', () => {
  addRecentGame(620, 'Portal 2', null);
  addRecentGame(400, 'Portal', null);
  const el = fakeContainer();
  bindRecentGamesBar(el, () => {});
  el.click(fakeButton('recent-chip-remove', { appid: '620' }));
  assert.deepEqual(loadRecentGames().map(g => g.appid), [400]);
  assert.ok(el.innerHTML.includes('Portal') && !el.innerHTML.includes('Portal 2'));
});

test('bindRecentGamesBar: clicking Clear empties the whole list and re-renders hidden', () => {
  addRecentGame(620, 'Portal 2', null);
  const el = fakeContainer();
  bindRecentGamesBar(el, () => {});
  el.click(fakeButton('recents-clear'));
  assert.deepEqual(loadRecentGames(), []);
  assert.equal(el.hidden, true);
});

test('GAME_SEARCH_DEBOUNCE_MS/GAME_SEARCH_MIN_CHARS: exported as the expected constants', () => {
  assert.equal(GAME_SEARCH_DEBOUNCE_MS, 300);
  assert.equal(GAME_SEARCH_MIN_CHARS, 2);
});
