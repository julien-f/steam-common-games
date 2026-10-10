'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isFullRun } = require('../scripts/e2e');

test('isFullRun: only a run of the whole suite counts as a pass to record', () => {
  assert.equal(isFullRun([]), true);
  assert.equal(isFullRun(['--reporter=list,json']), true);
  for (const args of [
    ['-g', 'A1:'],
    ['--grep=A1'],
    ['--project=desktop'],
    ['e2e/scenarios.spec.ts'],
    ['--last-failed'],
  ]) {
    assert.equal(isFullRun(args), false, args.join(' '));
  }
});
