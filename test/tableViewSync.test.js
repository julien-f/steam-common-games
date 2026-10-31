'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TABLE_VIEW_PREF_KEYS } = require('../public/tableViewKeys.ts');
const { stripTransientViewFields, diffViewLabels } = require('../public/tableViewSync.ts');

test('TABLE_VIEW_PREF_KEYS: covers every shared table-view pref key', () => {
  assert.deepEqual([...TABLE_VIEW_PREF_KEYS].sort(), [
    'bundleListView',
    'bundlesBrowseView',
    'compareListView',
    'creatorListView',
    'gamePassListView',
    'ownedListView',
    'pickBundleListView',
    'recentListView',
    'sharedListView',
    'wishlistListView',
  ]);
});

test('stripTransientViewFields: drops page and searchQuery, keeps everything else', () => {
  assert.deepEqual(stripTransientViewFields({ pageSize: 25, page: 3, searchQuery: 'portal', sorts: [] }), {
    pageSize: 25,
    sorts: [],
  });
});

test('stripTransientViewFields: undefined input yields an empty object', () => {
  assert.deepEqual(stripTransientViewFields(undefined), {});
});

test('diffViewLabels: names each differing field, deduped and grouped under a shared label', () => {
  const saved = { sorts: [{ key: 'name', dir: 'asc' }], visibleCols: ['name'], filters: {}, excludeFilters: {} };
  const current = {
    sorts: [{ key: 'rating', dir: 'desc' }],
    visibleCols: ['name'],
    filters: { tag: ['Co-op'] },
    excludeFilters: { tag: ['Horror'] },
  };
  assert.deepEqual(diffViewLabels(saved, current), ['Sort', 'Filters']);
});

test('diffViewLabels: page and searchQuery aside', () => {
  const saved = { sorts: [{ key: 'name', dir: 'asc' }] };
  assert.deepEqual(diffViewLabels(saved, { ...saved, page: 2, searchQuery: 'x' }), []);
  assert.deepEqual(diffViewLabels(saved, { rangeFilters: { playtime: { min: '', max: '2' } } }), ['Sort', 'Filters']);
});
