'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addedFileDiff, longComments } = require('../scripts/comment-lines.js');

const diff = (file, start, lines) =>
  `+++ b/${file}\n@@ -0,0 +${start},${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('longComments: three added // lines in a row are flagged, two pass', () => {
  assert.deepEqual(longComments(diff('public/a.ts', 10, ['// one', '// two', '// three', 'const x = 1;'])), [
    'public/a.ts:10',
  ]);
  assert.deepEqual(longComments(diff('public/a.ts', 10, ['// one', '// two', 'const x = 1;'])), []);
});

test('longComments: a /* */ or JSX comment over three lines is flagged', () => {
  assert.deepEqual(longComments(diff('public/style.css', 3, ['/* one', '   two', '   three */', '.a {}'])), [
    'public/style.css:3',
  ]);
  assert.deepEqual(longComments(diff('public/A.tsx', 7, ['{/* one', '    two', '    three */}'])), ['public/A.tsx:7']);
});

test('longComments: short comments, and comments split by code, pass', () => {
  assert.deepEqual(longComments(diff('public/a.ts', 1, ['// one', 'const x = 1;', '// two', '// three'])), []);
  assert.deepEqual(longComments(diff('public/style.css', 1, ['/* one line */', '.a {}'])), []);
});

test('longComments: lines from separate hunks are not joined', () => {
  const text = `+++ b/public/a.ts\n@@ -1,2 +1,2 @@\n+// one\n+// two\n@@ -9 +9 @@\n+// three\n`;
  assert.deepEqual(longComments(text), []);
});

test('addedFileDiff: a new file reads as all added, so its long comments are flagged', () => {
  assert.deepEqual(longComments(addedFileDiff('public/new.ts', 'const a = 1;\n// one\n// two\n// three\n')), [
    'public/new.ts:2',
  ]);
});

test('longComments: a long comment the diff also removes (moved or re-indented) passes', () => {
  const moved = `+++ b/public/style.css\n@@ -1,3 +0,0 @@\n-/* one\n-   two\n-   three */\n@@ -0,0 +9,3 @@\n+  /* one\n+     two\n+     three */\n`;
  assert.deepEqual(longComments(moved), []);
  const edited = moved.replace('+     two', '+     two, edited');
  assert.deepEqual(longComments(edited), ['public/style.css:9']);
});
