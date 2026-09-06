'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GAME_SEARCH_DEBOUNCE_MS, GAME_SEARCH_MIN_CHARS, parseDirectAppid, gameSearchResultHtml,
} = require('../public/gameSearch.ts');

// `initGameSearch` itself (the debounced fetch/keyboard-nav widget) isn't covered here — it
// needs a real input/results element pair plus fetch/timer mocking for meaningful coverage,
// disproportionate to its risk next to the pure logic below. The pure pieces it's built from
// (parseDirectAppid, gameSearchResultHtml) are what's tested. The "recently looked up games"
// storage/widget this file used to also cover moved to recentGames.test.js, alongside the
// module it now lives in (recentGames.ts) — see docs/list-centric-redesign.md's Phase 1.

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

test('GAME_SEARCH_DEBOUNCE_MS/GAME_SEARCH_MIN_CHARS: exported as the expected constants', () => {
  assert.equal(GAME_SEARCH_DEBOUNCE_MS, 300);
  assert.equal(GAME_SEARCH_MIN_CHARS, 2);
});

test('gameSearchResultHtml: no ownership markers when the ownership arg is omitted/null', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false);
  assert.ok(!html.includes('game-search-badge'));
});

test('gameSearchResultHtml: renders an owned marker', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false, { inLibrary: true, onWishlist: false });
  assert.ok(html.includes('game-search-badge owned'));
  assert.ok(!html.includes('game-search-badge wishlisted'));
});

test('gameSearchResultHtml: renders a wishlisted marker', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false, { inLibrary: false, onWishlist: true });
  assert.ok(!html.includes('game-search-badge owned'));
  assert.ok(html.includes('game-search-badge wishlisted'));
});

test('gameSearchResultHtml: renders both markers when both are true', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false, { inLibrary: true, onWishlist: true });
  assert.ok(html.includes('game-search-badge owned'));
  assert.ok(html.includes('game-search-badge wishlisted'));
});

test('gameSearchResultHtml: no markers when both are false', () => {
  const html = gameSearchResultHtml({ appid: 620, name: 'Portal 2' }, false, { inLibrary: false, onWishlist: false });
  assert.ok(!html.includes('game-search-badge'));
});
