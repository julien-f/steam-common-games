'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '../public');
const sheets = [
  'style.css',
  ...fs
    .readdirSync(path.join(PUBLIC, 'styles'), { recursive: true })
    .filter((f) => f.endsWith('.css'))
    .map((f) => path.join('styles', f)),
].map((file) => ({ file, css: fs.readFileSync(path.join(PUBLIC, file), 'utf8') }));
const matches = (re) =>
  sheets.flatMap(({ file, css }) =>
    [...css.matchAll(re)].map((m) => ({ m, at: `${file}:${css.slice(0, m.index).split('\n').length}` })),
  );

test('styles: text sizes come from the --fs-* scale (px only for icon glyphs, 22px and up)', () => {
  const stray = matches(/font-size:\s*([\d.]+)px/g)
    .filter(({ m }) => Number(m[1]) < 22)
    .map(({ m, at }) => `${at}: ${m[1]}px`);
  assert.deepEqual(stray, []);
});

test('styles: weights are 400 or 600', () => {
  const stray = matches(/font-weight:\s*([^;]+);/g)
    .filter(({ m }) => !['400', '600', 'inherit'].includes(m[1].trim()))
    .map(({ m, at }) => `${at}: ${m[1]}`);
  assert.deepEqual(stray, []);
});
