'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stepGameList } = require('../public/panelNav.ts');

const list = [{ appid: 1 }, { appid: 2 }, { appid: 3 }];

test('stepGameList: steps forward with wraparound at the end', () => {
  assert.equal(stepGameList(list, { appid: 3 }, 1).appid, 1);
});

test('stepGameList: steps backward with wraparound at the start', () => {
  assert.equal(stepGameList(list, { appid: 1 }, -1).appid, 3);
});

test('stepGameList: steps to the immediate neighbor otherwise', () => {
  assert.equal(stepGameList(list, { appid: 2 }, 1).appid, 3);
});

test('stepGameList: returns null for a standalone lookup', () => {
  assert.equal(stepGameList(list, { appid: 1, standalone: true }, 1), null);
});

test('stepGameList: returns null when the current game is not in the list', () => {
  assert.equal(stepGameList(list, { appid: 999 }, 1), null);
});
