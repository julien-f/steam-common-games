'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  TABLE_VIEW_PREF_KEYS,
} = require('../public/tableViewKeys.ts');
const {
  getBaseline, setBaseline, clearBaseline, resetBaselines, isUnsaved, summarizeViewDiff, stripTransientViewFields,
} = require('../public/tableViewSync.ts');

beforeEach(() => { resetBaselines(); });

test('TABLE_VIEW_PREF_KEYS: covers every shared table-view pref key', () => {
  assert.deepEqual([...TABLE_VIEW_PREF_KEYS].sort(), [
    'bundleListView', 'bundlesBrowseView', 'compareListView', 'ownedListView', 'recentListView', 'wishlistListView',
  ]);
});

// ── baseline get/set/clear/reset ─────────────────────────────────────────────

test('getBaseline: undefined for a key never set', () => {
  assert.equal(getBaseline('ownedListView'), undefined);
});

test('setBaseline/getBaseline: round-trips an entry', () => {
  setBaseline('ownedListView', { value: { pageSize: 25 }, updatedAt: 42 });
  assert.deepEqual(getBaseline('ownedListView'), { value: { pageSize: 25 }, updatedAt: 42 });
});

test('clearBaseline: clears one key without disturbing another', () => {
  setBaseline('ownedListView', { value: {}, updatedAt: 1 });
  setBaseline('wishlistListView', { value: {}, updatedAt: 2 });
  clearBaseline('ownedListView');
  assert.equal(getBaseline('ownedListView'), undefined);
  assert.notEqual(getBaseline('wishlistListView'), undefined);
});

test('resetBaselines: clears every key', () => {
  setBaseline('ownedListView', { value: {}, updatedAt: 1 });
  setBaseline('wishlistListView', { value: {}, updatedAt: 2 });
  resetBaselines();
  assert.equal(getBaseline('ownedListView'), undefined);
  assert.equal(getBaseline('wishlistListView'), undefined);
});

// ── stripTransientViewFields ─────────────────────────────────────────────────

test('stripTransientViewFields: drops page and searchQuery, keeps everything else', () => {
  assert.deepEqual(
    stripTransientViewFields({ pageSize: 25, page: 3, searchQuery: 'portal', sorts: [] }),
    { pageSize: 25, sorts: [] },
  );
});

test('stripTransientViewFields: undefined input yields an empty object', () => {
  assert.deepEqual(stripTransientViewFields(undefined), {});
});

// ── isUnsaved / summarizeViewDiff ────────────────────────────────────────────

test('isUnsaved: false when the current value equals the baseline', () => {
  const view = { sorts: [{ key: 'name', dir: 'asc' }] };
  setBaseline('ownedListView', { value: view, updatedAt: 1 });
  assert.equal(isUnsaved('ownedListView', { sorts: [{ key: 'name', dir: 'asc' }] }), false);
});

test('isUnsaved: true when the current value differs from the baseline', () => {
  setBaseline('ownedListView', { value: { sorts: [{ key: 'name', dir: 'asc' }] }, updatedAt: 1 });
  assert.equal(isUnsaved('ownedListView', { sorts: [{ key: 'rating', dir: 'desc' }] }), true);
});

test('isUnsaved: with no baseline at all, an empty current value is not unsaved', () => {
  assert.equal(isUnsaved('ownedListView', {}), false);
});

test('isUnsaved: with no baseline at all, any non-empty current value is unsaved', () => {
  assert.equal(isUnsaved('ownedListView', { sorts: [{ key: 'name', dir: 'asc' }] }), true);
});

test('isUnsaved/summarizeViewDiff: ignores page and searchQuery', () => {
  setBaseline('ownedListView', { value: { pageSize: 25, page: 1 }, updatedAt: 1 });
  assert.equal(isUnsaved('ownedListView', { pageSize: 25, page: 3, searchQuery: 'portal' }), false);
});

test('summarizeViewDiff: empty when nothing differs', () => {
  setBaseline('ownedListView', { value: { pageSize: 25 }, updatedAt: 1 });
  assert.deepEqual(summarizeViewDiff('ownedListView', { pageSize: 25 }), []);
});

test('summarizeViewDiff: names each differing field, deduped and grouped under a shared label', () => {
  setBaseline('ownedListView', {
    value: { sorts: [{ key: 'name', dir: 'asc' }], visibleCols: ['name'], filters: {}, excludeFilters: {} },
    updatedAt: 1,
  });
  const diff = summarizeViewDiff('ownedListView', {
    sorts: [{ key: 'rating', dir: 'desc' }],
    visibleCols: ['name'],
    filters: { tag: ['Co-op'] },
    excludeFilters: { tag: ['Horror'] },
  });
  assert.deepEqual(diff, ['Sort', 'Filters']);
});
