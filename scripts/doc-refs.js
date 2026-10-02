'use strict';

// Lists camelCase identifiers backticked in docs/ (`cheapestPicks`, `pickRate()`) that no longer
// appear anywhere in the code — usually a doc describing something since renamed or removed.
// Warns only; `--strict` makes it fail.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CODE_DIRS = ['public', 'lib', 'scripts', 'e2e', 'test'];
const CODE_FILES = [
  'server.js',
  'tsconfig.json',
  'package.json',
  'vite.config.js',
  'playwright.config.ts',
  'eslint.config.mjs',
];

function walk(dir, keep) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, keep);
    return keep(p) ? [p] : [];
  });
}

const code = [
  ...CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d), (p) => /\.(js|mjs|ts|tsx|css|html)$/.test(p))),
  ...CODE_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const words = new Set(code.match(/[A-Za-z_$][\w$]*/g));

const missing = [];
for (const doc of walk(path.join(ROOT, 'docs'), (p) => p.endsWith('.md'))) {
  fs.readFileSync(doc, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [, name] of line.matchAll(/`([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)(?:\(\))?`/g))
        if (!words.has(name)) missing.push(`${path.relative(ROOT, doc)}:${i + 1}: \`${name}\``);
    });
}

if (missing.length) {
  console.log(`Backticked in docs/ but not found in the code:\n${missing.join('\n')}`);
  if (process.argv.includes('--strict')) process.exit(1);
}
