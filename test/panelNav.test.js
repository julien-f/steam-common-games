'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stepGameList, computePanelNavState } = require('../public/panelNav.ts');

const list = [{ appid: 1 }, { appid: 2 }, { appid: 3 }];
const getGameList = () => list;

test('computePanelNavState: returns null with no table yet', () => {
  assert.equal(computePanelNavState(false, list[0], getGameList), null);
});

test('computePanelNavState: returns null for a standalone lookup', () => {
  assert.equal(computePanelNavState(true, { appid: 1, standalone: true }, getGameList), null);
});

test('computePanelNavState: returns null with no game open', () => {
  assert.equal(computePanelNavState(true, null, getGameList), null);
});

test('computePanelNavState: reports 0-based idx, total, and wraparound neighbors for the middle game', () => {
  assert.deepEqual(computePanelNavState(true, list[1], getGameList), {
    idx: 1, total: 3, prevGame: list[0], nextGame: list[2],
  });
});

test('computePanelNavState: wraps prevGame around at the start of the list', () => {
  const state = computePanelNavState(true, list[0], getGameList);
  assert.equal(state.idx, 0);
  assert.equal(state.prevGame.appid, 3);
  assert.equal(state.nextGame.appid, 2);
});

test('computePanelNavState: wraps nextGame around at the end of the list', () => {
  const state = computePanelNavState(true, list[2], getGameList);
  assert.equal(state.idx, 2);
  assert.equal(state.prevGame.appid, 2);
  assert.equal(state.nextGame.appid, 1);
});

test('stepGameList: steps forward with wraparound at the end', () => {
  assert.equal(stepGameList({}, getGameList, { appid: 3 }, 1).appid, 1);
});

test('stepGameList: steps backward with wraparound at the start', () => {
  assert.equal(stepGameList({}, getGameList, { appid: 1 }, -1).appid, 3);
});

test('stepGameList: steps to the immediate neighbor otherwise', () => {
  assert.equal(stepGameList({}, getGameList, { appid: 2 }, 1).appid, 3);
});

test('stepGameList: returns null with no table yet', () => {
  assert.equal(stepGameList(null, getGameList, { appid: 1 }, 1), null);
});

test('stepGameList: returns null for a standalone lookup', () => {
  assert.equal(stepGameList({}, getGameList, { appid: 1, standalone: true }, 1), null);
});

test('stepGameList: returns null when the current game is not in the list', () => {
  assert.equal(stepGameList({}, getGameList, { appid: 999 }, 1), null);
});
