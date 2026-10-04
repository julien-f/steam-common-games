'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { testTitles, removedLines, yardstick, droppedTests, newMappings } = require('../scripts/guard');
const { parseJourneys } = require('../scripts/journey-coverage');

test('testTitles: test() and test.skip() declarations with escaped quotes; inline test.skip(cond) is not one', () => {
  const src = `test('A1: one', () => {});\n  test("R1 edge: the nav\\"s", () => {});\ntest.skip('B1: later', () => {});\n  test.skip(project !== 'phone', 'x');`;
  const { run, skipped } = testTitles(src);
  assert.deepStrictEqual([...run], ['A1: one', 'R1 edge: the nav"s']);
  assert.deepStrictEqual([...skipped], ['B1: later']);
});

test('removedLines: only removed lines, per file; a new file has none', () => {
  const diff = [
    'diff --git a/e2e/a.spec.ts b/e2e/a.spec.ts',
    '--- a/e2e/a.spec.ts',
    '+++ b/e2e/a.spec.ts',
    '@@ -3 +3 @@',
    "-  await expect(x).toBe('old');",
    "+  await expect(x).toBe('new');",
    'diff --git a/test/new.test.js b/test/new.test.js',
    '--- /dev/null',
    '+++ b/test/new.test.js',
    '+test("x", () => {});',
  ].join('\n');
  assert.deepStrictEqual([...removedLines(diff)], [['e2e/a.spec.ts', ["  await expect(x).toBe('old');"]]]);
});

test('yardstick: protected files, edited tests, package.json scripts and Done-when lines; new tests and deps pass', () => {
  const pkg = {
    base: '{"scripts":{"t":"a"},"dependencies":{"x":"1"}}',
    head: '{"scripts":{"t":"a"},"dependencies":{"x":"2"}}',
  };
  const args = (changed, removed, head = pkg.head) => ({
    changed,
    removed: new Map(removed),
    read: (ref) => (ref === 'B' ? pkg.base : head),
    base: 'B',
    head: 'H',
  });
  assert.deepStrictEqual(yardstick(args(['public/app.tsx', 'test/new.test.js', 'package.json'], [])), []);
  assert.deepStrictEqual(
    yardstick(
      args(
        ['CLAUDE.md', 'e2e/mockApi.ts', 'test/a.test.js', 'docs/dev/journeys.md', 'package.json'],
        [
          ['test/a.test.js', ['x']],
          ['docs/dev/journeys.md', ['- **Done when**: old']],
        ],
        '{"scripts":{"t":"b"}}',
      ),
    ),
    [
      '`CLAUDE.md` is protected',
      '`e2e/mockApi.ts` is protected',
      '`test/a.test.js`: existing test lines changed or removed',
      '`package.json`: scripts changed',
      '`docs/dev/journeys.md`: a Done-when line changed',
    ],
  );
});

test('droppedTests: a base test missing or skipped on the head', () => {
  const base = { run: new Set(['A1: x', 'A2: y']), skipped: new Set() };
  const head = { run: new Set(['A1: x']), skipped: new Set(['A2: y']) };
  assert.deepStrictEqual(droppedTests(base, head), ['A2: y']);
});

test('newMappings: a new test on a ◇ step needs a proof; on a built step it is a yardstick change', () => {
  const md = (target) => `### C6 Co-op\n\n- **Steps**:\n  1. compare\n  2. per-player Played${target ? ' ◇' : ''}\n`;
  const base = [parseJourneys(md(true)), new Set(['C6.1: compare'])];
  const head = [parseJourneys(md(false)), new Set(['C6.1: compare', 'C6.2: played per player', 'C6: whole'])];
  assert.deepStrictEqual(newMappings(base, head), {
    proofs: [
      { title: 'C6.2: played per player', step: 'C6.2' },
      { title: 'C6: whole', step: 'C6.2' },
    ],
    remapped: [{ title: 'C6: whole', step: 'C6.1' }],
  });
});
