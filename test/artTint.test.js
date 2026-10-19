'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tintFromRgb } = require('../public/artTint.ts');

test("tintFromRgb: keeps the art's hue, at a fixed dark lightness and capped chroma", () => {
  assert.equal(tintFromRgb(255, 0, 0), 'oklch(0.17 0.040 29.2)');
  assert.equal(tintFromRgb(0, 0, 255), 'oklch(0.17 0.040 264.1)');
});

test('tintFromRgb: a muted art stays under the cap, a grey one neutral', () => {
  // #5a6470: OKLCH chroma ~0.02.
  assert.match(tintFromRgb(90, 100, 112), /^oklch\(0\.17 0\.02\d /);
  assert.match(tintFromRgb(128, 128, 128), /^oklch\(0\.17 0\.000 /);
});
