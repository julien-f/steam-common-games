'use strict';

// Fails when CHANGELOG.md's Unreleased section repeats a subsection or uses one outside
// Keep a Changelog's set — new entries then have one obvious place to go.

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const unreleased = text.split(/^## /m).find((s) => s.startsWith('[Unreleased]')) ?? '';
const headings = [...unreleased.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());

const problems = [
  ...headings.filter((h, i) => headings.indexOf(h) !== i).map((h) => `repeated "### ${h}"`),
  ...headings.filter((h) => !ALLOWED.includes(h)).map((h) => `unexpected "### ${h}"`),
];
if (problems.length) {
  console.error(`CHANGELOG.md [Unreleased]: ${[...new Set(problems)].join(', ')}`);
  process.exit(1);
}
