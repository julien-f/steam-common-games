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

test('styles: keyframes move only opacity and transform (ui-guidelines.md, Motion)', () => {
  const MOVING = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate']);
  const stray = matches(/@keyframes\s+([\w-]+)\s*{/g).flatMap(({ m, at }) => {
    const css = sheets.find(({ file }) => at.startsWith(`${file}:`)).css;
    let depth = 1;
    let i = m.index + m[0].length;
    for (; depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    const body = css.slice(m.index + m[0].length, i);
    return [...body.matchAll(/([\w-]+)\s*:/g)].filter((p) => !MOVING.has(p[1])).map((p) => `${at} ${m[1]}: ${p[1]}`);
  });
  assert.deepEqual(stray, []);
});
