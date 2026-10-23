'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { portOf } = require('../scripts/ports');

test('portOf: the base in the main checkout, a stable port of its own in each worktree, the env var first', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const main = path.join(dir, 'main');
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  assert.equal(portOf('e2e', main, {}), 28992);
  assert.equal(portOf('mock', main, {}), 58993);
  assert.equal(portOf('e2e', wt, {}), portOf('e2e', wt, {}));
  // e2e stays below Linux's ephemeral range; mock below its top (60999).
  assert.ok(portOf('e2e', wt, {}) > 28992 && portOf('e2e', wt, {}) < 32768);
  assert.ok(portOf('mock', wt, {}) > 58993 && portOf('mock', wt, {}) < 61000);
  assert.equal(portOf('e2e', wt, { E2E_PORT: '29500' }), 29500);
  assert.equal(portOf('mock', wt, { MOCK_PORT: '59500' }), 59500);
});
