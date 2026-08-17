'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FILTER_DIMS, parseUrlState, reorderUrlParams } = require('../public/urlState');

// ── parseUrlState — slots ─────────────────────────────────────────────────────

test('parseUrlState: parses two single-account slots', () => {
  const { slots } = parseUrlState('?u=alice&u=bob');
  assert.deepEqual(slots, [['alice'], ['bob']]);
});

test('parseUrlState: parses a multi-account slot (Steam Family)', () => {
  const { slots } = parseUrlState('?u=alice,bob_family');
  assert.deepEqual(slots, [['alice', 'bob_family']]);
});

test('parseUrlState: trims whitespace inside slots', () => {
  const { slots } = parseUrlState('?u=alice%2C+bob');
  assert.deepEqual(slots, [['alice', 'bob']]);
});

test('parseUrlState: slots is empty when no u= params', () => {
  const { slots } = parseUrlState('?game=12345');
  assert.deepEqual(slots, []);
});

// ── parseUrlState — game & shot ───────────────────────────────────────────────

test('parseUrlState: parses game appid', () => {
  const { game } = parseUrlState('?game=1307580');
  assert.equal(game, 1307580);
});

test('parseUrlState: game is null when absent', () => {
  const { game } = parseUrlState('?u=alice');
  assert.equal(game, null);
});

test('parseUrlState: parses shot param', () => {
  assert.equal(parseUrlState('?shot=banner').shot, 'banner');
  assert.equal(parseUrlState('?shot=v256810').shot, 'v256810');
  assert.equal(parseUrlState('?shot=s0').shot, 's0');
});

test('parseUrlState: shot is null when absent', () => {
  assert.equal(parseUrlState('?game=12345').shot, null);
});

// ── parseUrlState — sort ──────────────────────────────────────────────────────

test('parseUrlState: parses descending sort', () => {
  const { sort } = parseUrlState('?sort=-score');
  assert.deepEqual(sort, { col: 'score', dir: -1 });
});

test('parseUrlState: parses ascending sort', () => {
  const { sort } = parseUrlState('?sort=name');
  assert.deepEqual(sort, { col: 'name', dir: 1 });
});

test('parseUrlState: sort is null when absent', () => {
  assert.equal(parseUrlState('?u=alice').sort, null);
});

// ── parseUrlState — filters ───────────────────────────────────────────────────

test('parseUrlState: parses multi-value tag filter', () => {
  const { filters } = parseUrlState('?tag=Action&tag=RPG');
  assert.deepEqual(filters.tags, ['Action', 'RPG']);
});

test('parseUrlState: all filter keys present and empty when absent', () => {
  const { filters } = parseUrlState('?u=alice');
  for (const dim of FILTER_DIMS) {
    assert.deepEqual(filters[dim.key], [], `expected empty array for ${dim.key}`);
  }
});

test('parseUrlState: parses name filter', () => {
  const { nameFilter } = parseUrlState('?name=portal');
  assert.equal(nameFilter, 'portal');
});

test('parseUrlState: nameFilter is empty string when absent', () => {
  const { nameFilter } = parseUrlState('?u=alice');
  assert.equal(nameFilter, '');
});

// ── FILTER_DIMS ───────────────────────────────────────────────────────────────

test('FILTER_DIMS: has expected keys', () => {
  const keys = FILTER_DIMS.map(d => d.key);
  assert.deepEqual(keys, ['tags', 'genres', 'categories', 'developers', 'publishers']);
});

// ── reorderUrlParams ────────────────────────────────────────────────────────

test('reorderUrlParams: sorts known params into a fixed canonical order regardless of input order', () => {
  const params = new URLSearchParams('?name=portal&game=440&u=alice&sort=-score&tag=Indie');
  assert.equal(reorderUrlParams(params).toString(), 'u=alice&sort=-score&game=440&name=portal&tag=Indie');
});

test('reorderUrlParams: two equivalent states with fields set in different orders serialize identically', () => {
  const a = reorderUrlParams(new URLSearchParams('?u=alice&game=440&name=portal'));
  const b = reorderUrlParams(new URLSearchParams('?name=portal&u=alice&game=440'));
  assert.equal(a.toString(), b.toString());
});

test('reorderUrlParams: preserves repeated-key relative order (multiple u/tag values)', () => {
  const params = new URLSearchParams('?tag=Indie&u=bob&tag=Coop&u=alice');
  assert.equal(reorderUrlParams(params).toString(), 'u=bob&u=alice&tag=Indie&tag=Coop');
});

test('reorderUrlParams: appends unknown params after every known one, preserving their order', () => {
  const params = new URLSearchParams('?foo=1&u=alice&bar=2');
  assert.equal(reorderUrlParams(params).toString(), 'u=alice&foo=1&bar=2');
});

test('reorderUrlParams: empty input yields empty output', () => {
  assert.equal(reorderUrlParams(new URLSearchParams()).toString(), '');
});
