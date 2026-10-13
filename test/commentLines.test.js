'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addedFileDiff, longComments } = require('../scripts/comment-lines.js');

const diff = (file, start, lines) =>
  `+++ b/${file}\n@@ -0,0 +${start},${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('longComments: two added // lines in a row are flagged', () => {
  assert.deepEqual(longComments(diff('public/a.ts', 10, ['// one', '// two', 'const x = 1;'])), ['public/a.ts:10']);
});

test('longComments: a /* */ or JSX comment over two lines is flagged', () => {
  assert.deepEqual(longComments(diff('public/style.css', 3, ['/* one', '   two */', '.a {}'])), ['public/style.css:3']);
  assert.deepEqual(longComments(diff('public/A.tsx', 7, ['{/* one', '    two */}'])), ['public/A.tsx:7']);
});

test('longComments: one-line comments, and comments split by code, pass', () => {
  assert.deepEqual(longComments(diff('public/a.ts', 1, ['// one', 'const x = 1;', '// two'])), []);
  assert.deepEqual(longComments(diff('public/style.css', 1, ['/* one line */', '.a {}'])), []);
});

test('longComments: lines from separate hunks are not joined', () => {
  const text = `+++ b/public/a.ts\n@@ -1 +1 @@\n+// one\n@@ -9 +9 @@\n+// two\n`;
  assert.deepEqual(longComments(text), []);
});

test('addedFileDiff: a new file reads as all added, so its long comments are flagged', () => {
  assert.deepEqual(longComments(addedFileDiff('public/new.ts', 'const a = 1;\n// one\n// two\n')), ['public/new.ts:2']);
});
