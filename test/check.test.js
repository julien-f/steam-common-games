'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runAll, steps } = require('../scripts/check');

test('runAll: every step runs, in order, with its pass/fail, output and env', async () => {
  const node = process.execPath;
  const results = await runAll([
    ['pass', node, ['-e', 'console.log(process.env.X)'], { X: 'from env' }],
    ['fail', node, ['-e', 'console.error("broke"); process.exit(2)']],
  ]);
  assert.deepStrictEqual(
    results.map(({ name, ok, output }) => ({ name, ok, output: output.trim() })),
    [
      { name: 'pass', ok: true, output: 'from env' },
      { name: 'fail', ok: false, output: 'broke' },
    ],
  );
});

test('steps: a full run has every check but e2e; a commit adds e2e and the UI checks only when UI files are staged', () => {
  const names = (...args) => steps(...args).map(([name]) => name);
  const always = ['format', 'changelog', 'test', 'doc-refs', 'journeys'];
  const ui = ['typecheck', 'lint', 'css'];
  assert.deepStrictEqual(names().sort(), [...always, ...ui].sort());
  assert.deepStrictEqual(names('HEAD', ['lib/steam.js', 'docs/dev/data.md', '']).sort(), always.sort());
  assert.deepStrictEqual(names('HEAD', ['public/app.tsx']).sort(), [...always, ...ui, 'e2e'].sort());
  assert.deepStrictEqual(names('HEAD', ['package-lock.json']).sort(), [...always, ...ui, 'e2e'].sort());
  assert.deepStrictEqual(steps('HEAD~1')[1][1], ['check:changelog', '--', '--staged=HEAD~1']);
});
