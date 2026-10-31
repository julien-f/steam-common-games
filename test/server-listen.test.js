'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Express 5 still runs app.listen's callback on a bind error, so it must exit rather than idle.
test('server exits 1 when its port is already taken', { timeout: 20_000 }, async (t) => {
  const holder = net.createServer();
  holder.listen(0, '127.0.0.1');
  await once(holder, 'listening');
  // A cwd without a .env, so only the env below and default.env apply.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-listen-test-'));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        STEAM_API_KEY: 'test-key',
        DB_FILE: '',
        HOST: '127.0.0.1',
        PORT: String(holder.address().port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: t.signal, // kills it on a timeout, should a regression make it idle instead
    });
    child.on('error', () => {}); // the abort above, reported by the timeout itself
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /EADDRINUSE/);
  } finally {
    holder.close();
    fs.rmSync(dir, { recursive: true });
  }
});
