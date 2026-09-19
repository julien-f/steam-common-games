'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { copyText, copyWithFeedback, COPIED_MS } = require('../public/clipboard.ts');

// Same navigator-stubbing shape tableViewPrefs.test.js already uses for its own share button.
function withNavigator(t, clipboard) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
}

// A button flat enough to assert against — .classList is only touched when copiedClass is given.
function fakeBtn(text = '🔗') {
  const classes = new Set();
  return {
    textContent: text,
    title: 'Copy link',
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) },
  };
}

test('copyText: writes to the clipboard and reports success', async (t) => {
  let copied = null;
  withNavigator(t, { writeText: async text => { copied = text; } });
  assert.equal(await copyText('gaben'), true);
  assert.equal(copied, 'gaben');
});

test('copyText: reports failure (prompt fallback) when the Clipboard API is unavailable', async (t) => {
  withNavigator(t, undefined);
  assert.equal(await copyText('gaben'), false);
});

test('copyText: reports failure when writeText rejects (permission denied)', async (t) => {
  withNavigator(t, { writeText: async () => { throw new Error('denied'); } });
  assert.equal(await copyText('gaben'), false);
});

test('copyWithFeedback: swaps label/title/class, then restores them', async (t) => {
  withNavigator(t, { writeText: async () => {} });
  const btn = fakeBtn();
  copyWithFeedback(btn, 'https://example.test/game/400', { copiedText: '✓', copiedClass: 'x--copied' });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(btn.textContent, '✓');
  assert.equal(btn.title, 'Copied!');
  assert.equal(btn.classList.has('x--copied'), true);

  await new Promise(r => setTimeout(r, COPIED_MS + 10));
  assert.equal(btn.textContent, '🔗');
  assert.equal(btn.title, 'Copy link');
  assert.equal(btn.classList.has('x--copied'), false);
});

test('copyWithFeedback: leaves the button alone when the copy failed', async (t) => {
  withNavigator(t, undefined);
  const btn = fakeBtn();
  copyWithFeedback(btn, 'whatever');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(btn.textContent, '🔗');
});
