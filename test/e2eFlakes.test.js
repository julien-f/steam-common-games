'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, describeRun } = require('../scripts/e2e-flakes');

// Shaped like Playwright's JSON report under --repeat-each: one spec per repeat, at the same line.
const spec = (title, line, projectName, status, duration, message) => ({
  title,
  file: 'scenarios.spec.ts',
  line,
  tests: [
    {
      projectName,
      status,
      results: [{ duration, ...(message && { error: { message: `\x1b[31m${message}\x1b[39m\nstack` } }) }],
    },
  ],
});

test('summarize: groups the repeats of a test per project, counting failures and the median duration', () => {
  const report = {
    suites: [
      {
        specs: [
          spec('A', 10, 'desktop', 'expected', 100),
          spec('A', 10, 'phone', 'unexpected', 300, 'Expected: 1'),
          spec('B', 20, 'desktop', 'skipped', 0),
        ],
        suites: [
          {
            specs: [
              spec('A', 10, 'desktop', 'expected', 200),
              spec('A', 10, 'phone', 'expected', 500),
              spec('A', 10, 'desktop', 'unexpected', 900, 'Timeout'),
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(summarize(report), [
    {
      title: 'A',
      at: 'scenarios.spec.ts:10',
      project: 'desktop',
      runs: 3,
      failures: 1,
      error: 'Timeout',
      median: 200,
    },
    {
      title: 'A',
      at: 'scenarios.spec.ts:10',
      project: 'phone',
      runs: 2,
      failures: 1,
      error: 'Expected: 1',
      median: 500,
    },
  ]);
});

test('describeRun: one line naming the load and each flaky test with its rate', () => {
  const row = {
    at: '2026-10-30T16:00:00Z',
    repeat: 5,
    load: 12,
    cores: 12,
    seconds: 312,
    loadavg: { median: 18.2, max: 25 },
    failed: [{ title: 'A', at: 'x:1', project: 'phone', failures: 2, runs: 5 }],
  };
  assert.equal(
    describeRun(row),
    '2026-10-30: 5 repeats, +12 threads, load 18.2 (max 25) on 12 cores, 312 s: 1 flaky (A [phone] 2/5)',
  );
});
