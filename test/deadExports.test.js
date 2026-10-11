'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deadExports } = require('../scripts/dead-exports');

test('deadExports: a public value export no other file mentions, and whether its own file uses it', () => {
  const sources = new Map([
    [
      'public/a.ts',
      'export function used() {}\nexport const local = 1;\nexport function gone() {}\nexport interface T {}\nconst x = local;\n',
    ],
    ['public/b.ts', "import { used } from './a.ts';\n"],
    ['lib/c.js', 'export function alsoGone() {}\n'],
  ]);
  assert.deepEqual(deadExports(sources), [
    { file: 'public/a.ts', name: 'local', usedInFile: true },
    { file: 'public/a.ts', name: 'gone', usedInFile: false },
  ]);
});

test('deadExports: a test naming an export keeps it', () => {
  const sources = new Map([
    ['public/a.ts', 'export function tested() {}\n'],
    ['test/a.test.js', "const { tested } = require('../public/a.ts');\n"],
  ]);
  assert.deepEqual(deadExports(sources), []);
});
