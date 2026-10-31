'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('npm test runs without GIT_* variables', () => {
  assert.deepStrictEqual(
    Object.keys(process.env).filter((k) => k.startsWith('GIT_')),
    [],
  );
});

test('the preload strips GIT_* from what a test spawns', () => {
  const out = execFileSync(
    process.execPath,
    [
      '--require',
      path.join(__dirname, 'gitEnv.js'),
      '-p',
      'Object.keys(process.env).filter((k) => k.startsWith("GIT_")).join()',
    ],
    { env: { ...process.env, GIT_DIR: '/nowhere', GIT_INDEX_FILE: '/nowhere/index' }, encoding: 'utf8' },
  );
  assert.strictEqual(out.trim(), '');
});
