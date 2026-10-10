'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callers, argsWithoutUsage, commandKey, parseSession, skillRuns, summarize } = require('../scripts/setup-facts');

test('callers matches script paths and relative requires, not substrings', () => {
  const files = [
    ['package.json', '"check": "node scripts/check.js"'],
    ['scripts/guard.js', "require('./journey-coverage')"],
    ['docs/a.md', 'run `scripts/changelog-check.js` and the check step'],
    ['scripts/check.js', 'scripts/check.js itself'],
    ['test/check.test.js', "require('../scripts/check')"],
  ];
  assert.deepEqual(callers('check', files), ['package.json']);
  assert.deepEqual(callers('journey-coverage', files), ['scripts/guard.js']);
  assert.deepEqual(callers('changelog-check', files), ['docs/a.md']);
});

test('argsWithoutUsage flags argument parsing with no usage line', () => {
  assert.equal(argsWithoutUsage('const [a] = process.argv.slice(2);'), true);
  assert.equal(argsWithoutUsage("process.argv; console.error('Usage: x');"), false);
  assert.equal(argsWithoutUsage('console.log(1);'), false);
});

test('commandKey keeps the command and subcommand, never arguments', () => {
  assert.equal(commandKey('cd /repo && FOO=1 npm run test:one test/a.test.js | tail'), 'npm run test:one');
  assert.equal(commandKey('git diff --stat'), 'git diff');
  assert.equal(commandKey('node scripts/x.js up'), 'node scripts/x.js');
  assert.equal(commandKey('grep -rn secret .'), 'grep');
});

test('parseSession pairs each call with its result: output size, elapsed time, classifier denial', () => {
  const line = (timestamp, content) => JSON.stringify({ timestamp, message: { content } });
  const calls = parseSession([
    line('2026-01-01T00:00:00Z', [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }]),
    line('2026-01-01T00:00:03Z', [{ type: 'tool_result', tool_use_id: 'a', content: 'abcd' }]),
    line('2026-01-01T00:00:04Z', [{ type: 'tool_use', id: 'b', name: 'Read', input: {} }]),
    line('2026-01-01T00:00:05Z', [
      {
        type: 'tool_result',
        tool_use_id: 'b',
        is_error: true,
        content: [{ type: 'text', text: 'Permission for this action was denied' }],
      },
    ]),
    line('2026-01-01T00:00:06Z', [{ type: 'tool_use', id: 'c', name: 'Read', input: {} }]),
  ]);
  assert.deepEqual(calls, [
    { key: 'npm test', bytes: 4, ms: 3000, denied: false },
    { key: 'Read', bytes: 37, ms: 1000, denied: true },
  ]);
});

test('summarize ranks by output and time, and keeps only pairs seen in two sessions', () => {
  const call = (key, bytes = 1, ms = 1) => ({ key, bytes, ms, denied: false });
  const { output, slow, pairs, denied } = summarize([
    [call('a', 100), call('b', 1, 9000)],
    [call('a'), call('b'), call('c')],
  ]);
  assert.deepEqual(
    output.map((k) => k.key),
    ['a', 'b', 'c'],
  );
  assert.equal(slow[0].key, 'b');
  assert.deepEqual(pairs, [{ pair: 'a → b', count: 2, sessions: 2 }]);
  assert.deepEqual(denied, []);
});

test('skillRuns counts slash commands and Skill calls of known skills, each running to the next prompt', () => {
  const line = (timestamp, type, content, extra) => JSON.stringify({ timestamp, type, message: { content }, ...extra });
  const runs = skillRuns(
    [
      line('2026-01-01T00:00:00Z', 'user', '<command-name>/ux-review</command-name>'),
      line('2026-01-01T00:00:01Z', 'user', [{ type: 'text', text: 'Base directory for this skill: x' }]),
      line('2026-01-01T00:00:02Z', 'user', [{ type: 'tool_result', tool_use_id: 'a', content: '' }]),
      line('2026-01-01T00:01:00Z', 'user', 'fix U3'),
      line('2026-01-01T00:01:01Z', 'assistant', [{ type: 'tool_use', name: 'Skill', input: { skill: 'ux-fix' } }]),
      line('2026-01-01T00:01:02Z', 'user', '<command-name>/clear</command-name>'),
      line('2026-01-01T00:03:01Z', 'assistant', []),
    ],
    ['ux-review', 'ux-fix'],
  );
  assert.deepEqual(runs, [
    { skill: 'ux-review', ms: 60_000 },
    { skill: 'ux-fix', ms: 120_000 },
  ]);
});
