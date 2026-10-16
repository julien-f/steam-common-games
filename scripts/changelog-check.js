'use strict';

// Fails when CHANGELOG.md's Unreleased section repeats a subsection or uses one outside
// Keep a Changelog's set plus Development (tooling, tests, docs: kept apart from what users see)
// — new entries then have one obvious place to go — or has an entry over
// MAX_ENTRY characters: commit-sized essays made the 0.5.0 release's consolidation a rewrite.
// With --staged[=<base>] (the pre-commit hook; base HEAD, HEAD~1 when amending), checks the staged
// CHANGELOG.md instead of the working tree's, and also fails when the commit changes app code without
// it — on main and on a merge commit only, so a feature branch adds its entries once, by its merge
// (the pre-merge-commit hook); SKIP_CHANGELOG=1 skips that part.

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

// A feature branch's own commits are checked at its merge instead.
const entryRequired = ({ branch, merging }) => merging || branch === 'main';

function main() {
  const root = path.join(__dirname, '..');
  const staged = process.argv.slice(2).find((a) => a.startsWith('--staged'));
  const text = staged
    ? execFileSync('git', ['show', ':CHANGELOG.md'], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const problems = [...new Set(structureProblems(text))];
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const merging = () => fs.existsSync(path.resolve(root, git('rev-parse', '--git-path', 'MERGE_HEAD')));
  if (
    staged &&
    !process.env.SKIP_CHANGELOG &&
    entryRequired({ branch: git('branch', '--show-current'), merging: merging() })
  ) {
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

module.exports = { structureProblems, missingEntry, entryRequired, ALLOWED, MAX_ENTRY };
