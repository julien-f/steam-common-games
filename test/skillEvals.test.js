'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routedTo, dryRunSummary, pool } = require('../scripts/skill-evals');

const assistant = (...content) => ({ type: 'assistant', message: { content } });
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const result = (id, content, isError) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});

test('routedTo: the skill the first tool call loads, past ToolSearch; else none, naming the tool', () => {
  assert.equal(
    routedTo([assistant(use('a', 'ToolSearch')), assistant(use('b', 'Skill', { skill: 'release' }))]),
    'release',
  );
  assert.equal(routedTo([assistant({ type: 'text', text: 'hm' }), assistant(use('a', 'Read'))]), '- (Read)');
  assert.equal(routedTo([{ type: 'result' }]), '-');
});

test('dryRunSummary: cost and turns from the result, failed calls apart from the ones needing approval', () => {
  const s = dryRunSummary(
    [
      assistant(use('a', 'Bash', { command: 'npm run check > /tmp/x' })),
      result('a', 'This command requires approval', true),
      assistant(use('b', 'Bash', { command: 'cat missing' })),
      result('b', 'Exit code 1\nNo such file', true),
      assistant(use('c', 'Read')),
      result('c', 'ok'),
      { type: 'result', total_cost_usd: 0.5, num_turns: 4, duration_ms: 90000 },
    ],
    [],
  );
  assert.deepEqual(s, { cost: 0.5, turns: 4, minutes: 1.5, calls: 3, denied: 1, errors: ['cat: Exit code 1'] });
});

test('pool runs every job, at most `limit` at once, results in order', async () => {
  let running = 0;
  let peak = 0;
  const job = (n) => async () => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n;
  };
  assert.deepEqual(await pool([1, 2, 3, 4, 5].map(job), 2), [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});
