'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { union, intersect, subtract, groupByMembership, combine } = require('../public/combine.ts');

function set(...ids) {
  return new Set(ids);
}

// ── union ────────────────────────────────────────────────────────────────────────────────────

test('union: combines every set, deduping overlaps', () => {
  assert.deepEqual(union([set(1, 2), set(2, 3), set(3, 4)]), set(1, 2, 3, 4));
});

test('union: empty input yields an empty set', () => {
  assert.deepEqual(union([]), set());
});

test('union: a single set returns its own members', () => {
  assert.deepEqual(union([set(1, 2)]), set(1, 2));
});

// ── intersect ────────────────────────────────────────────────────────────────────────────────

test('intersect: only members present in every set', () => {
  assert.deepEqual(intersect([set(1, 2, 3), set(2, 3, 4), set(2, 5)]), set(2));
});

test('intersect: no overlap yields an empty set', () => {
  assert.deepEqual(intersect([set(1), set(2)]), set());
});

test('intersect: empty input yields an empty set', () => {
  assert.deepEqual(intersect([]), set());
});

test('intersect: a single set returns its own members, and does not mutate the input', () => {
  const input = set(1, 2);
  const result = intersect([input]);
  assert.deepEqual(result, set(1, 2));
  assert.notEqual(result, input);
});

// ── subtract ─────────────────────────────────────────────────────────────────────────────────

test('subtract: first set minus every other set', () => {
  assert.deepEqual(subtract([set(1, 2, 3, 4), set(2), set(4)]), set(1, 3));
});

test('subtract: a single set (nothing to subtract) returns it unchanged', () => {
  assert.deepEqual(subtract([set(1, 2)]), set(1, 2));
});

test('subtract: empty input yields an empty set', () => {
  assert.deepEqual(subtract([]), set());
});

test('subtract: does not mutate the original first set', () => {
  const first = set(1, 2);
  subtract([first, set(1)]);
  assert.deepEqual(first, set(1, 2));
});

// ── groupByMembership ────────────────────────────────────────────────────────────────────────

test('groupByMembership: groups appids by exactly which sources they belong to', () => {
  const groups = groupByMembership([
    { key: 'alice', appids: set(1, 2, 3) },
    { key: 'bob', appids: set(2, 3, 4) },
    { key: 'carol', appids: set(3) },
  ]);

  const byKeys = Object.fromEntries(groups.map(g => [g.keys.join(','), g.appids.sort()]));
  assert.deepEqual(byKeys['alice,bob,carol'], [3]);
  assert.deepEqual(byKeys['alice,bob'], [2]);
  assert.deepEqual(byKeys['alice'], [1]);
  assert.deepEqual(byKeys['bob'], [4]);
});

test('groupByMembership: orders groups most-sources-first ("most owners to fewest")', () => {
  const groups = groupByMembership([
    { key: 'a', appids: set(1) },
    { key: 'b', appids: set(1, 2) },
    { key: 'c', appids: set(1, 2, 3) },
  ]);
  const sizes = groups.map(g => g.keys.length);
  assert.deepEqual(sizes, [...sizes].sort((x, y) => y - x));
});

test('groupByMembership: a game absent from every source never appears in any group', () => {
  const groups = groupByMembership([{ key: 'a', appids: set(1) }, { key: 'b', appids: set(2) }]);
  const allAppids = groups.flatMap(g => g.appids);
  assert.equal(allAppids.includes(99), false);
});

test('groupByMembership: no sources yields no groups', () => {
  assert.deepEqual(groupByMembership([]), []);
});

// ── combine (dispatch) ───────────────────────────────────────────────────────────────────────

test('combine: dispatches to union/intersect/subtract, discarding keys', () => {
  const sources = [{ key: 'a', appids: set(1, 2) }, { key: 'b', appids: set(2, 3) }];
  assert.deepEqual(combine('union', sources), set(1, 2, 3));
  assert.deepEqual(combine('intersect', sources), set(2));
  assert.deepEqual(combine('subtract', sources), set(1));
});

test('combine: dispatches group-by-membership using the labeled sources directly', () => {
  const sources = [{ key: 'a', appids: set(1) }, { key: 'b', appids: set(1, 2) }];
  const result = combine('group-by-membership', sources);
  assert.equal(Array.isArray(result), true);
});
