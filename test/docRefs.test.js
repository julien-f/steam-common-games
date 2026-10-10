'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { headingSlugs, staleRefs } = require('../scripts/doc-refs');

const ctx = {
  words: new Set(['pickRate']),
  npmScripts: new Set(['check', 'test:e2e']),
  exists: (p) => ['docs/x.md', 'docs/dev/data.md', 'README.md'].includes(p),
  slugs: (p) => new Set(p === 'docs/x.md' ? ['setup'] : ['tiers']),
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

test('staleRefs: a missing identifier, link target, heading, npm script, script file and flag, with their line', () => {
  const text = [
    '`gonePick`',
    '[x](dev/gone.md)',
    'npm run nope',
    'scripts/gone.js',
    'scripts/tool.js --stale',
    '[x](dev/data.md#gone), [y](#gone)',
  ].join('\n');
  assert.deepStrictEqual(staleRefs('docs/x.md', text, ctx), [
    'docs/x.md:1: `gonePick` not in the code',
    'docs/x.md:2: link to missing dev/gone.md',
    'docs/x.md:3: no npm script "nope"',
    'docs/x.md:4: no scripts/gone.js',
    'docs/x.md:5: scripts/tool.js has no --stale',
    'docs/x.md:6: no heading #gone in docs/dev/data.md',
    'docs/x.md:6: no heading #gone in docs/x.md',
  ]);
});

test('headingSlugs: GitHub anchors, repeats numbered, code fences skipped', () => {
  const md = ['# Setup', '## Fanatical — `pick` [tiers](x.md)', '## Setup', '```', '# not a heading', '```'].join('\n');
  assert.deepStrictEqual([...headingSlugs(md)], ['setup', 'fanatical--pick-tiers', 'setup-1']);
});
