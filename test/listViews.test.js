'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

beforeEach(() => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  delete require.cache[require.resolve('../public/prefs.ts')];
  delete require.cache[require.resolve('../public/listViews.ts')];
});

const views = () => require('../public/listViews.ts');

test('createListView: stores the view per kind, without page/searchQuery', () => {
  const { createListView, getListViews, getListView } = views();
  const v = createListView('owned', 'Short ones', {
    sorts: [{ key: 'hltbAll', dir: 'asc' }],
    page: 3,
    searchQuery: 'x',
  });
  assert.deepEqual(v.tableView, { sorts: [{ key: 'hltbAll', dir: 'asc' }] });
  assert.deepEqual(getListViews('owned'), [v]);
  assert.deepEqual(getListViews('wishlist'), []);
  assert.deepEqual(getListView('owned', v.id), v);
  assert.equal(getListView('wishlist', v.id), undefined);
});

test('rename, save and delete touch only the targeted view', () => {
  const { createListView, renameListView, saveListViewTable, deleteListView, getListViews } = views();
  const a = createListView('owned', 'A', {});
  const b = createListView('owned', 'B', {});
  renameListView('owned', a.id, 'A2');
  saveListViewTable('owned', b.id, { sorts: [{ key: 'name', dir: 'asc' }], page: 2 });
  assert.deepEqual(
    getListViews('owned').map((v) => [v.name, v.tableView]),
    [
      ['A2', {}],
      ['B', { sorts: [{ key: 'name', dir: 'asc' }] }],
    ],
  );
  deleteListView('owned', a.id);
  assert.deepEqual(
    getListViews('owned').map((v) => v.id),
    [b.id],
  );
});

test('createFromTemplate: adds the template columns to the defaults, once', () => {
  const { VIEW_TEMPLATES, createFromTemplate } = views();
  const playNext = VIEW_TEMPLATES.find((t) => t.id === 'play-next');
  const v = createFromTemplate(playNext, ['name', 'playtime']);
  assert.equal(v.name, 'Play next');
  assert.equal(v.template, 'play-next');
  assert.deepEqual(v.tableView.visibleCols, ['name', 'playtime', 'tasteFit', 'hltbAll']);
  assert.deepEqual(v.tableView.rangeFilters, { playtime: { min: '', max: '2' } });
});

test('Bargains filters on the 1-year and all-time record tiers', () => {
  const { VIEW_TEMPLATES } = views();
  const bargains = VIEW_TEMPLATES.find((t) => t.id === 'bargains');
  assert.deepEqual(bargains.view.filters, { priceStatus: ['All-Time Low', '1-Year Low'] });
});

test('suggestedTemplates: per kind, minus created ones (even renamed), priced ones only with prices', () => {
  const { suggestedTemplates, createFromTemplate, renameListView } = views();
  const ids = (kind, priced) => suggestedTemplates(kind, priced).map((t) => t.id);
  assert.deepEqual(ids('owned', true), ['recently-played', 'play-next']);
  assert.deepEqual(ids('wishlist', true), ['bargains']);
  assert.deepEqual(ids('wishlist', false), []);
  const v = createFromTemplate(suggestedTemplates('owned', true)[0], []);
  renameListView('owned', v.id, 'Lately');
  assert.deepEqual(ids('owned', true), ['play-next']);
});
