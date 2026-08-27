'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, scoreColor, fmtH, fmtPlaytime, fmtLastPlayed, esc, foldStr, renderScoreCell, renderMainCell, renderExtraCell, computeSteamdbRating, computeProductionTier, dealRecordTier } = require('../public/utils');

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

// ── fmtLastPlayed ─────────────────────────────────────────────────────────────

test('fmtLastPlayed: returns empty string for 0/null/undefined', () => {
  assert.equal(fmtLastPlayed(0), '');
  assert.equal(fmtLastPlayed(null), '');
  assert.equal(fmtLastPlayed(undefined), '');
});

test('fmtLastPlayed: formats a Unix timestamp as an ISO date', () => {
  assert.equal(fmtLastPlayed(1751846400), '2025-07-07');
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

// ── foldStr ───────────────────────────────────────────────────────────────────

test('foldStr: lowercases ASCII', () => {
  assert.equal(foldStr('Hello'), 'hello');
});

test('foldStr: strips acute accent', () => {
  assert.equal(foldStr('é'), 'e');
});

test('foldStr: strips umlaut', () => {
  assert.equal(foldStr('Ö'), 'o');
});

test('foldStr: strips mixed diacritics', () => {
  assert.equal(foldStr('Ångström'), 'angstrom');
});

test('foldStr: plain ASCII is unchanged (modulo case)', () => {
  assert.equal(foldStr('abc123'), 'abc123');
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

// ── computeSteamdbRating ───────────────────────────────────────────────────────

test('computeSteamdbRating: returns null with no reviews', () => {
  assert.equal(computeSteamdbRating(0, 0), null);
});

test('computeSteamdbRating: 90/100 lands around 87-88 at this app\'s shrink strength', () => {
  assert.equal(Math.round(computeSteamdbRating(90, 100)), 88);
});

test('computeSteamdbRating: pulls a tiny 100%-positive sample well below 100', () => {
  assert.ok(computeSteamdbRating(2, 2) < 80);
});

test('computeSteamdbRating: a large sample stays much closer to the raw ratio than a small one', () => {
  const raw = 97;
  const smallSampleDiff = Math.abs(computeSteamdbRating(97, 100) - raw);
  const largeSampleDiff = Math.abs(computeSteamdbRating(48500, 50000) - raw);
  assert.ok(largeSampleDiff < smallSampleDiff);
});

test('computeSteamdbRating: returns unrounded precision, not an integer', () => {
  const rating = computeSteamdbRating(9123, 10000);
  assert.notEqual(rating, Math.round(rating));
});

// ── computeProductionTier ───────────────────────────────────────────────────────

test('computeProductionTier: null for DLC/expansion appids, regardless of price', () => {
  assert.equal(computeProductionTier({ isDlc: true, priceInitial: 5999, reviewsTotal: 1000000 }), null);
});

test('computeProductionTier: null for non-game content types (e.g. a soundtrack), regardless of price', () => {
  assert.equal(computeProductionTier({ type: 'music', priceInitial: 5999, reviewsTotal: 1000000 }), null);
});

test('computeProductionTier: AAA at $50+ launch price, even with zero reviews (fresh release)', () => {
  assert.equal(computeProductionTier({ priceInitial: 5999, reviewsTotal: 0 }), 'AAA');
});

test('computeProductionTier: AA when priced $20-$50 with enough reviews', () => {
  assert.equal(computeProductionTier({ priceInitial: 2999, reviewsTotal: 25000 }), 'AA');
});

test('computeProductionTier: AA when priced $20-$50 with a Metacritic entry, even with few reviews', () => {
  assert.equal(computeProductionTier({ priceInitial: 2999, reviewsTotal: 100, hasMetacritic: true }), 'AA');
});

test('computeProductionTier: Indie when priced $20-$50 but neither reviews nor Metacritic clear the bar', () => {
  assert.equal(computeProductionTier({ priceInitial: 2499, reviewsTotal: 100 }), 'Indie');
});

test('computeProductionTier: Indie under $20 regardless of review count', () => {
  assert.equal(computeProductionTier({ priceInitial: 999, reviewsTotal: 500000 }), 'Indie');
});

test('computeProductionTier: free-to-play AAA needs very high review volume', () => {
  assert.equal(computeProductionTier({ isFree: true, reviewsTotal: 250000 }), 'AAA');
});

test('computeProductionTier: free-to-play without enough reviews defaults to Indie', () => {
  assert.equal(computeProductionTier({ isFree: true, reviewsTotal: 1000 }), 'Indie');
});

test('computeProductionTier: null when priced but priceInitial is missing (no price signal at all)', () => {
  assert.equal(computeProductionTier({ priceInitial: null, reviewsTotal: 500000 }), null);
});

// ── dealRecordTier ───────────────────────────────────────────────────────────────
// Single shared source for the Best Deal cell's badge, the side panel's Price card, and the
// Price Status column (renderBestDeal in bundles.js/library.js, priceHtml in panel.js,
// computePriceStatus/PRICE_STATUS_TIERS in bundles.js/library.js) — see its own comment in
// public/utils.js for why: hand-duplicating this tier logic in each place is exactly what let a
// 3-month-low tier go missing from two of them.

test('dealRecordTier: null when price is missing', () => {
  assert.equal(dealRecordTier(null, { lowAll: 10, lowY1: 15, lowM3: 20 }), null);
  assert.equal(dealRecordTier(undefined, { lowAll: 10, lowY1: 15, lowM3: 20 }), null);
});

test('dealRecordTier: null when price beats none of the three windows', () => {
  assert.equal(dealRecordTier(25, { lowAll: 10, lowY1: 15, lowM3: 20 }), null);
});

test('dealRecordTier: null when none of the three lows are known', () => {
  assert.equal(dealRecordTier(5, {}), null);
});

test('dealRecordTier: all-time low takes priority even when the price also matches 1yr/3mo', () => {
  const rec = dealRecordTier(10, { lowAll: 10, lowY1: 10, lowM3: 10 });
  assert.equal(rec.tier, 'all-time');
  assert.equal(rec.statusLabel, 'All-Time Low');
  assert.equal(rec.tooltipLabel, 'all-time low');
  assert.equal(rec.icon, '🔥');
  assert.equal(rec.bold, true);
});

test('dealRecordTier: 1yr low when it beats the 1yr/3mo windows but not the all-time one', () => {
  const rec = dealRecordTier(15, { lowAll: 10, lowY1: 15, lowM3: 15 });
  assert.equal(rec.tier, '1yr');
  assert.equal(rec.statusLabel, '1yr Low');
  assert.equal(rec.icon, '★');
  assert.ok(!rec.bold);
});

test('dealRecordTier: 3mo low when it beats only the 3mo window', () => {
  const rec = dealRecordTier(20, { lowAll: 10, lowY1: 15, lowM3: 20 });
  assert.equal(rec.tier, '3mo');
  assert.equal(rec.statusLabel, '3mo Low');
  assert.equal(rec.icon, '☆');
});

test('dealRecordTier: <= not < — a price equal to the historical low still counts as a record', () => {
  assert.equal(dealRecordTier(10, { lowAll: 10 }).tier, 'all-time');
});

test('dealRecordTier: a missing individual low is skipped in favor of a matching one further down the list', () => {
  const rec = dealRecordTier(20, { lowAll: null, lowY1: null, lowM3: 20 });
  assert.equal(rec.tier, '3mo');
});
