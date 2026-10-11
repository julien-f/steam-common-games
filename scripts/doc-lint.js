'use strict';

// Keeps docs/ in the shape CLAUDE.md asks for: every doc indexed in CLAUDE.md and README.md, current
// behavior only (history belongs in commits and CHANGELOG.md), and no paragraph too long to read in part.
// Run by `npm run check`. Quoted text ("no longer listed", `usedTo`) is exempt: it names, not narrates.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEXES = ['CLAUDE.md', 'README.md'];
const HISTORY_PHRASES =
  /\b(used to|previously|earlier (?:version|draft)s?|no longer|was replaced|has since|anymore)\b/i;
const MAX_PARAGRAPH = 1000;

// `doc` is the path relative to the repo root; returns `doc:line: problem` strings.
function proseProblems(doc, text) {
  const problems = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced || line.startsWith('|')) return;
    const at = (what) => problems.push(`${doc}:${i + 1}: ${what}`);
    const phrase = line.replace(/"[^"]*"|`[^`]*`/g, '').match(HISTORY_PHRASES)?.[1];
    if (phrase) at(`"${phrase}" narrates history; state the current behavior (and its why) instead`);
    if (line.length > MAX_PARAGRAPH) at(`${line.length}-character paragraph; split it into bullets`);
  });
  return problems;
}

// `indexes`: `{ [name]: text }`; `docs`: repo-relative paths every index must link.
function unindexed(docs, indexes) {
  return Object.entries(indexes).flatMap(([name, text]) =>
    docs.filter((doc) => !text.includes(`](${doc})`)).map((doc) => `${name}: no link to ${doc}`),
  );
}

function main() {
  const docs = fs
    .readdirSync(path.join(ROOT, 'docs'), { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f.split(path.sep).join('/')}`);
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const problems = [
    ...unindexed(docs, Object.fromEntries(INDEXES.map((f) => [f, read(f)]))),
    ...docs.flatMap((doc) => proseProblems(doc, read(doc))),
  ];
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { proseProblems, unindexed };
