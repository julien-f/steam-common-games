'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { structureProblems, missingEntry } = require('../scripts/changelog-check');

test('structureProblems: a repeated or unknown subsection in Unreleased; Development is allowed; released versions are ignored', () => {
  const text =
    '## [Unreleased]\n\n### Fixed\n\n- a\n\n### Fixed\n\n- b\n\n### Misc\n\n### Development\n\n- c\n\n## [0.1.0]\n\n### Fixed\n';
  assert.deepStrictEqual(structureProblems(text), ['repeated "### Fixed"', 'unexpected "### Misc"']);
});

test('missingEntry: app code without CHANGELOG.md; tests, docs and tooling alone need none', () => {
  assert.strictEqual(missingEntry(['public/app.tsx']), true);
  assert.strictEqual(missingEntry(['lib/steam.js', 'test/steam.test.js']), true);
  assert.strictEqual(missingEntry(['server.js', 'CHANGELOG.md']), false);
  assert.strictEqual(missingEntry(['test/steam.test.js', 'docs/dev/data.md', 'scripts/doc-refs.js', '']), false);
});

// Run from the pre-commit hook, GIT_INDEX_FILE (absolute under `git commit -a`) would point the
// temp repo's git calls at the index of the commit being made.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

test('--staged checks the staged CHANGELOG.md, not the working tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-check-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();
  const good = '## [Unreleased]\n\n### Development\n\n- a\n- b\n';
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(
      path.join(__dirname, '..', 'scripts', 'changelog-check.js'),
      path.join(dir, 'scripts', 'changelog-check.js'),
    );
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [Unreleased]\n');
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), good);
    const staged = '## [Unreleased]\n\n### Development\n\n- a\n\n### Development\n\n- b\n';
    const blob = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], {
      input: staged,
      encoding: 'utf8',
      env,
    }).trim();
    git('update-index', '--cacheinfo', `100644,${blob},CHANGELOG.md`);
    const run = spawnSync(process.execPath, ['scripts/changelog-check.js', '--staged'], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(run.status, 1);
    assert.match(run.stderr, /repeated "### Development"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
