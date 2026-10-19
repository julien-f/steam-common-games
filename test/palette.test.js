'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public/styles', file), 'utf8');
const base = read('base.css');
const vendor = read('vendor-data-table.css');

const rootBlock = base.match(/:root\s*{([^}]*)}/)[1];
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// color-mix(in srgb, a p%, b): a per-channel blend of the gamma-encoded values.
const mix = (a, p, b) => rgb(a).map((v, i) => Math.round((v * p + rgb(b)[i] * (100 - p)) / 100));
const luminance = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const asRgb = (c) => (typeof c === 'string' ? rgb(c) : c);

// The current row's tint, as vendor-data-table.css mixes it.
const currentPct = Number(
  vendor.match(/--color-background-info: color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg\)\)/)[1],
);
const grounds = {
  bg: tokens.bg,
  surface: tokens.surface,
  'surface-2': tokens['surface-2'],
  'current row': mix(tokens.accent, currentPct, tokens.bg),
  // .dt-tr--selected's background.
  'selected row': tokens.line,
};

const below = (names, min) =>
  names.flatMap((name) =>
    Object.entries(grounds)
      .map(([ground, c]) => [name, ground, ratio(rgb(tokens[name]), asRgb(c))])
      .filter(([, , r]) => r < min)
      .map(([n, g, r]) => `--${n} on ${g}: ${r.toFixed(2)}`),
  );

test('palette: every token is a 6-digit hex in base.css', () => {
  for (const name of [
    'bg',
    'surface',
    'surface-2',
    'line',
    'line-control',
    'text',
    'text-body',
    'muted',
    'accent',
    'good',
    'warn',
    'bad',
  ])
    assert.match(tokens[name] ?? '', /^#[0-9a-f]{6}$/i, `--${name}`);
});

test('palette: text colours reach 4.5:1 on every ground', () => {
  assert.deepEqual(below(['text', 'text-body', 'muted', 'accent', 'good', 'warn', 'bad'], 4.5), []);
});

test("palette: a control's edge and the focus ring reach 3:1 on every ground", () => {
  assert.deepEqual(below(['line-control', 'text'], 3), []);
});

test('palette: the primary button keeps --bg text at 4.5:1, hovered too', () => {
  assert.match(base, /\.btn-primary:hover[^{]*{[^}]*background: color-mix\(in srgb, var\(--accent\) 85%, #fff\);/);
  assert.ok(ratio(rgb(tokens.bg), rgb(tokens.accent)) >= 4.5);
  assert.ok(ratio(rgb(tokens.bg), mix(tokens.accent, 85, '#ffffff')) >= 4.5);
});

test("palette: the panel's tag-kind dots reach 3:1 on every ground", () => {
  assert.deepEqual(below(['kind-tag', 'kind-genre', 'kind-category', 'kind-devpub'], 3), []);
});

test('palette: each ProtonDB tier keeps white badge text at 4.5:1', () => {
  const tiers = ['borked', 'bronze', 'silver', 'gold', 'platinum', 'native'];
  const low = tiers.filter((t) => !(ratio(rgb(tokens[`tier-${t}`]), rgb('#ffffff')) >= 4.5));
  assert.deepEqual(low, []);
});
