'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { staleRefs } = require('../scripts/doc-refs');

const ctx = {
  words: new Set(['pickRate']),
  npmScripts: new Set(['check', 'test:e2e']),
  exists: (p) => ['docs/dev/data.md', 'README.md'].includes(p),
  scriptSource: (name) => (name === 'tool.js' ? "args.includes('--fresh')" : undefined),
};

test('staleRefs: resolving references pass', () => {
  const text = [
    '`pickRate()`, `HISTORY`, `lowercase`',
    '[data](dev/data.md#tiers), [readme](../README.md), [site](https://example.com), [top](#setup)',
    '`npm run check`, `npm run -s test:e2e`, `node scripts/tool.js --fresh`',
  ].join('\n');
  assert.deepStrictEqual(staleRefs('docs/x.md', text, ctx), []);
});

test('staleRefs: a missing identifier, link target, npm script, script file and flag, with their line', () => {
  const text = ['`gonePick`', '[x](dev/gone.md)', 'npm run nope', 'scripts/gone.js', 'scripts/tool.js --stale'].join(
    '\n',
  );
  assert.deepStrictEqual(staleRefs('docs/x.md', text, ctx), [
    'docs/x.md:1: `gonePick` not in the code',
    'docs/x.md:2: link to missing dev/gone.md',
    'docs/x.md:3: no npm script "nope"',
    'docs/x.md:4: no scripts/gone.js',
    'docs/x.md:5: scripts/tool.js has no --stale',
  ]);
});
