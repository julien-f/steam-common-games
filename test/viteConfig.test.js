'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('vite.config.js: the dev proxy targets the backend at HOST/PORT', () => {
  process.env.HOST = '127.0.0.2';
  process.env.PORT = '4321';
  const { server } = require('../vite.config.js');
  assert.equal(server.proxy['/api'], 'http://127.0.0.2:4321');
  assert.equal(server.proxy['/auth/'].target, 'http://127.0.0.2:4321');
});
