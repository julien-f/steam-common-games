'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { needsRestart } = require('../scripts/background-server.js');

test('needsRestart: a server this script started at another HEAD restarts', () => {
  assert.equal(needsRestart({ running: true, startedHead: 'aaa', head: 'bbb' }), true);
});

test('needsRestart: same HEAD, not running, or not started by this script: left alone', () => {
  assert.equal(needsRestart({ running: true, startedHead: 'aaa', head: 'aaa' }), false);
  assert.equal(needsRestart({ running: false, startedHead: 'aaa', head: 'bbb' }), false);
  assert.equal(needsRestart({ running: true, startedHead: null, head: 'bbb' }), false);
});
