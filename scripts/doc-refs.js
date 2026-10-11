'use strict';

// Lists references in the docs, CLAUDE.md, README.md and the skills that no longer resolve: backticked
// camelCase identifiers (`cheapestPicks`, `pickRate()`) found nowhere in the code, relative links to
// missing files or headings, `npm run` scripts package.json lacks, and `scripts/*.js` files or flags that don't exist.
// Run by `npm run check`; a name a doc mentions on purpose as removed or rejected goes in HISTORY, and
// leaves it once no doc mentions it.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HISTORY = new Set([
  'fullPage', // screenshots skill: the Playwright option it explains not using
]);
const CODE_DIRS = ['public', 'lib', 'scripts', 'e2e', 'test'];
const CODE_FILES = [
  'server.js',
  'tsconfig.json',
  'package.json',
  'vite.config.js',
  'playwright.config.ts',
  'eslint.config.mjs',
];

// GitHub's heading anchors: lowercased, punctuation dropped, spaces to hyphens, `-1`… on repeats.
function headingSlugs(markdown) {
  const slugs = new Set();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = !fenced && line.match(/^#{1,6} (.*)/)?.[1];
    if (!heading) continue;
    const base = heading
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    for (let n = 1; slugs.has(slug); n++) slug = `${base}-${n}`;
    slugs.add(slug);
  }
  return slugs;
}

// node_modules skipped: a worktree has none, so a dependency's names must not count as this repo's code.
const walk = (dir, keep) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => !f.split(path.sep).includes('node_modules'))
    .map((f) => path.join(dir, f))
    .filter(keep);

// `ctx`: `words` (identifiers in the code), `npmScripts` (names), `exists(relPath)`, `slugs(relPath)` (a
// Markdown file's heading anchors), `scriptSource(name)` (a `scripts/` file's text, or undefined); `doc` is
// the file's path relative to the repo root.
function staleRefs(doc, text, ctx) {
  const stale = [];
  text.split('\n').forEach((line, i) => {
    const at = (what) => stale.push(`${doc}:${i + 1}: ${what}`);
    for (const [, name] of line.matchAll(/`([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)(?:\(\))?`/g))
      if (!ctx.words.has(name) && !HISTORY.has(name)) at(`\`${name}\` not in the code`);
    for (const [, link, anchor] of line.matchAll(/\]\(([^)#\s]*)(?:#([^)\s]+))?[^)]*\)/g)) {
      if (/^[a-z]+:/.test(link)) continue;
      const target = link ? path.posix.join(path.posix.dirname(doc), link) : doc;
      if (!ctx.exists(target)) at(`link to missing ${link}`);
      else if (anchor && target.endsWith('.md') && !ctx.slugs(target).has(anchor))
        at(`no heading #${anchor} in ${target}`);
    }
    for (const [, name] of line.matchAll(/npm run (?:-s )?([\w:-]+)/g))
      if (!ctx.npmScripts.has(name)) at(`no npm script "${name}"`);
    for (const [, file, flags] of line.matchAll(/scripts\/([\w-]+\.js)((?: --?[\w-]+(?:=\S*)?)*)/g)) {
      const source = ctx.scriptSource(file);
      if (source === undefined) at(`no scripts/${file}`);
      else
        for (const flag of flags.match(/--?[\w-]+/g) ?? [])
          if (!source.includes(flag.replace(/^-+/, ''))) at(`scripts/${file} has no ${flag}`);
    }
  });
  return stale;
}

// HISTORY names no doc text mentions any more.
const unusedHistory = (texts, history = HISTORY) =>
  [...history].filter((name) => !texts.some((t) => t.includes(`\`${name}`)));

function main() {
  const code = [
    ...CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d), (p) => /\.(js|mjs|ts|tsx|css|html)$/.test(p))),
    ...CODE_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
  ]
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const ctx = {
    words: new Set(code.match(/[A-Za-z_$][\w$]*/g)),
    npmScripts: new Set(Object.keys(require('../package.json').scripts)),
    exists: (p) => fs.existsSync(path.join(ROOT, p)),
    slugs: (p) => headingSlugs(fs.readFileSync(path.join(ROOT, p), 'utf8')),
    scriptSource: (name) => {
      const p = path.join(ROOT, 'scripts', name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
  };
  const docs = [
    ...walk(path.join(ROOT, 'docs'), (p) => p.endsWith('.md')),
    ...walk(path.join(ROOT, '.claude/skills'), (p) => p.endsWith('.md')),
    path.join(ROOT, 'CLAUDE.md'),
    path.join(ROOT, 'README.md'),
  ];
  const texts = docs.map((f) => fs.readFileSync(f, 'utf8'));
  const stale = [
    ...docs.flatMap((f, i) => staleRefs(path.relative(ROOT, f).split(path.sep).join('/'), texts[i], ctx)),
    ...unusedHistory(texts).map(
      (name) => `scripts/doc-refs.js: HISTORY's \`${name}\` is in no doc any more; remove it`,
    ),
  ];
  if (stale.length) {
    console.error(`Stale references (fix the doc, or add a deliberate name to HISTORY):\n${stale.join('\n')}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { headingSlugs, staleRefs, unusedHistory };
