'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runAll, runRow, steps, touchesUi } = require('../scripts/check');

test('runAll: every step runs, in order, with its pass/fail and output', async () => {
  const node = process.execPath;
  const results = await runAll([
    ['pass', node, ['-e', 'console.log("fine")']],
    ['fail', node, ['-e', 'console.error("broke"); process.exit(2)']],
  ]);
  assert.deepStrictEqual(
    results.map(({ name, ok, output }) => ({ name, ok, output: output.trim() })),
    [
      { name: 'pass', ok: true, output: 'fine' },
      { name: 'fail', ok: false, output: 'broke' },
    ],
  );
});

test('steps: a full run has every check but e2e; a commit adds e2e and the UI checks only when UI files are staged', () => {
  // Explicit deferE2e: a fix-batch lane runs this under E2E_DEFER=1, which would drop e2e otherwise.
  const names = (staged, files) => steps(staged, files, { deferE2e: false }).map(([name]) => name);
  const always = ['format', 'changelog', 'test', 'doc-refs', 'doc-lint', 'journeys', 'setup'];
  const ui = ['typecheck', 'lint', 'css'];
  assert.deepStrictEqual(names().sort(), [...always, ...ui].sort());
  assert.deepStrictEqual(names('HEAD', ['lib/steam.js', 'docs/dev/data.md', '']).sort(), always.sort());
  assert.deepStrictEqual(names('HEAD', ['public/app.tsx']).sort(), [...always, ...ui, 'e2e'].sort());
  assert.deepStrictEqual(names('HEAD', ['package-lock.json']).sort(), [...always, ...ui, 'e2e'].sort());
  assert.deepStrictEqual(steps('HEAD~1')[1][1], ['check:changelog', '--', '--staged=HEAD~1']);
});

test("steps: E2E_DEFER leaves a commit's e2e to a later run, never its other UI checks", () => {
  const names = steps('HEAD', ['public/app.tsx'], { deferE2e: true }).map(([name]) => name);
  assert.ok(!names.includes('e2e'));
  assert.ok(names.includes('typecheck'));
});

test('runRow: full run or commit, seconds per step, the failed steps', () => {
  const results = [
    { name: 'test', ok: true, ms: 4321 },
    { name: 'lint', ok: false, ms: 1000 },
  ];
  assert.deepStrictEqual(runRow('HEAD', results), { run: 'commit', seconds: { test: 4.3, lint: 1 }, failed: ['lint'] });
  assert.strictEqual(runRow(undefined, []).run, 'full');
});

test('touchesUi: frontend, e2e and their configs count; backend, docs and scripts do not', () => {
  assert.strictEqual(touchesUi(['docs/dev/data.md', 'lib/steam.js', 'scripts/e2e.js']), false);
  assert.strictEqual(touchesUi(['docs/dev/data.md', 'public/panel.tsx']), true);
  assert.strictEqual(touchesUi(['vite.config.js']), true);
});
