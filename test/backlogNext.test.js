'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { nextNumber } = require('../scripts/backlog-next');

test('nextNumber: one past the highest in any text, so a number only history cites is not reused', () => {
  assert.strictEqual(nextNumber('U', ['**U101 · polish**', 'Closes U111.\n\nSee C200.']), 'U112');
});

test('nextNumber: ignores numbers glued to other words', () => {
  assert.strictEqual(nextNumber('C', ['ABC12 C3PO', '']), 'C1');
});
