'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');

// @vates/data-table-solid touches `window` on load; the helpers gameColumns.ts uses are core's,
// re-exported. Drop once it loads in Node.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === '@vates/data-table-solid' ? '@vates/data-table-core' : specifier, context);
  },
});

const {
  endOfReleasePeriod,
  releaseSortTimestamp,
  computePriceStatus,
  computeOwnershipStatus,
  priceTierBucket,
  scoreBucket,
  halfDecadeBucket,
  withMissingGroup,
} = require('../public/gameColumns.ts');

const day = (y, m, d) => new Date(y, m - 1, d).getTime();

test('endOfReleasePeriod: anchors a coarse date at the end of its period', () => {
  for (const [input, expected] of [
    ['Spring 2026', day(2026, 6, 20)],
    ['Summer 2026', day(2026, 9, 21)],
    ['Fall 2026', day(2026, 12, 20)],
    ['Autumn 2026', day(2026, 12, 20)],
    ['fall 2026', day(2026, 12, 20)],
    ['Winter 2026', day(2027, 3, 19)], // winter spills into the next year
    ['Q1 2026', day(2026, 3, 31)],
    ['Q2 2026', day(2026, 6, 30)],
    ['Q3 2026', day(2026, 9, 30)],
    ['Q4 2026', day(2026, 12, 31)],
    ['q4 2026', day(2026, 12, 31)],
    ['2026', day(2026, 12, 31) + 1],
    ['2026 or later', day(2026, 12, 31) + 1],
    ['October 2026', day(2026, 10, 31)],
    ['February 2024', day(2024, 2, 29)],
    ['  Q2 2026  ', day(2026, 6, 30)],
    ['Oct 14, 2025', day(2025, 10, 14)],
  ]) {
    assert.equal(endOfReleasePeriod(input), expected, input);
  }
});

test('endOfReleasePeriod: placeholders have no date, so range filters and date-tree skip them', () => {
  for (const input of ['Coming soon', 'To be announced', 'TBA', 'nonsense']) {
    assert.ok(Number.isNaN(endOfReleasePeriod(input)), input);
  }
});

test('releaseSortTimestamp: placeholders sort after every date, Coming soon before TBA', () => {
  const expected = [
    'Oct 14, 2026',
    'October 2026',
    'Fall 2026',
    'Q4 2026',
    '2026', // just after Q4 of the same year
    'Winter 2026',
    'Q1 2027',
    '2999',
    'Coming soon',
    'TBA',
  ];
  const sorted = [...expected].reverse().sort((a, b) => releaseSortTimestamp(a) - releaseSortTimestamp(b));
  assert.deepEqual(sorted, expected);
});

test('releaseSortTimestamp: placeholder spellings and plain dates', () => {
  assert.equal(releaseSortTimestamp('coming soon'), releaseSortTimestamp('Coming soon'));
  assert.equal(releaseSortTimestamp('To be announced'), releaseSortTimestamp('TBA'));
  assert.equal(releaseSortTimestamp(' tba '), releaseSortTimestamp('TBA'));
  assert.equal(releaseSortTimestamp('Q3 2026'), day(2026, 9, 30));
  assert.ok(Number.isNaN(releaseSortTimestamp('nonsense')));
});

test('computePriceStatus: loading, no data, record tiers, sale, full price', () => {
  for (const [name, row, expected] of [
    ['still loading', {}, undefined],
    ['no price data', { bestDealPrice: null }, null],
    ['at the all-time low', { bestDealPrice: 10, lowAll: 10, lowY1: 10, lowM3: 10, bestDealCut: 50 }, 'All-Time Low'],
    ['below the all-time low', { bestDealPrice: 9, lowAll: 10, bestDealCut: 50 }, 'All-Time Low'],
    ['1-year low', { bestDealPrice: 10, lowAll: 5, lowY1: 10, lowM3: 10, bestDealCut: 50 }, '1-Year Low'],
    ['3-month low', { bestDealPrice: 10, lowAll: 5, lowY1: 8, lowM3: 10, bestDealCut: 50 }, '3-Month Low'],
    ['discounted, not a low', { bestDealPrice: 10, lowAll: 5, lowY1: 8, lowM3: 9, bestDealCut: 25 }, 'On Sale'],
    ['confirmed full price', { bestDealPrice: 20, lowAll: 5, bestDealCut: 0 }, 'Not Discounted'],
    ['no discount data', { bestDealPrice: 20, lowAll: 5, bestDealCut: null }, null],
  ]) {
    assert.equal(computePriceStatus(row), expected, name);
  }
});

test('computeOwnershipStatus: unknown vs. each combination', () => {
  for (const [row, expected] of [
    [{}, null],
    [{ inLibrary: null, onWishlist: null }, null],
    [{ inLibrary: false, onWishlist: false }, 'Not Owned'],
    [{ inLibrary: true, onWishlist: false }, 'Owned'],
    [{ inLibrary: false, onWishlist: true }, 'Wishlisted'],
    [{ inLibrary: true, onWishlist: true }, 'Owned & Wishlisted'],
  ]) {
    assert.equal(computeOwnershipStatus(row), expected, JSON.stringify(row));
  }
});

test("priceTierBucket: Steam's price tiers, Free apart from cheap", () => {
  for (const [input, expected] of [
    [0, -1],
    [0.01, 0],
    [4.99, 0],
    [5, 5],
    [14.99, 5],
    [15, 15],
    [29.99, 15],
    [30, 30],
    [49.99, 30],
    [50, 50],
    [74.99, 50],
    [75, 75],
    [99.99, 75],
    [100, 100],
    [500, 100],
    [-1, null],
    [NaN, null],
    [undefined, null],
  ]) {
    assert.equal(priceTierBucket(input), expected, String(input));
  }
  assert.equal(withMissingGroup(priceTierBucket)(null), null, 'a missing price is not Free');
});

test('scoreBucket: 5-point steps from 60, one bucket below, 100 folded into 95', () => {
  for (const [input, expected] of [
    [0, -1],
    [59.99, -1],
    [NaN, -1],
    [60, 60],
    [64.9, 60],
    [65, 65],
    [94.99, 90],
    [95, 95],
    [99.6, 95],
    [100, 95],
  ]) {
    assert.equal(scoreBucket(input), expected, String(input));
  }
});

test('halfDecadeBucket: 1-3-10 log steps, zero apart from below one', () => {
  for (const [input, expected] of [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2.9, 1],
    [3, 3],
    [9.9, 3],
    [10, 10],
    [29, 10],
    [30, 30],
    [99, 30],
    [100, 100],
    [2_500_000, 1_000_000],
  ]) {
    assert.equal(halfDecadeBucket(input), expected, String(input));
  }
  assert.equal(withMissingGroup(halfDecadeBucket)(null), null, 'a failed fetch is not zero');
});
