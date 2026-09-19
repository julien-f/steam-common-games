'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { achievementsAccountKey, achievementsRequestUrl, achievementsSteamUrl } = require('../public/achievementsRequest.ts');

test('achievementsAccountKey: sorts, so member order never yields two keys for one slot', () => {
  assert.equal(achievementsAccountKey(['2', '1']), achievementsAccountKey(['1', '2']));
  assert.equal(achievementsAccountKey(['1', '2']), '1,2');
});

test('achievementsAccountKey: no account is its own key, distinct from any real one', () => {
  assert.equal(achievementsAccountKey([]), '');
});

test('achievementsRequestUrl: sends steamids only when there is an account', () => {
  assert.equal(achievementsRequestUrl(440, ['1', '2']), '/api/achievements/440?steamids=1%2C2');
  assert.equal(achievementsRequestUrl(440, []), '/api/achievements/440');
});

test('achievementsRequestUrl: force adds refresh=1, with or without an account', () => {
  assert.equal(achievementsRequestUrl(440, ['1'], { force: true }), '/api/achievements/440?steamids=1&refresh=1');
  assert.equal(achievementsRequestUrl(440, [], { force: true }), '/api/achievements/440?refresh=1');
});

test('achievementsSteamUrl: links the first member of a Family; null with no account', () => {
  assert.equal(achievementsSteamUrl(440, ['76561198000000001', '76561198000000002']),
    'https://steamcommunity.com/profiles/76561198000000001/stats/440/achievements/');
  assert.equal(achievementsSteamUrl(440, []), null);
});
