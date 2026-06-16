'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getGameRating } = require('../lib/steam');

function makeReviewResponse(total, positive, desc = 'Very Positive') {
  return {
    ok: true,
    json: async () => ({
      query_summary: { total_reviews: total, total_positive: positive, review_score_desc: desc },
    }),
  };
}

test('getGameRating: returns null when fetch fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  const result = await getGameRating(400);
  assert.equal(result, null);
});

test('getGameRating: returns null when there are no reviews', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(0, 0));
  const result = await getGameRating(400);
  assert.equal(result, null);
});

test('getGameRating: returns correct shape', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.equal(typeof result.score, 'number');
  assert.equal(result.desc, 'Very Positive');
  assert.equal(result.positive, 900);
  assert.equal(result.total, 1000);
});

test('getGameRating: Wilson score is lower than raw ratio', async (t) => {
  // Wilson score accounts for uncertainty, so it's always below pos/total
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  const rawRatio = Math.round((900 / 1000) * 100); // 90
  assert.ok(result.score < rawRatio, `expected Wilson score ${result.score} < raw ratio ${rawRatio}`);
});

test('getGameRating: score is within valid range', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.ok(result.score >= 0 && result.score <= 100, `score out of range: ${result.score}`);
});

test('getGameRating: higher positive ratio yields higher score', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount === 1
      ? makeReviewResponse(1000, 600) // 60% positive
      : makeReviewResponse(1000, 900); // 90% positive
  });

  const low = await getGameRating(1);
  const high = await getGameRating(2);
  assert.ok(high.score > low.score, `expected ${high.score} > ${low.score}`);
});

test('getGameRating: more reviews tightens the confidence interval', async (t) => {
  // Same 80% ratio but 10 vs 10000 reviews — larger sample → score closer to raw ratio
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount === 1
      ? makeReviewResponse(10, 8)       // 80% with few reviews
      : makeReviewResponse(10000, 8000); // 80% with many reviews
  });

  const fewReviews = await getGameRating(1);
  const manyReviews = await getGameRating(2);
  assert.ok(
    manyReviews.score > fewReviews.score,
    `expected larger sample score ${manyReviews.score} > small sample score ${fewReviews.score}`
  );
});
