'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderOwnersHtml } = require('../public/ownerListHtml');

test('renderOwnersHtml: empty owners list renders nothing', () => {
  assert.equal(renderOwnersHtml([]), '');
});

test('renderOwnersHtml: sorts most-recently-played first', () => {
  const html = renderOwnersHtml([
    { name: 'Alice', minutes: 100, lastPlayedSec: 1000 },
    { name: 'Bob', minutes: 50, lastPlayedSec: 2000 },
  ]);
  assert.ok(html.indexOf('Bob') < html.indexOf('Alice'), 'Bob (more recent) sorts first');
});

test('renderOwnersHtml: never-played owners sort last, alphabetically among themselves', () => {
  const html = renderOwnersHtml([
    { name: 'Zoe', minutes: 0, lastPlayedSec: 0 },
    { name: 'Amy', minutes: 0, lastPlayedSec: 0 },
    { name: 'Rae', minutes: 10, lastPlayedSec: 500 },
  ]);
  const iRae = html.indexOf('Rae');
  const iAmy = html.indexOf('Amy');
  const iZoe = html.indexOf('Zoe');
  assert.ok(iRae < iAmy && iAmy < iZoe);
});

test('renderOwnersHtml: playtime meter width is proportional to the max among these owners', () => {
  const html = renderOwnersHtml([
    { name: 'Alice', minutes: 100, lastPlayedSec: 100 },
    { name: 'Bob', minutes: 50, lastPlayedSec: 50 },
  ]);
  assert.match(html, /width:100%/);
  assert.match(html, /width:50%/);
});

test('renderOwnersHtml: escapes owner names', () => {
  const html = renderOwnersHtml([{ name: '<script>', minutes: 1, lastPlayedSec: 1 }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
