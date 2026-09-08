'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortOwners, ownerMeterPct } = require('../public/ownerList.ts');

test('sortOwners: most recently played first', () => {
  const owners = [
    { name: 'A', minutes: 10, lastPlayedSec: 100 },
    { name: 'B', minutes: 999, lastPlayedSec: 500 },
  ];
  assert.deepEqual(sortOwners(owners).map(o => o.name), ['B', 'A']);
});

test('sortOwners: never-played owners sort last, alphabetically among themselves', () => {
  const owners = [
    { name: 'Zoe', minutes: 0, lastPlayedSec: 0 },
    { name: 'Ana', minutes: 0, lastPlayedSec: 0 },
    { name: 'Bob', minutes: 5, lastPlayedSec: 10 },
  ];
  assert.deepEqual(sortOwners(owners).map(o => o.name), ['Bob', 'Ana', 'Zoe']);
});

test('sortOwners: does not mutate its input', () => {
  const owners = [{ name: 'A', minutes: 1, lastPlayedSec: 1 }, { name: 'B', minutes: 2, lastPlayedSec: 9 }];
  sortOwners(owners);
  assert.deepEqual(owners.map(o => o.name), ['A', 'B']);
});

test('ownerMeterPct: proportional to the most-played owner', () => {
  assert.equal(ownerMeterPct(50, 100), 50);
  assert.equal(ownerMeterPct(100, 100), 100);
});

test('ownerMeterPct: an all-zero list yields 0%, never NaN', () => {
  assert.equal(ownerMeterPct(0, 0), 0);
});
