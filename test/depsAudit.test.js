'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { importedPackages, unusedDeps, phantomImports, walk } = require('../scripts/deps-audit');

test('importedPackages: bare specifiers from import, export, require and import(), reduced to package names', () => {
  const source = `
import { render } from 'solid-js/web';
import {
  Router,
} from '@solidjs/router';
import 'hls.js';
export { x } from 'dotenv';
const express = require('express');
const lazy = await import('@vates/data-table-solid/deep/path');
import fs from 'node:fs';
const path = require('path');
import { y } from './local';
`;
  assert.deepStrictEqual([...importedPackages(source)].sort(), [
    '@solidjs/router',
    '@vates/data-table-solid',
    'dotenv',
    'express',
    'hls.js',
    'solid-js',
  ]);
});

test('importedPackages: ignores "from" in prose and strings', () => {
  const source = `// picks a value from 'nothing' to show\nconst s = 'from "unknown"';\n`;
  assert.deepStrictEqual([...importedPackages(source)], []);
});

test('unusedDeps: a name only inside a longer package name is unused; @babel/core never is', () => {
  const haystack = `import solid from 'vite-plugin-solid';\n"build": "concurrently a b"`;
  assert.deepStrictEqual(unusedDeps(['vite', 'vite-plugin-solid', 'concurrently', '@babel/core'], haystack), ['vite']);
});

test('phantomImports: imported but not declared', () => {
  assert.deepStrictEqual(phantomImports(new Set(['express', 'left-pad']), ['express']), ['left-pad']);
});

test("walk: skips node_modules, whose imports are a dependency's, not this repo's", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-audit-'));
  fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.js'), '');
  fs.writeFileSync(path.join(dir, 'node_modules/pkg/b.js'), '');
  assert.deepStrictEqual(
    walk(dir, (p) => p.endsWith('.js')),
    [path.join(dir, 'a.js')],
  );
  fs.rmSync(dir, { recursive: true });
});

test('every package the server requires at runtime is a production dependency', () => {
  const root = path.join(__dirname, '..');
  const files = ['server.js', ...fs.readdirSync(path.join(root, 'lib')).map((f) => path.join('lib', f))];
  const imported = new Set(files.flatMap((f) => [...importedPackages(fs.readFileSync(path.join(root, f), 'utf8'))]));
  // A dev-only package crashes `npm install --omit=dev` at startup.
  assert.deepStrictEqual(phantomImports(imported, Object.keys(require('../package.json').dependencies)), []);
});
