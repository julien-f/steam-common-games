'use strict';

// Read-only check for code-audit's simplify dimension: frontend exports no other file names, tests
// included — candidates for dropping the `export`, or the symbol itself if its own file doesn't
// use it either. Exits 1 when it finds any.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['public', 'lib', 'scripts', 'test', 'e2e'];
const SOURCE_FILES = ['server.js'];

const walk = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => !f.split(path.sep).includes('node_modules') && /\.(c?js|mjs|ts|tsx)$/.test(f))
    .map((f) => path.join(dir, f));

// Value exports only: an exported type or interface costs nothing at runtime.
const EXPORT = /^export (?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/gm;

// `sources`: Map of repo-relative path → text. Returns [{ file, name, usedInFile }] for each export
// of a `public/` module that no other source file mentions as a whole word.
function deadExports(sources) {
  const words = new Map([...sources].map(([file, text]) => [file, new Set(text.match(/[A-Za-z_$][\w$]*/g))]));
  const dead = [];
  for (const [file, text] of sources) {
    if (!file.startsWith('public/')) continue;
    for (const [, name] of text.matchAll(EXPORT)) {
      if ([...words].some(([other, set]) => other !== file && set.has(name))) continue;
      const usedInFile = text.split(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`)).length > 2;
      dead.push({ file, name, usedInFile });
    }
  }
  return dead;
}

function main() {
  const files = [
    ...SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
    ...SOURCE_FILES.map((f) => path.join(ROOT, f)),
  ];
  const sources = new Map(files.map((f) => [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')]));
  const dead = deadExports(sources);
  for (const { file, name, usedInFile } of dead)
    console.log(`${file}: ${name}${usedInFile ? '' : ' (unused in its own file too)'}`);
  console.log(dead.length ? `${dead.length} export(s) no other file uses` : 'Dead exports: none');
  if (dead.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { deadExports };
