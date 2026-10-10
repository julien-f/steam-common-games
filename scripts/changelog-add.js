'use strict';

// Adds an entry to CHANGELOG.md's Unreleased section, creating the section and the subsection (in
// Keep a Changelog order) when missing, so nobody hand-edits a file too long to read whole.
//   node scripts/changelog-add.js <Added|Changed|Deprecated|Removed|Fixed|Security|Development> "<entry>"

const fs = require('node:fs');
const path = require('node:path');
const { ALLOWED, MAX_ENTRY } = require('./changelog-check');

const FILE = path.join(__dirname, '..', 'CHANGELOG.md');

function addEntry(text, section, entry) {
  const lines = text.split('\n');
  const isVersion = (l) => l.startsWith('## [');
  let start = lines.findIndex((l) => l.startsWith('## [Unreleased]'));
  if (start === -1) {
    start = lines.findIndex(isVersion);
    if (start === -1) start = lines.length;
    lines.splice(start, 0, '## [Unreleased]', '');
  }
  let end = lines.findIndex((l, i) => i > start && isVersion(l));
  if (end === -1) end = lines.length;

  const heading = (i) => lines[i].match(/^### (.+)$/)?.[1].trim();
  let at = lines.findIndex((l, i) => i > start && i < end && heading(i) === section);
  if (at === -1) {
    // Before the first existing subsection that comes later in ALLOWED's order, else at the end.
    const rank = ALLOWED.indexOf(section);
    let before = lines.findIndex((l, i) => i > start && i < end && ALLOWED.indexOf(heading(i)) > rank);
    if (before === -1) before = end;
    while (before - 1 > start && lines[before - 1] === '') before--;
    lines.splice(before, 0, '', `### ${section}`, '');
    at = before + 1;
    end += 3;
  }
  // After the subsection's last line before the next heading.
  let last = at;
  for (let i = at + 1; i < end && !lines[i].startsWith('#'); i++) if (lines[i] !== '') last = i;
  if (last === at) lines.splice(at + 1, 0, '', `- ${entry}`);
  else lines.splice(last + 1, 0, `- ${entry}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function main() {
  const [section, entry] = process.argv.slice(2);
  if (!ALLOWED.includes(section) || !entry) {
    console.error(`Usage: node scripts/changelog-add.js <${ALLOWED.join('|')}> "<entry>"`);
    process.exit(1);
  }
  if (entry.length > MAX_ENTRY) {
    console.error(`Entry over ${MAX_ENTRY} characters — say what changed for users, briefly.`);
    process.exit(1);
  }
  fs.writeFileSync(FILE, addEntry(fs.readFileSync(FILE, 'utf8'), section, entry.replace(/^- /, '')));
}

if (require.main === module) main();

module.exports = { addEntry };
