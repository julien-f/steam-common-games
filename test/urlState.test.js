'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FILTER_DIMS, parseUrlState, reorderUrlParams,
  parseAccountParam, accountParamValues, withAccountParam, urlWithoutAccountParam, urlWithParams,
} = require('../public/urlState.ts');

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

// ── urlWithParams ───────────────────────────────────────────────────────────

test('urlWithParams: appends the query in canonical order', () => {
  const params = new URLSearchParams('?game=440&u=alice');
  assert.equal(urlWithParams(params, '/lists/owned'), '/lists/owned?u=alice&game=440');
});

test('urlWithParams: yields the bare pathname rather than a lone "?" once nothing is left', () => {
  const params = new URLSearchParams('?game=440');
  params.delete('game');
  assert.equal(urlWithParams(params, '/lists/owned'), '/lists/owned');
  assert.equal(urlWithParams(new URLSearchParams(), '/'), '/');
});

// ── ?u= — the account-override param ──────────────────────────────────────────

test('parseAccountParam: a single identifier is the explored account, with no extra slots', () => {
  assert.deepEqual(parseAccountParam('?u=alice'), { identifiers: ['alice'], extraSlots: [] });
});

test('parseAccountParam: comma-joined identifiers are one account (a Steam Family)', () => {
  assert.deepEqual(parseAccountParam('?u=alice,bob_family'), { identifiers: ['alice', 'bob_family'], extraSlots: [] });
});

test('parseAccountParam: an old multi-slot comparison link honors the first slot and reports the rest', () => {
  const { identifiers, extraSlots } = parseAccountParam('?u=alice&u=bob&u=carol,dave');
  assert.deepEqual(identifiers, ['alice']);
  assert.deepEqual(extraSlots, [['bob'], ['carol', 'dave']]);
});

test('parseAccountParam: no u= param (or an empty one) yields no identifiers', () => {
  assert.deepEqual(parseAccountParam('?game=440'), { identifiers: [], extraSlots: [] });
  assert.deepEqual(parseAccountParam('?u='), { identifiers: [], extraSlots: [] });
});

test('accountParamValues: returns the raw values, untouched, for forwarding', () => {
  assert.deepEqual(accountParamValues('?u=alice,bob&game=440&u=carol'), ['alice,bob', 'carol']);
  assert.deepEqual(accountParamValues('?game=440'), []);
});

test('withAccountParam: carries every u= value onto a bare path', () => {
  assert.equal(withAccountParam('/lists/owned', '?u=alice'), '/lists/owned?u=alice');
  assert.equal(withAccountParam('/game/440', '?u=alice&u=bob'), '/game/440?u=alice&u=bob');
});

test('withAccountParam: merges into a path that has its own query, in canonical param order', () => {
  assert.equal(withAccountParam('/lists/owned?game=440', '?u=alice'), '/lists/owned?u=alice&game=440');
});

test("withAccountParam: a path's own u= wins over the one being carried over", () => {
  assert.equal(withAccountParam('/lists/owned?u=bob', '?u=alice'), '/lists/owned?u=bob');
});

test('withAccountParam: returns the path untouched when there is no u= to carry', () => {
  assert.equal(withAccountParam('/lists/owned', '?game=440'), '/lists/owned');
  assert.equal(withAccountParam('/lists/owned?game=440', ''), '/lists/owned?game=440');
});

test('urlWithoutAccountParam: strips u= and keeps the rest of the query in canonical order', () => {
  assert.equal(
    urlWithoutAccountParam('/lists/owned', '?u=alice&game=440&tag=Indie'),
    '/lists/owned?game=440&tag=Indie',
  );
});

test('urlWithoutAccountParam: strips every value of a repeated u=', () => {
  assert.equal(urlWithoutAccountParam('/', '?u=alice&u=bob'), '/');
});

test('urlWithoutAccountParam: yields the bare pathname rather than a lone "?" when nothing else is left', () => {
  assert.equal(urlWithoutAccountParam('/lists/owned', '?u=alice'), '/lists/owned');
});

test('urlWithoutAccountParam: a URL with no u= at all comes back unchanged', () => {
  assert.equal(urlWithoutAccountParam('/lists/owned', '?game=440'), '/lists/owned?game=440');
});
