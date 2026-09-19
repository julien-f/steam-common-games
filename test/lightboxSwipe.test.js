'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decideSwipeAxis, resolveSwipe,
  LB_SWIPE_X_DISTANCE, LB_SWIPE_Y_DISTANCE, LB_SWIPE_FLICK_DISTANCE, LB_SWIPE_FLICK_MS,
} = require('../public/lightboxSwipe.ts');

const swipe = extra => resolveSwipe({
  axis: 'x', dx: 0, dy: 0, dt: 1000, mediaCount: 12, hasGameList: true, ...extra,
});

// ── decideSwipeAxis ───────────────────────────────────────────────────────────

test('decideSwipeAxis: undecided while the finger has barely moved', () => {
  assert.equal(decideSwipeAxis(0, 0), null);
  assert.equal(decideSwipeAxis(9, -9), null);
});

test('decideSwipeAxis: locks horizontal on a clearly sideways drag', () => {
  assert.equal(decideSwipeAxis(40, 5), 'x');
  assert.equal(decideSwipeAxis(-40, 5), 'x');
});

test('decideSwipeAxis: locks vertical on a clearly upright drag', () => {
  assert.equal(decideSwipeAxis(5, 40), 'y');
  assert.equal(decideSwipeAxis(5, -40), 'y');
});

test('decideSwipeAxis: a diagonal drag is vertical — horizontal needs the 1.2x bias', () => {
  assert.equal(decideSwipeAxis(30, 30), 'y');
  assert.equal(decideSwipeAxis(35, 30), 'y');
  assert.equal(decideSwipeAxis(40, 30), 'x');
});

// ── resolveSwipe: media (horizontal) ──────────────────────────────────────────

test('resolveSwipe: dragging left steps to the next media', () => {
  assert.equal(swipe({ dx: -LB_SWIPE_X_DISTANCE }), 'media-next');
});

test('resolveSwipe: dragging right steps to the previous media', () => {
  assert.equal(swipe({ dx: LB_SWIPE_X_DISTANCE }), 'media-prev');
});

test('resolveSwipe: a short horizontal drag does not commit', () => {
  assert.equal(swipe({ dx: -(LB_SWIPE_X_DISTANCE - 1) }), null);
});

test('resolveSwipe: a lone screenshot has nothing to step to', () => {
  assert.equal(swipe({ dx: -100, mediaCount: 1 }), null);
  assert.equal(swipe({ dx: -100, mediaCount: 0 }), null);
});

// ── resolveSwipe: game (vertical) ─────────────────────────────────────────────

test('resolveSwipe: dragging up brings the next game up from below', () => {
  assert.equal(swipe({ axis: 'y', dy: -LB_SWIPE_Y_DISTANCE }), 'game-next');
});

test('resolveSwipe: dragging down goes back to the previous game', () => {
  assert.equal(swipe({ axis: 'y', dy: LB_SWIPE_Y_DISTANCE }), 'game-prev');
});

test('resolveSwipe: vertical asks for more distance than horizontal', () => {
  assert.equal(swipe({ axis: 'y', dy: -LB_SWIPE_X_DISTANCE }), null);
});

test('resolveSwipe: no list behind the game means no game step', () => {
  assert.equal(swipe({ axis: 'y', dy: -200, hasGameList: false }), null);
});

// ── resolveSwipe: flicks ──────────────────────────────────────────────────────

test('resolveSwipe: a quick flick commits below the distance threshold', () => {
  assert.equal(swipe({ dx: -LB_SWIPE_FLICK_DISTANCE, dt: LB_SWIPE_FLICK_MS }), 'media-next');
  assert.equal(swipe({ axis: 'y', dy: -LB_SWIPE_FLICK_DISTANCE, dt: 50 }), 'game-next');
});

test('resolveSwipe: a slow drag of the same distance does not', () => {
  assert.equal(swipe({ dx: -LB_SWIPE_FLICK_DISTANCE, dt: LB_SWIPE_FLICK_MS + 1 }), null);
});

test('resolveSwipe: a flick still has to be more than a jitter', () => {
  assert.equal(swipe({ dx: -(LB_SWIPE_FLICK_DISTANCE - 1), dt: 10 }), null);
});

test('resolveSwipe: the off-axis distance is ignored', () => {
  assert.equal(swipe({ dx: -LB_SWIPE_X_DISTANCE, dy: 300 }), 'media-next');
  assert.equal(swipe({ axis: 'y', dx: 300, dy: -LB_SWIPE_Y_DISTANCE }), 'game-next');
});
