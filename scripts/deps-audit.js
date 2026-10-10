'use strict';

// Read-only checks for the dependency-audit skill: declared packages nothing references, and bare
// imports nothing declares. Exits 1 when either finds something.

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['lib', 'public', 'scripts', 'test', 'e2e'];
const SOURCE_FILES = ['server.js', 'vite.config.js', 'eslint.config.mjs', 'playwright.config.ts'];
// Required peer of @babel/eslint-parser, never imported (architecture.md's eslint.config.mjs bullet).
const NOT_IMPORTED = new Set(['@babel/core']);

const walk = (dir, keep) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, f))
    .filter(keep);

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages(source) {
  const names = new Set();
  const statements =
    /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\b(?:require|import)\(['"]([^'"]+)['"]\)/gm;
  for (const m of source.matchAll(statements)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    if (builtinModules.includes(spec) || spec.startsWith('virtual:')) continue;
    names.add(packageName(spec));
  }
  return names;
}

function unusedDeps(declared, haystack) {
  const mentioned = (name) =>
    new RegExp(`(?<![\\w@/-])${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w-])`).test(haystack);
  return declared.filter((name) => !NOT_IMPORTED.has(name) && !mentioned(name));
}

function phantomImports(imported, declared) {
  return [...imported].filter((name) => !declared.includes(name)).sort();
}

function main() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const sources = [
    // Its own test's fixtures would count as uses.
    ...SOURCE_DIRS.flatMap((d) =>
      walk(path.join(ROOT, d), (p) => /\.(c?js|mjs|ts|tsx)$/.test(p) && !p.endsWith('depsAudit.test.js')),
    ),
    ...SOURCE_FILES.map((f) => path.join(ROOT, f)),
  ].map((f) => fs.readFileSync(f, 'utf8'));
  const docs = walk(path.join(ROOT, 'docs'), (p) => p.endsWith('.md')).map((f) => fs.readFileSync(f, 'utf8'));
  const imported = new Set(sources.flatMap((s) => [...importedPackages(s)]));

  const report = {
    'Declared but unused': unusedDeps(declared, [...sources, ...docs, JSON.stringify(pkg.scripts)].join('\n')),
    'Imported but undeclared': phantomImports(imported, declared),
  };
  let found = false;
  for (const [title, items] of Object.entries(report)) {
    console.log(`${title}: ${items.length ? '' : 'none'}`);
    for (const item of items) console.log(`  ${item}`);
    found ||= items.length > 0;
  }
  process.exitCode = found ? 1 : 0;
}

if (require.main === module) main();

module.exports = { importedPackages, unusedDeps, phantomImports };
