'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isFullRun, e2ePort } = require('../scripts/e2e');

test('isFullRun: only a run of the whole suite counts as a pass to record', () => {
  assert.equal(isFullRun([]), true);
  assert.equal(isFullRun(['--reporter=list,json']), true);
  for (const args of [
    ['-g', 'A1:'],
    ['--grep=A1'],
    ['--project=desktop'],
    ['e2e/scenarios.spec.ts'],
    ['--last-failed'],
  ]) {
    assert.equal(isFullRun(args), false, args.join(' '));
  }
});

test('e2ePort: 28992 in the main checkout, a stable port of its own in each worktree, E2E_PORT first', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-port-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const main = path.join(dir, 'main');
  const [a, b] = ['a', 'b'].map((name) => path.join(dir, name));
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  for (const wt of [a, b]) {
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  }
  assert.equal(e2ePort(main, {}), 28992);
  assert.equal(e2ePort(a, {}), e2ePort(a, {}));
  for (const wt of [a, b]) assert.ok(e2ePort(wt, {}) > 28992 && e2ePort(wt, {}) < 32768);
  assert.equal(e2ePort(a, { E2E_PORT: '29500' }), 29500);
});
