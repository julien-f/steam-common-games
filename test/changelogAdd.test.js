'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { addEntry } = require('../scripts/changelog-add');

const HEAD = '# Changelog\n\nIntro.\n\n';
const RELEASED = '## [0.1.0] - 2026-01-01\n\n### Fixed\n\n- old\n';

test('addEntry: appends to an existing subsection', () => {
  const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- a\n\n### Development\n\n- d\n\n${RELEASED}`;
  assert.strictEqual(
    addEntry(text, 'Fixed', 'b'),
    `${HEAD}## [Unreleased]\n\n### Fixed\n\n- a\n- b\n\n### Development\n\n- d\n\n${RELEASED}`,
  );
});

test('addEntry: creates a missing subsection in Keep a Changelog order', () => {
  const text = `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n### Development\n\n- d\n\n${RELEASED}`;
  assert.strictEqual(
    addEntry(text, 'Fixed', 'f'),
    `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n\n### Development\n\n- d\n\n${RELEASED}`,
  );
  assert.strictEqual(
    addEntry(`${HEAD}## [Unreleased]\n\n### Fixed\n\n- f\n\n${RELEASED}`, 'Development', 'd'),
    `${HEAD}## [Unreleased]\n\n### Fixed\n\n- f\n\n### Development\n\n- d\n\n${RELEASED}`,
  );
});

test('addEntry: creates Unreleased above the latest release when missing', () => {
  assert.strictEqual(
    addEntry(`${HEAD}${RELEASED}`, 'Changed', 'c'),
    `${HEAD}## [Unreleased]\n\n### Changed\n\n- c\n\n${RELEASED}`,
  );
});
