'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  GAME_SEARCH_DEBOUNCE_MS, GAME_SEARCH_MIN_CHARS, RECENT_GAMES_KEY, MAX_RECENT_GAMES,
  parseDirectAppid, computeGameSearchResultView, loadRecentGames, saveRecentGames, addRecentGame,
  removeRecentGame, computeRecentGameChipView,
} = require('../public/gameSearch.ts');

// Same localStorage-stub convention as accountsBar.test.js/region.test.js/prefs.test.js.
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

// `initGameSearch` itself (the debounced fetch/keyboard-nav widget, gameSearch.tsx) isn't
// covered here — it needs a real input/results element pair plus fetch/timer mocking for
// meaningful coverage, disproportionate to its risk next to the pure logic below, and its
// rendering is real JSX now besides (same "verified live, not unit-tested" precedent every
// other Solid-converted module in this codebase already follows). The pure pieces it's built
// from (parseDirectAppid, computeGameSearchResultView, the recent-games list) are what's tested.

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

// ── computeGameSearchResultView ──────────────────────────────────────────────

test('computeGameSearchResultView: passes the name and active flag through', () => {
  const v = computeGameSearchResultView({ appid: 620, name: 'Portal 2', tinyImage: null }, true);
  assert.equal(v.name, 'Portal 2');
  assert.equal(v.active, true);
});

test('computeGameSearchResultView: safeThumb is empty when tinyImage is absent', () => {
  const v = computeGameSearchResultView({ appid: 620, name: 'Portal 2', tinyImage: null }, false);
  assert.equal(v.safeThumb, '');
});

test('computeGameSearchResultView: keeps a real https tinyImage', () => {
  const v = computeGameSearchResultView({ appid: 620, name: 'Portal 2', tinyImage: 'https://x/y.jpg' }, false);
  assert.equal(v.safeThumb, 'https://x/y.jpg');
});

test('computeGameSearchResultView: drops a non-https tinyImage instead of exposing it', () => {
  const v = computeGameSearchResultView({ appid: 620, name: 'Portal 2', tinyImage: 'javascript:x' }, false);
  assert.equal(v.safeThumb, '');
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

// ── computeRecentGameChipView ─────────────────────────────────────────────────

test('computeRecentGameChipView: falls back to "App <appid>" when name is missing', () => {
  const v = computeRecentGameChipView({ appid: 620, name: '', tinyImage: null });
  assert.equal(v.label, 'App 620');
});

test('computeRecentGameChipView: drops a non-https thumbnail instead of exposing it', () => {
  const v = computeRecentGameChipView({ appid: 620, name: 'Portal 2', tinyImage: 'javascript:x' });
  assert.equal(v.safeThumb, '');
});

test('computeRecentGameChipView: keeps a real https thumbnail', () => {
  const v = computeRecentGameChipView({ appid: 620, name: 'Portal 2', tinyImage: 'https://x/y.jpg' });
  assert.equal(v.safeThumb, 'https://x/y.jpg');
});

test('GAME_SEARCH_DEBOUNCE_MS/GAME_SEARCH_MIN_CHARS: exported as the expected constants', () => {
  assert.equal(GAME_SEARCH_DEBOUNCE_MS, 300);
  assert.equal(GAME_SEARCH_MIN_CHARS, 2);
});
