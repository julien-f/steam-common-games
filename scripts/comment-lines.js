'use strict';

// Flags comments of two or more lines added under public/ (CLAUDE.md: new comments are one line).
// Reads only the diff's added lines, so long-form comments already in the tree pass.
//   node scripts/comment-lines.js [--staged=<base>]   the staged commit against <base>, else uncommitted changes and new untracked files

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

// A new file as a diff adding every line, since `git diff` skips untracked files.
function addedFileDiff(file, content) {
  const lines = content.replace(/\n$/, '').split('\n');
  return `+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;
}

// `diff`: `git diff -U0` output. Returns "file:line" for each added comment block of 2+ lines.
function longComments(diff) {
  const found = [];
  let file = null;
  let block = null;
  let inBlock = false;
  const flush = () => {
    if (block && block.lines >= 2) found.push(`${file}:${block.start}`);
    block = null;
  };
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      flush();
      file = raw.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      flush();
      inBlock = false;
      line = Number(hunk[1]);
      continue;
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const text = raw.slice(1).trim();
    const opens = /\/\*/.test(text) && !/\*\//.test(text.slice(text.indexOf('/*') + 2));
    const isComment = inBlock || text.startsWith('//') || opens;
    if (isComment) {
      if (block && block.next === line) block.lines++;
      else {
        flush();
        block = { start: line, lines: 1 };
      }
      block.next = line + 1;
      if (opens) inBlock = true;
      if (inBlock && !opens && /\*\//.test(text)) inBlock = false;
    } else flush();
    line++;
  }
  flush();
  return found;
}

if (require.main === module) {
  const base = process.argv.find((a) => a.startsWith('--staged='))?.slice(9);
  const args = base ? ['diff', '--cached', '-U0', base] : ['diff', '-U0', 'HEAD'];
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
  const untracked = base ? [] : git('ls-files', '--others', '--exclude-standard', '--', 'public').split('\n');
  const diff = [
    git(...args, '--', 'public'),
    ...untracked.filter(Boolean).map((file) => addedFileDiff(file, readFileSync(file, 'utf8'))),
  ].join('');
  const found = longComments(diff);
  if (found.length) {
    console.error(`Comments over one line (CLAUDE.md: one line, the why):\n${found.map((f) => `  ${f}`).join('\n')}`);
    process.exitCode = 1;
  }
}

module.exports = { addedFileDiff, longComments };
