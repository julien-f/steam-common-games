'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupByOwnership } = require('../lib/groupGames');

function lib(...games) {
  return games.map(([appid, name]) => ({ appid, name }));
}

test('groupByOwnership: games owned by only one user are excluded', () => {
  const libraries = [
    lib([1, 'Solo Game']),
    lib([2, 'Other Game']),
  ];
  const groups = groupByOwnership(libraries);
  assert.equal(groups.length, 0);
});

test('groupByOwnership: games owned by all users form one group', () => {
  const libraries = [
    lib([1, 'Portal'], [2, 'Skyrim']),
    lib([1, 'Portal'], [2, 'Skyrim']),
    lib([1, 'Portal'], [2, 'Skyrim']),
  ];
  const groups = groupByOwnership(libraries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].userIndices, [0, 1, 2]);
  assert.equal(groups[0].games.length, 2);
});

test('groupByOwnership: groups by exact owner set, not just count', () => {
  const libraries = [
    lib([1, 'A']),          // user 0
    lib([1, 'A'], [2, 'B']), // user 1
    lib([2, 'B']),          // user 2
  ];
  // Game A → owned by {0, 1}, Game B → owned by {1, 2}
  const groups = groupByOwnership(libraries);
  assert.equal(groups.length, 2);

  const keys = groups.map(g => g.userIndices.join(','));
  assert.ok(keys.includes('0,1'));
  assert.ok(keys.includes('1,2'));
});

test('groupByOwnership: groups sorted by owner count descending', () => {
  const libraries = [
    lib([1, 'Common'], [2, 'Pair']),
    lib([1, 'Common'], [2, 'Pair']),
    lib([1, 'Common']),
  ];
  // 'Common' → {0,1,2}, 'Pair' → {0,1}
  const groups = groupByOwnership(libraries);
  assert.equal(groups[0].userIndices.length, 3);
  assert.equal(groups[1].userIndices.length, 2);
});

test('groupByOwnership: same-size groups sorted by first owner index', () => {
  const libraries = [
    lib([1, 'A']),                   // user 0
    lib([1, 'A'], [2, 'B']),         // user 1
    lib([2, 'B']),                   // user 2
  ];
  // {0,1} first (lower first index), then {1,2}
  const groups = groupByOwnership(libraries);
  assert.deepEqual(groups[0].userIndices, [0, 1]);
  assert.deepEqual(groups[1].userIndices, [1, 2]);
});

test('groupByOwnership: games within a group sorted alphabetically', () => {
  const libraries = [
    lib([3, 'Zork'], [1, 'Alpha'], [2, 'Myst']),
    lib([3, 'Zork'], [1, 'Alpha'], [2, 'Myst']),
  ];
  const groups = groupByOwnership(libraries);
  const names = groups[0].games.map(g => g.name);
  assert.deepEqual(names, ['Alpha', 'Myst', 'Zork']);
});

test('groupByOwnership: two users with partial overlap', () => {
  const libraries = [
    lib([1, 'Shared'], [2, 'OnlyA']),
    lib([1, 'Shared'], [3, 'OnlyB']),
  ];
  const groups = groupByOwnership(libraries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].userIndices, [0, 1]);
  assert.equal(groups[0].games.length, 1);
  assert.equal(groups[0].games[0].name, 'Shared');
});

test('groupByOwnership: empty libraries', () => {
  assert.deepEqual(groupByOwnership([[], []]), []);
});

test('groupByOwnership: preserves appid in output', () => {
  const libraries = [
    lib([42, 'Portal']),
    lib([42, 'Portal']),
  ];
  const groups = groupByOwnership(libraries);
  assert.equal(groups[0].games[0].appid, 42);
});

