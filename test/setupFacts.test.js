'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  callers,
  argsWithoutUsage,
  commandKey,
  parseSession,
  linesSince,
  skillRuns,
  answerOutcome,
  sessionEvents,
  digest,
  answerStats,
  summarize,
  agentSummary,
} = require('../scripts/setup-facts');

test('callers matches script paths and relative requires, not substrings', () => {
  const files = [
    ['package.json', '"check": "node scripts/check.js"'],
    ['scripts/other.js', "require('./journey-coverage')"],
    ['docs/a.md', 'run `scripts/changelog-check.js` and the check step'],
    ['scripts/check.js', 'scripts/check.js itself'],
    ['test/check.test.js', "require('../scripts/check')"],
  ];
  assert.deepEqual(callers('check', files), ['package.json']);
  assert.deepEqual(callers('journey-coverage', files), ['scripts/other.js']);
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
  assert.equal(commandKey('E2E_PORT=1 git -C /wt commit -F m'), 'git commit');
  assert.equal(commandKey('npm --prefix /wt run test:one a.js'), 'npm run test:one');
});

test('parseSession pairs each call with its result: output size, elapsed time, classifier denial, user rejection', () => {
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
    line('2026-01-01T00:00:07Z', [{ type: 'tool_use', id: 'd', name: 'Edit', input: {} }]),
    line('2026-01-01T00:00:08Z', [
      { type: 'tool_result', tool_use_id: 'd', is_error: true, content: "The user doesn't want to proceed…" },
    ]),
  ]);
  assert.deepEqual(calls, [
    { key: 'npm test', bytes: 4, ms: 3000, error: false, denied: false, rejected: false },
    { key: 'Read', bytes: 37, ms: 1000, error: true, denied: true, rejected: false },
    { key: 'Edit', bytes: 33, ms: 1000, error: true, denied: false, rejected: true },
  ]);
});

test('linesSince keeps entries after the date, and the untimed ones', () => {
  const lines = [
    { timestamp: '2026-01-01T00:00:00Z', n: 1 },
    { n: 2 },
    { timestamp: '2026-01-02T00:00:00Z', n: 3 },
  ].map((l) => JSON.stringify(l));
  assert.deepEqual(
    linesSince(lines, Date.parse('2026-01-01T00:00:00Z')).map((l) => JSON.parse(l).n),
    [2, 3],
  );
});

test("agentSummary: wall time, turns and cache reads per response, failed calls, and the gates' share", () => {
  const usage = (id, cache) => ({ id, usage: { cache_read_input_tokens: cache } });
  const lines = [
    { type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { ...usage('m1', 10), content: [] } },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        ...usage('m1', 100),
        content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'E2E_PORT=1 git commit -F m' } }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:30Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:30Z',
      message: {
        ...usage('m2', 200),
        content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:01:00Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true, content: 'x' }] },
    },
  ].map((l) => JSON.stringify(l));
  assert.deepEqual(agentSummary(lines), { minutes: 1, turns: 2, cacheRead: 300, calls: 2, errors: 1, gateSec: 30 });
});

test('summarize ranks by output and time, and keeps only pairs seen in two sessions', () => {
  const call = (key, bytes = 1, ms = 1) => ({ key, bytes, ms, denied: false, rejected: false });
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

test('summarize lists classifier denials and user rejections per call', () => {
  const call = (key, denied, rejected) => ({ key, bytes: 1, ms: 1, denied, rejected });
  const { denied } = summarize([[call('Edit', false, true), call('Read', true, false), call('Edit', false, true)]]);
  assert.deepEqual(denied, [
    { key: 'Edit', denied: 0, rejected: 2 },
    { key: 'Read', denied: 1, rejected: 0 },
  ]);
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

test('summarize leaves out pairs involving a tool or a read-only command', () => {
  const call = (key) => ({ key, bytes: 1, ms: 1, denied: false, rejected: false });
  const session = [call('Read'), call('grep'), call('Edit'), call('npm test'), call('git commit')];
  assert.deepEqual(
    summarize([session, session]).pairs.map((p) => p.pair),
    ['npm test → git commit'],
  );
});

test('answerOutcome: recommended (marked, else first), another option, free text, clarify or dismiss', () => {
  const q = { options: [{ label: 'A' }, { label: 'B (Recommended)' }, { label: 'C' }] };
  assert.equal(answerOutcome(q, 'B (Recommended)'), 'recommended');
  assert.equal(answerOutcome({ options: [{ label: 'A' }, { label: 'C' }] }, 'A'), 'recommended');
  assert.equal(answerOutcome(q, 'A, C'), 'other');
  assert.equal(answerOutcome(q, 'B, then C28'), 'own');
  assert.equal(answerOutcome(q, '', 'The user wants to clarify these questions.'), 'clarify');
  assert.equal(answerOutcome(q, '', ''), 'dismissed');
});

test('sessionEvents: prompts with the reply before, skill runs, answers, rejections, interrupts and errors', () => {
  const entry = (type, content, extra) => JSON.stringify({ type, message: { content }, ...extra });
  const use = (id, name, input) => entry('assistant', [{ type: 'tool_use', id, name, input }]);
  const result = (id, content, extra) =>
    entry('user', [{ type: 'tool_result', tool_use_id: id, content, is_error: extra?.error }], extra?.entry);
  const question = { question: 'Apply the skill change?', options: [{ label: 'Apply' }, { label: 'Skip' }] };
  const events = sessionEvents(
    [
      entry('user', '<command-name>/setup-review</command-name>'),
      use('q', 'AskUserQuestion', { questions: [question] }),
      result('q', 'answered', { entry: { toolUseResult: { answers: { [question.question]: 'Skip' } } } }),
      entry('assistant', [{ type: 'text', text: 'Done. Key sk_' + 'x'.repeat(30) }]),
      entry('user', 'no, keep the old one'),
      use('b', 'Bash', { command: 'npm run lint -- --fix' }),
      result('b', 'lint broke\nmore', { error: true }),
      use('e', 'Edit', {}),
      result(
        'e',
        "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nnot this file\n\nNote: x",
        { error: true },
      ),
      entry('user', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    ],
    ['setup-review'],
  );
  assert.deepEqual(events, [
    { kind: 'skill', skill: 'setup-review' },
    {
      kind: 'answer',
      skill: 'setup-review',
      question: 'Apply the skill change?',
      answer: 'Skip',
      outcome: 'other',
      setup: true,
    },
    { kind: 'prompt', text: 'no, keep the old one', reply: 'Done. Key […]' },
    { kind: 'error', key: 'npm run lint', text: 'lint broke' },
    { kind: 'rejected', key: 'Edit', reason: 'not this file' },
    { kind: 'interrupt', key: 'Edit' },
  ]);
  assert.match(digest(events), /^== skill setup-review\n {2}\? \[other, setup\] Apply the skill change\? → Skip\n/);
});

test('answerStats counts outcomes per running skill, setup proposals apart', () => {
  const answer = (skill, outcome, setup = false) => ({ kind: 'answer', skill, outcome, setup });
  assert.deepEqual(
    answerStats([[answer('ux-fix', 'recommended'), answer('ux-fix', 'own')], [answer(undefined, 'other', true)]]),
    [
      { name: '- (setup proposals)', recommended: 0, other: 1, own: 0, clarify: 0, dismissed: 0 },
      { name: 'ux-fix', recommended: 1, other: 0, own: 1, clarify: 0, dismissed: 0 },
    ],
  );
});
