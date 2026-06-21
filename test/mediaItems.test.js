'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMediaItems, resolveShotIndex } = require('../public/mediaItems');

// ── buildMediaItems ───────────────────────────────────────────────────────────

test('buildMediaItems: banner only when details is null', () => {
  const items = buildMediaItems(570, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].shotId, 'banner');
  assert.equal(items[0].type, 'image');
  assert.ok(items[0].main.includes('/570/'));
  assert.equal(items[0].main, items[0].thumb);
});

test('buildMediaItems: banner only when details has no movies or screenshots', () => {
  const items = buildMediaItems(570, {});
  assert.equal(items.length, 1);
  assert.equal(items[0].shotId, 'banner');
});

test('buildMediaItems: includes movies with v<id> shotId', () => {
  const details = {
    movies: [{ id: 256810, thumbnail: 'thumb.jpg', hls: 'video.m3u8' }],
    screenshots: [],
  };
  const items = buildMediaItems(570, details);
  assert.equal(items.length, 2);
  assert.equal(items[1].shotId, 'v256810');
  assert.equal(items[1].type, 'video');
  assert.equal(items[1].hls, 'video.m3u8');
  assert.equal(items[1].thumb, 'thumb.jpg');
});

test('buildMediaItems: includes screenshots with s<id> shotId', () => {
  const details = {
    movies: [],
    screenshots: [
      { id: 0, thumbnail: 'thumb0.jpg', full: 'full0.jpg' },
      { id: 1, thumbnail: 'thumb1.jpg', full: 'full1.jpg' },
    ],
  };
  const items = buildMediaItems(570, details);
  assert.equal(items.length, 3);
  assert.equal(items[1].shotId, 's0');
  assert.equal(items[1].main, 'full0.jpg');
  assert.equal(items[1].thumb, 'thumb0.jpg');
  assert.equal(items[2].shotId, 's1');
});

test('buildMediaItems: movies come before screenshots', () => {
  const details = {
    movies: [{ id: 1, thumbnail: '', hls: '' }],
    screenshots: [{ id: 0, thumbnail: '', full: '' }],
  };
  const items = buildMediaItems(570, details);
  assert.equal(items[0].shotId, 'banner');
  assert.equal(items[1].shotId, 'v1');
  assert.equal(items[2].shotId, 's0');
});

// ── resolveShotIndex ──────────────────────────────────────────────────────────

test('resolveShotIndex: numeric 0 returns 0', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, 0), 0);
});

test('resolveShotIndex: numeric index within range is returned as-is', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 'v1' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, 2), 2);
});

test('resolveShotIndex: numeric index beyond end is clamped to last', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, 99), 1);
});

test('resolveShotIndex: negative numeric index is clamped to 0', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, -1), 0);
});

test('resolveShotIndex: string shotId resolves to correct index', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 'v256810' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, 'banner'), 0);
  assert.equal(resolveShotIndex(shots, 'v256810'), 1);
  assert.equal(resolveShotIndex(shots, 's0'), 2);
});

test('resolveShotIndex: unknown string shotId falls back to 0', () => {
  const shots = [{ shotId: 'banner' }, { shotId: 's0' }];
  assert.equal(resolveShotIndex(shots, 'nonexistent'), 0);
});
