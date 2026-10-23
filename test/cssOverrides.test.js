'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findOverrides: findInSheets } = require('../scripts/css-overrides.js');

const findOverrides = (css) => findInSheets([{ file: 'style.css', css }]);

test('findOverrides: a phone rule a later top-level rule overrides', () => {
  const css = '@media (max-width: 768px) {\n  .a { color: red; }\n}\n.a { color: blue; }\n';
  assert.equal(findOverrides(css).length, 1);
});

test('findOverrides: a desktop min-width rule a later top-level rule overrides', () => {
  const css = '@media (min-width: 769px) {\n  .search { max-width: 480px; }\n}\n.search { max-width: 320px; }\n';
  assert.match(
    findOverrides(css)[0],
    /\.search \(@media \(min-width: 769px\)\) is overridden by style.css:4: max-width/,
  );
});

test('findOverrides: a media rule after the base rule, or on other properties, passes', () => {
  const css = '.a { color: blue; }\n@media (min-width: 769px) {\n  .a { color: red; }\n}\n.b { margin: 0; }\n';
  assert.deepEqual(findOverrides(css), []);
});

test('findOverrides: within a layer, a later rule overrides a media rule', () => {
  const css = '@layer legacy {\n  @media (max-width: 768px) {\n    .a { color: red; }\n  }\n  .a { color: blue; }\n}\n';
  assert.equal(findOverrides(css).length, 1);
});

test('findOverrides: a later rule in another layer, or unlayered, passes', () => {
  const css =
    '@layer a {\n  @media (max-width: 768px) {\n    .a { color: red; }\n  }\n}\n@layer b {\n  .a { color: blue; }\n}\n.a { color: green; }\n';
  assert.deepEqual(findOverrides(css), []);
});

test('findOverrides: a later file of the same layer overrides a media rule', () => {
  const sheets = [
    { file: 'a.css', css: '@layer x {\n  @media (max-width: 768px) {\n    .a { color: red; }\n  }\n}\n' },
    { file: 'b.css', css: '@layer x {\n  .a { color: blue; }\n}\n' },
  ];
  assert.deepEqual(findInSheets(sheets), ['a.css:3 .a (@media (max-width: 768px)) is overridden by b.css:2: color']);
  assert.deepEqual(findInSheets(sheets.toReversed()), []);
});
