'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fmtTime } = require('../public/lightbox');

// ── fmtTime ───────────────────────────────────────────────────────────────────

test('fmtTime: returns 0:00 for 0', () => {
  assert.equal(fmtTime(0), '0:00');
});

test('fmtTime: returns 0:00 for negative', () => {
  assert.equal(fmtTime(-1), '0:00');
});

test('fmtTime: returns 0:00 for NaN', () => {
  assert.equal(fmtTime(NaN), '0:00');
});

test('fmtTime: returns 0:00 for Infinity', () => {
  assert.equal(fmtTime(Infinity), '0:00');
});

test('fmtTime: formats seconds under a minute', () => {
  assert.equal(fmtTime(5), '0:05');
  assert.equal(fmtTime(59), '0:59');
});

test('fmtTime: formats exactly one minute', () => {
  assert.equal(fmtTime(60), '1:00');
});

test('fmtTime: formats minutes and seconds', () => {
  assert.equal(fmtTime(90), '1:30');
  assert.equal(fmtTime(125), '2:05');
});

test('fmtTime: truncates fractional seconds', () => {
  assert.equal(fmtTime(61.9), '1:01');
});

test('fmtTime: pads seconds with leading zero', () => {
  assert.equal(fmtTime(61), '1:01');
  assert.equal(fmtTime(600), '10:00');
});
