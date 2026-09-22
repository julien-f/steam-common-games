'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  encodeListFormula, decodeListFormula, shareListUrl, SHARED_LIST_PATH,
} = require('../public/listShare.ts');

function dynamicList(id, op, sources) {
  return { id, name: id, parentId: null, order: 0, createdAt: 0, updatedAt: 0, kind: 'dynamic', op, sources };
}

function manualList(id, appids) {
  return { id, name: id, parentId: null, order: 0, createdAt: 0, updatedAt: 0, kind: 'manual', appids };
}

function makeGetList(lists) {
  const map = new Map(lists.map(l => [l.id, l]));
  return id => map.get(id);
}

// ── encodeListFormula: leaf sources ─────────────────────────────────────────────────────────

test('encodeListFormula: encodes owned/wishlist/bundle/recent-games sources', () => {
  const list = {
    op: 'union',
    sources: [
      { kind: 'account-owned', accountId: 'acc1' },
      { kind: 'account-wishlist', accountId: 'acc2' },
      { kind: 'bundle', bundleId: 'b1' },
      { kind: 'recent-games' },
    ],
  };
  const result = encodeListFormula(list, makeGetList([]));
  assert.equal(result.ok, true);
  assert.equal(result.formula, 'union:(o:acc1;w:acc2;b:b1;r)');
});

test('encodeListFormula: percent-encodes a Family accountId\'s "+" join', () => {
  const list = { op: 'union', sources: [
    { kind: 'account-owned', accountId: 'idA+idB' },
    { kind: 'account-owned', accountId: 'idC' },
  ] };
  const result = encodeListFormula(list, makeGetList([]));
  assert.equal(result.ok, true);
  assert.equal(result.formula, 'union:(o:idA%2BidB;o:idC)');
});

test('encodeListFormula: fails on an empty sources list', () => {
  const result = encodeListFormula({ op: 'union', sources: [] }, makeGetList([]));
  assert.deepEqual(result, { ok: false, reason: 'empty' });
});

// ── encodeListFormula: `user` source inlining ───────────────────────────────────────────────

test('encodeListFormula: inlines a `user` source as a `g:` group', () => {
  const inner = dynamicList('inner', 'intersect', [
    { kind: 'account-owned', accountId: 'a1' },
    { kind: 'account-wishlist', accountId: 'a1' },
  ]);
  const outer = { op: 'union', sources: [
    { kind: 'user', listId: 'inner' },
    { kind: 'bundle', bundleId: 'b1' },
  ] };
  const result = encodeListFormula(outer, makeGetList([inner]));
  assert.equal(result.ok, true);
  assert.equal(result.formula, 'union:(g:intersect:(o:a1;w:a1);b:b1)');
});

test('encodeListFormula: inlines nested `user` sources arbitrarily deep', () => {
  const c = dynamicList('c', 'union', [{ kind: 'account-owned', accountId: 'a1' }, { kind: 'account-owned', accountId: 'a2' }]);
  const b = dynamicList('b', 'intersect', [{ kind: 'user', listId: 'c' }, { kind: 'account-wishlist', accountId: 'a3' }]);
  const a = dynamicList('a', 'subtract', [{ kind: 'user', listId: 'b' }, { kind: 'bundle', bundleId: 'b1' }]);
  const result = encodeListFormula(a, makeGetList([a, b, c]));
  assert.equal(result.ok, true);
  assert.equal(
    result.formula,
    'subtract:(g:intersect:(g:union:(o:a1;o:a2);w:a3);b:b1)',
  );
});

test('encodeListFormula: rejects a `user` source pointing at a manual list', () => {
  const manual = manualList('m1', [1, 2, 3]);
  const outer = { op: 'union', sources: [{ kind: 'user', listId: 'm1' }, { kind: 'bundle', bundleId: 'b1' }] };
  const result = encodeListFormula(outer, makeGetList([manual]));
  assert.deepEqual(result, { ok: false, reason: 'manual-source' });
});

test('encodeListFormula: rejects a `user` source that would cycle', () => {
  const a = dynamicList('a', 'union', [{ kind: 'user', listId: 'b' }, { kind: 'bundle', bundleId: 'b1' }]);
  const b = dynamicList('b', 'union', [{ kind: 'user', listId: 'a' }, { kind: 'bundle', bundleId: 'b2' }]);
  const result = encodeListFormula(a, makeGetList([a, b]));
  assert.deepEqual(result, { ok: false, reason: 'cycle-or-too-deep' });
});

test('encodeListFormula: rejects a dangling `user` source', () => {
  const outer = { op: 'union', sources: [{ kind: 'user', listId: 'gone' }, { kind: 'bundle', bundleId: 'b1' }] };
  const result = encodeListFormula(outer, makeGetList([]));
  assert.deepEqual(result, { ok: false, reason: 'cycle-or-too-deep' });
});

// ── decodeListFormula ────────────────────────────────────────────────────────────────────────

test('decodeListFormula: decodes leaf sources', () => {
  const decoded = decodeListFormula('union:(o:acc1;w:acc2;b:b1;r)');
  assert.equal(decoded.op, 'union');
  assert.deepEqual(decoded.sources, [
    { kind: 'account-owned', accountId: 'acc1' },
    { kind: 'account-wishlist', accountId: 'acc2' },
    { kind: 'bundle', bundleId: 'b1' },
    { kind: 'recent-games' },
  ]);
  assert.equal(decoded.synthetic.size, 0);
});

test('decodeListFormula: decodes a percent-encoded accountId back to its raw form', () => {
  const decoded = decodeListFormula('union:(o:idA%2BidB)');
  assert.deepEqual(decoded.sources, [{ kind: 'account-owned', accountId: 'idA+idB' }]);
});

test('decodeListFormula: materializes a `g:` group as a synthetic GameList, referenced by a `user` ListRef', () => {
  const decoded = decodeListFormula('union:(g:intersect:(o:a1;w:a1);b:b1)');
  assert.equal(decoded.sources.length, 2);
  const [groupRef, bundleRef] = decoded.sources;
  assert.equal(groupRef.kind, 'user');
  assert.equal(bundleRef.kind, 'bundle');
  const synth = decoded.synthetic.get(groupRef.listId);
  assert.ok(synth);
  assert.equal(synth.kind, 'dynamic');
  assert.equal(synth.op, 'intersect');
  assert.deepEqual(synth.sources, [
    { kind: 'account-owned', accountId: 'a1' },
    { kind: 'account-wishlist', accountId: 'a1' },
  ]);
});

test('decodeListFormula: rejects malformed input instead of throwing', () => {
  assert.equal(decodeListFormula('not a formula'), null);
  assert.equal(decodeListFormula('bogus-op:(o:a1)'), null);
  assert.equal(decodeListFormula('union:(o:a1'), null); // unclosed paren
  assert.equal(decodeListFormula('union:()'), null); // no sources
});

// ── round trip ───────────────────────────────────────────────────────────────────────────────

test('round trip: encode then decode reconstructs an equivalent nested formula', () => {
  const c = dynamicList('c', 'union', [{ kind: 'account-owned', accountId: 'a1' }, { kind: 'account-owned', accountId: 'a2' }]);
  const b = dynamicList('b', 'intersect', [{ kind: 'user', listId: 'c' }, { kind: 'account-wishlist', accountId: 'a3' }]);
  const encoded = encodeListFormula(b, makeGetList([b, c]));
  assert.equal(encoded.ok, true);
  const decoded = decodeListFormula(encoded.formula);
  assert.equal(decoded.op, 'intersect');
  assert.equal(decoded.sources[0].kind, 'user');
  assert.equal(decoded.sources[1].kind, 'account-wishlist');
  const nestedGroup = decoded.synthetic.get(decoded.sources[0].listId);
  assert.equal(nestedGroup.op, 'union');
  assert.deepEqual(nestedGroup.sources, [
    { kind: 'account-owned', accountId: 'a1' },
    { kind: 'account-owned', accountId: 'a2' },
  ]);
});

// ── shareListUrl ─────────────────────────────────────────────────────────────────────────────

test('shareListUrl: builds a /lists/shared link carrying the formula verbatim (readable, unescaped)', () => {
  const url = shareListUrl('union:(o:acc1;w:acc2)');
  assert.equal(url, `${SHARED_LIST_PATH}?f=union:(o:acc1;w:acc2)`);
});
