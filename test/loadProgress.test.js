'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { etaSeconds, formatEta } = require('../public/loadProgress.ts');

test('etaSeconds: extrapolates the recent rate, not the overall one', () => {
  // A burst of 300 cached games, then 2 games/s.
  const samples = [
    { t: 0, loaded: 0 },
    { t: 1000, loaded: 300 },
    { t: 21000, loaded: 340 },
    { t: 31000, loaded: 360 },
  ];
  assert.equal(etaSeconds(samples, 1000), 320);
});

test('etaSeconds: nothing to say yet, or while stalled', () => {
  assert.equal(etaSeconds([], 10), null);
  assert.equal(etaSeconds([{ t: 0, loaded: 1 }], 10), null);
  assert.equal(
    etaSeconds(
      [
        { t: 0, loaded: 1 },
        { t: 1000, loaded: 5 },
      ],
      10,
    ),
    null,
    'under 3 s of data',
  );
  assert.equal(
    etaSeconds(
      [
        { t: 0, loaded: 5 },
        { t: 10000, loaded: 5 },
      ],
      10,
    ),
    null,
    'stalled',
  );
});

test('formatEta: minutes, rounded, or less than one', () => {
  assert.equal(formatEta(20), 'less than a minute left');
  assert.equal(formatEta(400), 'about 7 min left');
});
