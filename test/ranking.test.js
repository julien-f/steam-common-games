'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  EMPTY_RANKING, nextPair, answer, rerank, exclude, ranks, progress, pendingAppids,
} = require('../public/ranking.ts');

// Answers every pair by `score` (higher = better, equal = tie) until nothing is pending.
function runAll(state, source, score) {
  let { state: s, pair } = nextPair(state, source);
  let asked = 0;
  while (pair) {
    asked++;
    const d = score(pair.candidate) - score(pair.opponent);
    ({ state: s, pair } = answer(s, source, d > 0 ? 'candidate' : d < 0 ? 'opponent' : 'tie'));
  }
  return { state: s, asked };
}

test('sorts a source by answers, best first', () => {
  const source = new Set([5, 3, 8, 1, 9, 2, 7]);
  const { state } = runAll(EMPTY_RANKING, source, id => id);
  assert.deepEqual(state.groups, [[9], [8], [7], [5], [3], [2], [1]]);
});

test('uses at most ceil(log2(k+1)) comparisons per insertion', () => {
  const ids = Array.from({ length: 64 }, (_, i) => (i * 37) % 64);
  const { asked } = runAll(EMPTY_RANKING, new Set(ids), id => id);
  let bound = 0;
  for (let k = 0; k < 64; k++) bound += Math.ceil(Math.log2(k + 1));
  assert.ok(asked <= bound, `${asked} > ${bound}`);
});

test('the first game is placed without a comparison', () => {
  const { state, pair } = nextPair(EMPTY_RANKING, new Set([1]));
  assert.equal(pair, null);
  assert.deepEqual(state.groups, [[1]]);
});

test('a tie joins the opponent\'s group and shares its rank', () => {
  const source = new Set([1, 2, 3]);
  const { state } = runAll(EMPTY_RANKING, source, id => (id === 3 ? 2 : 1));
  assert.deepEqual(state.groups, [[3], [1, 2]]);
  assert.deepEqual([...ranks(state, source)], [[3, 1], [1, 2], [2, 2]]);
});

test('skip defers the game until every other pending game is asked', () => {
  const source = new Set([1, 2, 3]);
  let { state, pair } = nextPair(EMPTY_RANKING, source);
  assert.deepEqual(pair, { candidate: 2, opponent: 1 });
  ({ state, pair } = answer(state, source, 'skip'));
  assert.equal(pair.candidate, 3);
  assert.deepEqual(pendingAppids(state, source), [2]);
});

test('excluding the candidate or the opponent removes it from the ranking', () => {
  const source = new Set([1, 2, 3]);
  let { state } = nextPair(EMPTY_RANKING, source);
  ({ state } = answer(state, source, 'exclude-candidate'));
  assert.deepEqual(state.excluded, [2]);
  ({ state } = answer(state, source, 'exclude-opponent'));
  assert.deepEqual(state.excluded, [2, 1]);
  assert.deepEqual(state.groups, [[3]]);
});

test('resumes mid-insertion from a stored state', () => {
  const source = new Set([1, 2, 3, 4, 5]);
  let { state } = runAll(EMPTY_RANKING, new Set([1, 2, 3, 4]), id => id);
  ({ state } = nextPair(state, source));
  ({ state } = answer(JSON.parse(JSON.stringify(state)), source, 'candidate'));
  const { state: done } = runAll(JSON.parse(JSON.stringify(state)), source, id => id);
  assert.deepEqual(done.groups, [[5], [4], [3], [2], [1]]);
});

test('games outside the source keep their stored rank but are skipped at read time', () => {
  const { state } = runAll(EMPTY_RANKING, new Set([1, 2, 3]), id => id);
  const smaller = new Set([1, 3, 4]);
  assert.deepEqual([...ranks(state, smaller)], [[3, 1], [1, 2]]);
  const { state: next, pair } = nextPair(state, smaller);
  assert.deepEqual(pair, { candidate: 4, opponent: 1 });
  const { state: done } = runAll(next, smaller, id => id);
  assert.deepEqual([...ranks(done, new Set([1, 2, 3, 4]))], [[4, 1], [3, 2], [2, 3], [1, 4]]);
});

test('rerank and exclude move a ranked game back to pending / excluded', () => {
  const source = new Set([1, 2, 3]);
  const { state } = runAll(EMPTY_RANKING, source, id => id);
  assert.deepEqual(pendingAppids(rerank(state, 2), source), [2]);
  const ex = exclude(state, 2);
  assert.deepEqual(ex.groups, [[3], [1]]);
  assert.deepEqual(ex.excluded, [2]);
});

test('progress counts ranked/excluded/pending and estimates comparisons left', () => {
  const source = new Set([1, 2, 3, 4]);
  let { state } = nextPair(EMPTY_RANKING, source);
  assert.deepEqual(progress(state, source), { ranked: 1, excluded: 0, pending: 3, remaining: 1 + 2 + 2 });
  ({ state } = runAll(state, source, id => id));
  assert.deepEqual(progress(state, source), { ranked: 4, excluded: 0, pending: 0, remaining: 0 });
});

test('a focus asks only about its unranked games, still against the whole ranking', () => {
  const source = new Set([1, 2, 3, 4, 5, 6]);
  const { state } = runAll(EMPTY_RANKING, new Set([1, 2, 3, 4]), id => id);
  const focus = new Set([6, 2]);
  assert.deepEqual(pendingAppids(state, source, { focus }), [6]);
  const { state: done, asked } = (() => {
    let { state: s, pair } = nextPair(state, source, { focus });
    let n = 0;
    while (pair) {
      assert.equal(pair.candidate, 6);
      n++;
      ({ state: s, pair } = answer(s, source, pair.candidate > pair.opponent ? 'candidate' : 'opponent', { focus }));
    }
    return { state: s, asked: n };
  })();
  assert.ok(asked <= 3);
  assert.deepEqual(done.groups, [[6], [4], [3], [2], [1]]);
  assert.deepEqual(pendingAppids(done, source), [5]);
  assert.equal(progress(done, source, { focus }).pending, 0);
});

test('a focus restarts a mid-way insertion of a game outside it', () => {
  const source = new Set([1, 2, 3]);
  let { state } = runAll(EMPTY_RANKING, new Set([1, 2]), id => id);
  ({ state } = nextPair(state, source));
  assert.equal(state.cursor.appid, 3);
  const { state: focused, pair } = nextPair(state, source, { focus: new Set([1]) });
  assert.equal(pair, null);
  assert.equal(focused.cursor, undefined);
  assert.deepEqual(pendingAppids(focused, source), [3]);
});

test('order asks those games first, then the rest in source order, skipped last', () => {
  const source = new Set([1, 2, 3, 4, 5]);
  const state = { groups: [[1]], excluded: [], skipped: [2] };
  assert.deepEqual(pendingAppids(state, source, { order: [5, 2, 1, 9] }), [5, 3, 4, 2]);
  assert.deepEqual(pendingAppids(state, source, { order: [5, 4], focus: new Set([3, 4]) }), [4, 3]);
  assert.equal(nextPair(state, source, { order: [4] }).pair.candidate, 4);
});

test('the final ranking does not depend on the order games are asked in', () => {
  const source = new Set([3, 1, 4, 5, 9, 2, 6]);
  const run = order => {
    let { state, pair } = nextPair(EMPTY_RANKING, source, { order });
    while (pair) ({ state, pair } = answer(state, source, pair.candidate > pair.opponent ? 'candidate' : 'opponent', { order }));
    return state.groups;
  };
  assert.deepEqual(run([6, 2, 9]), run([]));
});

// 1..n ranked best-first as [[n], …, [1]].
function ranked(n) {
  return runAll(EMPTY_RANKING, new Set(Array.from({ length: n }, (_, i) => i + 1)), id => id).state;
}

test('a re-ranked game that did not move is placed back in 2 answers', () => {
  const source = new Set(Array.from({ length: 64 }, (_, i) => i + 1));
  const state = rerank(ranked(64), 30);
  assert.equal(nextPair(state, source).pair.opponent, 29);
  const { state: done, asked } = runAll(JSON.parse(JSON.stringify(state)), source, id => id);
  assert.equal(asked, 2);
  assert.deepEqual(done.groups, ranked(64).groups);
  assert.equal(done.hints[30], undefined);
});

test('a re-ranked game tied with others is placed back in 1 answer', () => {
  const source = new Set([1, 2, 3, 4]);
  const { state } = runAll(EMPTY_RANKING, source, id => Math.min(id, 3));
  assert.deepEqual(state.groups, [[3, 4], [2], [1]]);
  const { state: done, asked } = runAll(rerank(state, 4), source, id => Math.min(id, 3));
  assert.equal(asked, 1);
  assert.deepEqual(done.groups, [[3, 4], [2], [1]]);
});

test('a re-ranked game gallops to its new place, near or far, up or down', () => {
  const n = 64;
  const source = new Set(Array.from({ length: n }, (_, i) => i + 1));
  for (const [id, newScore] of [[30, 31.5], [30, 27.5], [30, 64.5], [30, 0.5], [64, 0.5], [1, 64.5]]) {
    const score = x => (x === id ? newScore : x);
    const { state: done, asked } = runAll(rerank(ranked(n), id), source, score);
    const expected = [...source].sort((a, b) => score(b) - score(a)).map(x => [x]);
    assert.deepEqual(done.groups, expected, `${id} → ${newScore}`);
    const moved = Math.abs(Math.round(newScore) - id);
    assert.ok(asked <= 2 * Math.ceil(Math.log2(moved + 2)) + 1, `${id} → ${newScore}: ${asked} answers`);
  }
});

test('a hint whose anchor is gone falls back to plain insertion', () => {
  const source = new Set([1, 2, 3, 4, 5]);
  const state = exclude(rerank(ranked(5), 3), 2);
  const { state: done } = runAll(state, source, id => id);
  assert.deepEqual(done.groups, [[5], [4], [3], [1]]);
});

test('skipping a re-ranked game keeps its hint; excluding it drops it', () => {
  const source = new Set([1, 2, 3, 4, 5]);
  let { state } = nextPair(rerank(ranked(5), 3), source);
  ({ state } = answer(state, source, 'skip'));
  assert.equal(state.hints[3], 2);
  assert.equal(nextPair(state, source).pair.opponent, 2);
  ({ state } = answer(state, source, 'exclude-candidate'));
  assert.equal(state.hints[3], undefined);
});

test('progress estimates about 2 answers for a re-ranked game', () => {
  const source = new Set(Array.from({ length: 64 }, (_, i) => i + 1));
  assert.equal(progress(rerank(ranked(64), 30), source).remaining, 2);
});
