'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { claimPort, isFullRun, listening } = require('../scripts/e2e');

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

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('claimPort: skips a port another live run holds or something listens on', async (t) => {
  const lockDir = tmpDir(t);
  fs.writeFileSync(path.join(lockDir, 'e2e-5000.lock'), String(process.pid));
  const { port, file } = await claimPort(5000, { lockDir, isBusy: async (p) => p === 5001 });
  assert.equal(port, 5002);
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  assert.deepEqual(fs.readdirSync(lockDir).sort(), ['e2e-5000.lock', 'e2e-5002.lock']);
});

test("claimPort: takes over a dead run's lock", async (t) => {
  const lockDir = tmpDir(t);
  // Beyond Linux's default pid_max, so no live process has it.
  fs.writeFileSync(path.join(lockDir, 'e2e-5000.lock'), '99999999');
  assert.equal((await claimPort(5000, { lockDir, isBusy: async () => false })).port, 5000);
});

test('claimPort: a fixed port in use fails instead of moving', async (t) => {
  const lockDir = tmpDir(t);
  await assert.rejects(claimPort(5000, { lockDir, fixed: true, isBusy: async () => true }), /port 5000 \(E2E_PORT\)/);
  assert.deepEqual(fs.readdirSync(lockDir), []);
});

test('listening: true while a server accepts on the port, false once it closes', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address();
  assert.equal(await listening(port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await listening(port), false);
});
