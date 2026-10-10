'use strict';

// Fails when CHANGELOG.md's Unreleased section repeats a subsection or uses one outside
// Keep a Changelog's set plus Development (tooling, tests, docs: kept apart from what users see)
// — new entries then have one obvious place to go — or has an entry over
// MAX_ENTRY characters: commit-sized essays made the 0.5.0 release's consolidation a rewrite.
// With --staged[=<base>] (the pre-commit hook; base HEAD, HEAD~1 when amending), also fails when
// the commit changes app code without CHANGELOG.md; SKIP_CHANGELOG=1 skips that part.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Development'];
const MAX_ENTRY = 400;
const APP_CODE = /^(public|lib)\/|^server\.js$/;

function structureProblems(text) {
  const unreleased = text.split(/^## /m).find((s) => s.startsWith('[Unreleased]')) ?? '';
  const headings = [...unreleased.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
  return [
    ...headings.filter((h, i) => headings.indexOf(h) !== i).map((h) => `repeated "### ${h}"`),
    ...headings.filter((h) => !ALLOWED.includes(h)).map((h) => `unexpected "### ${h}"`),
    ...unreleased
      .split('\n')
      .filter((line) => /^\s*- /.test(line) && line.trim().length > MAX_ENTRY)
      .map(
        (line) =>
          `entry over ${MAX_ENTRY} characters ("${line.trim().slice(2, 50)}…") — say what changed for users, briefly`,
      ),
  ];
}

const missingEntry = (files) => files.some((f) => APP_CODE.test(f)) && !files.includes('CHANGELOG.md');

function main() {
  const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const problems = [...new Set(structureProblems(text))];
  const staged = process.argv.slice(2).find((a) => a.startsWith('--staged'));
  if (staged && !process.env.SKIP_CHANGELOG) {
    const base = staged.split('=')[1] || 'HEAD';
    const files = execFileSync('git', ['diff', '--cached', '--name-only', base], { encoding: 'utf8' }).split('\n');
    if (missingEntry(files))
      problems.push(
        "app code changed (public/, lib/, server.js) but CHANGELOG.md didn't — add an entry, or commit with SKIP_CHANGELOG=1 if it genuinely needs none",
      );
  }
  if (problems.length) {
    console.error(`CHANGELOG.md [Unreleased]: ${problems.join(', ')}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { structureProblems, missingEntry, ALLOWED, MAX_ENTRY };
