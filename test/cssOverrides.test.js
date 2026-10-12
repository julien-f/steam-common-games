'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findOverrides } = require('../scripts/css-overrides.js');

test('findOverrides: a phone rule a later top-level rule overrides', () => {
  const css = '@media (max-width: 768px) {\n  .a { color: red; }\n}\n.a { color: blue; }\n';
  assert.equal(findOverrides(css).length, 1);
});

test('findOverrides: a desktop min-width rule a later top-level rule overrides', () => {
  const css = '@media (min-width: 769px) {\n  .search { max-width: 480px; }\n}\n.search { max-width: 320px; }\n';
  assert.match(findOverrides(css)[0], /\.search \(@media \(min-width: 769px\)\) is overridden by line 4: max-width/);
});

test('findOverrides: a media rule after the base rule, or on other properties, passes', () => {
  const css = '.a { color: blue; }\n@media (min-width: 769px) {\n  .a { color: red; }\n}\n.b { margin: 0; }\n';
  assert.deepEqual(findOverrides(css), []);
});
