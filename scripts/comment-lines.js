'use strict';

// Flags comments of three or more lines added under public/ (CLAUDE.md: new comments are one line, two at most).
// Reads only the diff's added lines, so long-form comments already in the tree pass.
//   node scripts/comment-lines.js [--staged=<base>]   the staged commit against <base>, else uncommitted changes and new untracked files

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const MAX_LINES = 2;

// A new file as a diff adding every line, since `git diff` skips untracked files.
function addedFileDiff(file, content) {
  const lines = content.replace(/\n$/, '').split('\n');
  return `+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;
}

// The lines' words without comment markers, space-delimited so a substring test matches whole words.
const words = (texts) =>
  ` ${texts
    .map((t) => t.replace(/^\*+|\/\/+|\/\*+|\*+\/|[{}]/g, ' '))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')} `;

const isCommentLine = (text) => text !== undefined && /^(\/\/|\/\*|\*|\{\/\*)/.test(text.trim());

// `diff`: `git diff -U0` output. Returns "file:line" for each added comment block of 3+ lines, except one whose
// words the diff also removes in order: a moved, re-indented or reflowed comment isn't new.
// `fileLines(file)`, the new file's lines indexed by line number, also flags a comment the diff grows past the
// limit through its unchanged lines: -U0 shows only the added ones.
function longComments(diff, fileLines) {
  const removed = words(
    diff
      .split('\n')
      .filter((raw) => raw.startsWith('-') && !raw.startsWith('---'))
      .map((raw) => raw.slice(1).trim()),
  );
  const found = [];
  let file = null;
  let block = null;
  let inBlock = false;
  let hunkRemoved = 0;
  const flush = () => {
    if (!block) return;
    let start = block.start;
    let end = block.next - 1;
    const lines = fileLines?.(file);
    if (lines) {
      while (isCommentLine(lines[start - 1])) start--;
      while (isCommentLine(lines[end + 1])) end++;
    }
    // Grown past the limit, not an already long-form comment edited (CLAUDE.md leaves those alone).
    const total = end - start + 1;
    const grown = total > MAX_LINES && total - (block.lines - hunkRemoved) <= MAX_LINES;
    if ((block.lines > MAX_LINES || grown) && !removed.includes(words(block.texts))) found.push(`${file}:${start}`);
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
      hunkRemoved = 0;
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('-') && !raw.startsWith('---') && isCommentLine(raw.slice(1))) hunkRemoved++;
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const text = raw.slice(1).trim();
    const opens = /\/\*/.test(text) && !/\*\//.test(text.slice(text.indexOf('/*') + 2));
    const isComment = inBlock || text.startsWith('//') || opens;
    if (isComment) {
      if (block && block.next === line) block.lines++;
      else {
        flush();
        block = { start: line, lines: 1, texts: [] };
      }
      block.texts.push(text);
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
  // Explicit prefixes: a `diff.mnemonicPrefix` config would print `w/`/`i/` paths otherwise.
  const prefixes = ['--src-prefix=a/', '--dst-prefix=b/'];
  const args = base ? ['diff', '--cached', '-U0', ...prefixes, base] : ['diff', '-U0', ...prefixes, 'HEAD'];
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
  const untracked = base ? [] : git('ls-files', '--others', '--exclude-standard', '--', 'public').split('\n');
  const diff = [
    git(...args, '--', 'public'),
    ...untracked.filter(Boolean).map((file) => addedFileDiff(file, readFileSync(file, 'utf8'))),
  ].join('');
  const cache = new Map();
  const fileLines = (file) => {
    if (!cache.has(file)) {
      const text = base ? git('show', `:${file}`) : readFileSync(file, 'utf8');
      cache.set(file, ['', ...text.split('\n')]);
    }
    return cache.get(file);
  };
  const found = longComments(diff, fileLines);
  if (found.length) {
    console.error(
      `Comments over ${MAX_LINES} lines (CLAUDE.md: one line, two at most, the why):\n${found.map((f) => `  ${f}`).join('\n')}`,
    );
    process.exitCode = 1;
  }
}

module.exports = { addedFileDiff, longComments };
