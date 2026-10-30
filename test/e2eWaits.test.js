'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E2E = path.join(__dirname, '../e2e');

// docs/dev/testing.md#writing-reliable-tests: load closes or stretches a real wait; the fake clock doesn't.
test('e2e: no real-time wait unless its line says why (`// real time: …`)', () => {
  const stray = fs
    .readdirSync(E2E)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(E2E, f), 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `e2e/${f}:${i + 1}` }))
        .filter(({ line }) => /\bwaitForTimeout\(/.test(line) && !line.includes('// real time:'))
        .map(({ at }) => at),
    );
  assert.deepEqual(stray, []);
});
