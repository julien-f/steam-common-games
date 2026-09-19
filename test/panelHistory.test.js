'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextHopHistory } = require('../public/panelHistory.ts');

// ── nextHopHistory ────────────────────────────────────────────────────────────
// The side panel's DLC/base-game trail — see panelHistory.ts. Exercised here rather than only
// in the browser because the pop branch is easy to get wrong and, until the hop latch in
// panel.tsx was fixed, had never actually run: the trail was cleared on every hop, so it was
// always empty by the time this rule saw it.

const BASE = { appid: 620, name: 'Portal 2' };
const DLC = { appid: 323180, name: 'Portal 2 Soundtrack' };

test('nextHopHistory: pushes the game being left onto an empty trail', () => {
  assert.deepEqual(nextHopHistory([], BASE, DLC.appid), [BASE]);
});

test('nextHopHistory: pushes onto a non-empty trail, keeping order (oldest first)', () => {
  const hist = [{ appid: 1, name: 'a' }];
  assert.deepEqual(nextHopHistory(hist, BASE, DLC.appid), [{ appid: 1, name: 'a' }, BASE]);
});

test('nextHopHistory: pops instead of pushing when the target is already on top', () => {
  // base → DLC (trail: [base]), then that DLC's own "DLC for Portal 2" link back to the base.
  const hist = [BASE];
  assert.deepEqual(nextHopHistory(hist, DLC, BASE.appid), []);
});

test('nextHopHistory: a there-and-back-again hop pops only the top entry', () => {
  const hist = [{ appid: 1, name: 'a' }, BASE];
  assert.deepEqual(nextHopHistory(hist, DLC, BASE.appid), [{ appid: 1, name: 'a' }]);
});

test('nextHopHistory: only the *top* entry collapses — an earlier match still pushes', () => {
  const hist = [BASE, { appid: 1, name: 'a' }];
  assert.deepEqual(nextHopHistory(hist, DLC, BASE.appid), [BASE, { appid: 1, name: 'a' }, DLC]);
});

test('nextHopHistory: hopping to the game already open pushes it (no self-collapse)', () => {
  // Not reachable from the UI (a game's own panel has no link to itself), but the rule must not
  // silently swallow the entry if it ever is.
  assert.deepEqual(nextHopHistory([], BASE, BASE.appid), [BASE]);
});

test('nextHopHistory: never mutates the trail it was given', () => {
  const hist = [BASE];
  const frozen = Object.freeze(hist.slice());
  assert.deepEqual(nextHopHistory(frozen, DLC, DLC.appid), [BASE, DLC]);
  assert.deepEqual(hist, [BASE]);
});
