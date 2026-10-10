'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runAll } = require('../scripts/check');

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
