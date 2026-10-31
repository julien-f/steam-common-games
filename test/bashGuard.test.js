'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verdict } = require('../scripts/bash-guard');

test('verdict: refuses a process kill by name in command position', () => {
  for (const command of [
    'pkill -f vite',
    'pkill -f "node server.js"; npm run dev',
    'npm test && killall node',
    'cd x\npkill -f vite',
    'sudo pkill vite',
    'kill $(pgrep -f vite)',
    'pgrep -f vite | xargs kill',
  ]) {
    assert.match(verdict(command) ?? '', /scripts\/mock-server\.js down/, command);
  }
});

test('verdict: lets a mention of pkill through', () => {
  for (const command of [
    'grep -n pkill docs/dev/pitfalls.md',
    'git log --oneline -S pkill',
    'pgrep -f vite',
    'kill 1234',
    'node scripts/mock-server.js down',
  ]) {
    assert.equal(verdict(command), null, command);
  }
});

test('the hook blocks with exit 2 and logs the denial, or stays silent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (command) =>
    spawnSync(process.execPath, [path.join(__dirname, '../scripts/bash-guard.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      env: { ...process.env, METRICS_DIR: dir },
      encoding: 'utf8',
    });
  const denied = run('pkill -f vite');
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /never pkill/);
  const allowed = run('ls');
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stderr, '');
  const rows = fs.readFileSync(path.join(dir, 'bash-guard.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).command, 'pkill -f vite');
});
