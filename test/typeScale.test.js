'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const lineOf = (index) => css.slice(0, index).split('\n').length;

test('style.css: text sizes come from the --fs-* scale (px only for icon glyphs, 22px and up)', () => {
  const stray = [...css.matchAll(/font-size:\s*([\d.]+)px/g)]
    .filter((m) => Number(m[1]) < 22)
    .map((m) => `line ${lineOf(m.index)}: ${m[1]}px`);
  assert.deepEqual(stray, []);
});

test('style.css: weights are 400 or 600', () => {
  const stray = [...css.matchAll(/font-weight:\s*([^;]+);/g)]
    .filter((m) => !['400', '600', 'inherit'].includes(m[1].trim()))
    .map((m) => `line ${lineOf(m.index)}: ${m[1]}`);
  assert.deepEqual(stray, []);
});
