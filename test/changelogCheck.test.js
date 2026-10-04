'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { structureProblems, missingEntry } = require('../scripts/changelog-check');

test('structureProblems: a repeated or unknown subsection in Unreleased; released versions are ignored', () => {
  const text = '## [Unreleased]\n\n### Fixed\n\n- a\n\n### Fixed\n\n- b\n\n### Misc\n\n## [0.1.0]\n\n### Fixed\n';
  assert.deepStrictEqual(structureProblems(text), ['repeated "### Fixed"', 'unexpected "### Misc"']);
});

test('missingEntry: app code without CHANGELOG.md; tests, docs and tooling alone need none', () => {
  assert.strictEqual(missingEntry(['public/app.tsx']), true);
  assert.strictEqual(missingEntry(['lib/steam.js', 'test/steam.test.js']), true);
  assert.strictEqual(missingEntry(['server.js', 'CHANGELOG.md']), false);
  assert.strictEqual(missingEntry(['test/steam.test.js', 'docs/dev/data.md', 'scripts/doc-refs.js', '']), false);
});
