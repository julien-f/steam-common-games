'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  membershipLabel,
  membershipColumn,
  membershipKey,
  withMembershipGrouping,
  withoutMembershipGrouping,
  MEMBERSHIP_KEY,
} = require('../public/membershipColumn.ts');

const SOURCES = ['a', 'b', 'c'];
const NAMES = new Map([
  ['a', 'Alice'],
  ['b', 'Bob'],
  ['c', 'Carol'],
]);

test('membershipLabel: says who is in and who is missing', () => {
  assert.equal(membershipLabel(['a', 'b', 'c'], SOURCES, NAMES), 'All 3');
  assert.equal(membershipLabel(['a', 'b'], ['a', 'b'], NAMES), 'Both');
  assert.equal(membershipLabel(['a', 'c'], SOURCES, NAMES), 'Alice + Carol — not Bob');
  assert.equal(membershipLabel(['b'], SOURCES, NAMES), 'Only Bob');
});

test("membershipColumn: groups keep combine.ts's order, and read as their label", () => {
  const groups = [
    { keys: ['a', 'b', 'c'], appids: [1] },
    { keys: ['a', 'b'], appids: [2] },
    { keys: ['c'], appids: [3] },
  ];
  const col = membershipColumn(groups, SOURCES, NAMES, true);
  assert.equal(col.key, MEMBERSHIP_KEY);
  assert.equal(col.label, 'Owned by');
  const keys = groups.map(membershipKey);
  assert.deepEqual(
    [...keys].reverse().sort((x, y) => col.compare(x, y, 'asc')),
    keys,
  );
  assert.equal(col.format(keys[1]), 'Alice + Bob — not Carol');
});

test("withMembershipGrouping: membership groups and sorts first; the viewer's own come after", () => {
  const m = { key: MEMBERSHIP_KEY, dir: 'asc' };
  assert.deepEqual(withMembershipGrouping({}), { groupBy: [MEMBERSHIP_KEY], sorts: [m] });
  const flat = withMembershipGrouping({ groupBy: [], sorts: [{ key: 'name', dir: 'asc' }] });
  assert.deepEqual(flat.groupBy, [MEMBERSHIP_KEY], 'a flat view saved from Intersect');
  assert.deepEqual(flat.sorts, [m, { key: 'name', dir: 'asc' }]);
  assert.deepEqual(withMembershipGrouping({ groupBy: ['genres', MEMBERSHIP_KEY] }).groupBy, [MEMBERSHIP_KEY, 'genres']);
  assert.deepEqual(withMembershipGrouping({ sorts: [{ key: MEMBERSHIP_KEY, dir: 'desc' }] }).sorts, [m]);
  const already = { groupBy: [MEMBERSHIP_KEY], sorts: [m] };
  assert.equal(withMembershipGrouping(already), already);
});

test('withoutMembershipGrouping: a flat view drops what it inherited from the grouped one', () => {
  const view = {
    groupBy: [MEMBERSHIP_KEY, 'genres'],
    sorts: [
      { key: MEMBERSHIP_KEY, dir: 'asc' },
      { key: 'name', dir: 'asc' },
    ],
  };
  assert.deepEqual(withoutMembershipGrouping(view), { groupBy: ['genres'], sorts: [{ key: 'name', dir: 'asc' }] });
  const flat = { sorts: [{ key: 'name', dir: 'asc' }] };
  assert.equal(withoutMembershipGrouping(flat), flat);
});
