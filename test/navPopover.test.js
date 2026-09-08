'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampPopoverLeft, POPOVER_MARGIN } = require('../public/navPopover.ts');

// `bindNavPopover` itself needs real elements plus toggle/resize/scroll events to exercise;
// what's actually worth covering is the clamp it positions with — the off-screen panel it exists
// to prevent is the whole reason this positioning is in JS rather than CSS (see the module's own
// comment).

test('clampPopoverLeft: right-aligns the panel to its trigger when there is room', () => {
  assert.equal(clampPopoverLeft(500, 200, 1000), 300);
});

test('clampPopoverLeft: never pushes the panel off the left edge', () => {
  // A trigger near the left edge would right-align to a negative left.
  assert.equal(clampPopoverLeft(80, 200, 1000), POPOVER_MARGIN);
});

test('clampPopoverLeft: never pushes the panel off the right edge', () => {
  // A trigger at the far right, with a panel wider than the space left of it.
  assert.equal(clampPopoverLeft(1000, 200, 1000), 1000 - 200 - POPOVER_MARGIN);
});

test('clampPopoverLeft: falls back to the left margin when the panel is wider than the viewport', () => {
  // maxLeft goes negative here — without the outer Math.max, the clamp's upper bound would fall
  // below its lower one and push the panel off-screen to the left.
  assert.equal(clampPopoverLeft(300, 400, 320), POPOVER_MARGIN);
});

test('clampPopoverLeft: honors a custom margin', () => {
  assert.equal(clampPopoverLeft(10, 200, 1000, 4), 4);
});
