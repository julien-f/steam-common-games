'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const { parseTrustProxy } = require('../lib/config');

test('parseTrustProxy: TRUST_PROXY=1 trusts one hop, so req.protocol follows X-Forwarded-Proto', async () => {
  const app = express();
  app.set('trust proxy', parseTrustProxy('1'));
  app.get('/', (req, res) => res.send(`${req.protocol} ${req.ip}`));
  const res = await supertest(app).get('/').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '203.0.113.9');
  assert.equal(res.text, 'https 203.0.113.9');
});

test('parseTrustProxy: booleans and address lists pass through as Express reads them', () => {
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
});

test('backendOrigin: where a local client reaches the server, wildcard binds as loopback', () => {
  const { backendOrigin } = require('../lib/config');
  assert.equal(backendOrigin('127.0.0.2', '4321'), 'http://127.0.0.2:4321');
  assert.equal(backendOrigin('0.0.0.0', '3000'), 'http://127.0.0.1:3000');
  assert.equal(backendOrigin('::', '3000'), 'http://127.0.0.1:3000');
  assert.equal(backendOrigin('::1', '3000'), 'http://[::1]:3000');
});

test('env files: shell env beats .env beats default.env, and a missing .env is fine', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  const read = (env) =>
    execFileSync(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(require.resolve('../lib/config'))}); console.log(process.env.HOST, process.env.PORT)`,
      ],
      { cwd: dir, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' },
    ).trim();
  try {
    const defaultPort = /^PORT=(.*)$/m.exec(fs.readFileSync(path.join(__dirname, '..', 'default.env'), 'utf8'))[1];
    assert.equal(read({ HOST: '127.0.0.5' }), `127.0.0.5 ${defaultPort}`);
    fs.writeFileSync(path.join(dir, '.env'), 'HOST=127.0.0.6\nPORT=4444\n');
    assert.equal(read({ HOST: '127.0.0.5' }), '127.0.0.5 4444');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
