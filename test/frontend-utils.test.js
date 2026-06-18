'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, scoreColor, fmtH, fmtPlaytime, esc, renderScoreCell, renderMainCell, renderExtraCell } = require('../public/utils');

// ── normalizeInput ────────────────────────────────────────────────────────────

test('normalizeInput: returns plain usernames unchanged', () => {
  assert.equal(normalizeInput('gaben'), 'gaben');
});

test('normalizeInput: extracts username from /id/ URL', () => {
  assert.equal(normalizeInput('https://steamcommunity.com/id/gaben/'), 'gaben');
});

test('normalizeInput: extracts username from /id/ URL without protocol', () => {
  assert.equal(normalizeInput('steamcommunity.com/id/gaben'), 'gaben');
});

test('normalizeInput: extracts 64-bit ID from /profiles/ URL', () => {
  assert.equal(normalizeInput('https://steamcommunity.com/profiles/76561198000000001'), '76561198000000001');
});

test('normalizeInput: returns non-Steam URLs unchanged', () => {
  const url = 'https://store.steampowered.com/app/400';
  assert.equal(normalizeInput(url), url);
});

test('normalizeInput: returns plain Steam64 ID unchanged', () => {
  assert.equal(normalizeInput('76561198000000001'), '76561198000000001');
});

// ── scoreColor ────────────────────────────────────────────────────────────────

test('scoreColor: returns text1 color for null', () => {
  assert.equal(scoreColor(null), 'var(--text1)');
});

test('scoreColor: returns text1 color for undefined', () => {
  assert.equal(scoreColor(undefined), 'var(--text1)');
});

test('scoreColor: 80 returns blue (top tier)', () => {
  assert.equal(scoreColor(80), '#57cbde');
  assert.equal(scoreColor(100), '#57cbde');
});

test('scoreColor: 79 returns green (second tier)', () => {
  assert.equal(scoreColor(79), '#a3cf4e');
  assert.equal(scoreColor(65), '#a3cf4e');
});

test('scoreColor: 64 returns orange (third tier)', () => {
  assert.equal(scoreColor(64), '#e4a82e');
  assert.equal(scoreColor(50), '#e4a82e');
});

test('scoreColor: 49 returns red (bottom tier)', () => {
  assert.equal(scoreColor(49), '#cc5050');
  assert.equal(scoreColor(0), '#cc5050');
});

// ── fmtH ─────────────────────────────────────────────────────────────────────

test('fmtH: returns dim dash for null', () => {
  assert.equal(fmtH(null), '<span class="dim">—</span>');
});

test('fmtH: returns dim dash for undefined', () => {
  assert.equal(fmtH(undefined), '<span class="dim">—</span>');
});

test('fmtH: formats integer hours without decimal', () => {
  assert.equal(fmtH(10), '10h');
});

test('fmtH: formats float that is a whole number without decimal', () => {
  assert.equal(fmtH(10.0), '10h');
});

test('fmtH: formats non-integer hours to one decimal place', () => {
  assert.equal(fmtH(10.5), '10.5h');
  assert.equal(fmtH(1.25), '1.3h');
});

// ── esc ───────────────────────────────────────────────────────────────────────

test('esc: passes safe strings through unchanged', () => {
  assert.equal(esc('hello world'), 'hello world');
});

test('esc: encodes ampersands', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
});

test('esc: encodes angle brackets', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
});

test('esc: encodes double quotes', () => {
  assert.equal(esc('"quoted"'), '&quot;quoted&quot;');
});

test('esc: handles multiple special chars in one string', () => {
  assert.equal(esc('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;');
});

test('esc: coerces non-string input via String()', () => {
  assert.equal(esc(42), '42');
});

// ── fmtPlaytime ───────────────────────────────────────────────────────────────

test('fmtPlaytime: returns empty string for 0', () => {
  assert.equal(fmtPlaytime(0), '');
});

test('fmtPlaytime: returns empty string for null/undefined', () => {
  assert.equal(fmtPlaytime(null), '');
  assert.equal(fmtPlaytime(undefined), '');
});

test('fmtPlaytime: formats minutes under an hour', () => {
  assert.equal(fmtPlaytime(47), '47m');
  assert.equal(fmtPlaytime(1), '1m');
});

test('fmtPlaytime: formats exactly 60 minutes as 1h', () => {
  assert.equal(fmtPlaytime(60), '1h');
});

test('fmtPlaytime: rounds to nearest hour above 60 minutes', () => {
  assert.equal(fmtPlaytime(90), '2h');
  assert.equal(fmtPlaytime(120), '2h');
});

// ── renderScoreCell ───────────────────────────────────────────────────────────

test('renderScoreCell: returns skeleton for loading game', () => {
  assert.equal(renderScoreCell({ loading: true }), '<span class="sk"></span>');
});

test('renderScoreCell: returns dim dash when loaded but no rating', () => {
  assert.equal(renderScoreCell({ loading: false, details: {} }), '<span class="dim">—</span>');
  assert.equal(renderScoreCell({ loading: false, details: null }), '<span class="dim">—</span>');
});

test('renderScoreCell: renders score and description when rating present', () => {
  const game = { loading: false, details: { rating: { score: 85, desc: 'Very Positive' } } };
  const html = renderScoreCell(game);
  assert.ok(html.includes('85'));
  assert.ok(html.includes('Very Positive'));
  assert.ok(html.includes('score-num'));
  assert.ok(html.includes('#57cbde')); // score 85 → blue tier
});

// ── renderMainCell ────────────────────────────────────────────────────────────

test('renderMainCell: returns small skeleton for loading game', () => {
  assert.equal(renderMainCell({ loading: true }), '<span class="sk sm"></span>');
});

test('renderMainCell: returns dim dash when loaded but no hltb', () => {
  assert.equal(renderMainCell({ loading: false, details: {} }), '<span class="dim">—</span>');
});

test('renderMainCell: formats main story hours', () => {
  assert.equal(renderMainCell({ loading: false, details: { hltb: { main: 12, extra: 20 } } }), '12h');
});

// ── renderExtraCell ───────────────────────────────────────────────────────────

test('renderExtraCell: returns small skeleton for loading game', () => {
  assert.equal(renderExtraCell({ loading: true }), '<span class="sk sm"></span>');
});

test('renderExtraCell: returns dim dash when loaded but no hltb', () => {
  assert.equal(renderExtraCell({ loading: false, details: {} }), '<span class="dim">—</span>');
});

test('renderExtraCell: formats main + extra hours', () => {
  assert.equal(renderExtraCell({ loading: false, details: { hltb: { main: 12, extra: 25.5 } } }), '25.5h');
});
