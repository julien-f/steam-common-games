'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { animate, countUpValue, prefersReducedMotion } = require('../public/motion.ts');

const setReduced = (reduced) => {
  globalThis.matchMedia = () => ({ matches: reduced });
};
afterEach(() => {
  delete globalThis.matchMedia;
});

const fakeEl = (finished = Promise.resolve()) => ({ animate: mock.fn(() => ({ finished })) });

test('prefersReducedMotion: follows the media query', () => {
  setReduced(true);
  assert.equal(prefersReducedMotion(), true);
  setReduced(false);
  assert.equal(prefersReducedMotion(), false);
});

test('animate: under reduced motion, starts nothing and resolves at once', async () => {
  setReduced(true);
  const el = fakeEl();
  await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  assert.equal(el.animate.mock.callCount(), 0);
});

test('animate: otherwise passes keyframes and options through', async () => {
  setReduced(false);
  const el = fakeEl();
  const kf = [{ opacity: 0 }, { opacity: 1 }];
  await animate(el, kf, { duration: 180 });
  assert.deepEqual(el.animate.mock.calls[0].arguments, [kf, { duration: 180 }]);
});

test('animate: a cancelled animation still resolves', async () => {
  setReduced(false);
  const finished = Promise.reject(new DOMException('cancelled', 'AbortError'));
  await animate(fakeEl(finished), [], {});
});

test('countUpValue: whole numbers that only move toward the target, ending exactly on it', () => {
  for (const [from, to] of [
    [3, 12],
    [124, 37],
  ]) {
    const steps = [0, 50, 100, 200, 300, 399].map((t) => countUpValue(from, to, t, 400));
    assert.equal(steps[0], from);
    for (const n of steps) assert.ok(Number.isInteger(n));
    for (let i = 1; i < steps.length; i++) assert.ok(Math.sign(to - from) * (steps[i] - steps[i - 1]) >= 0);
    assert.equal(countUpValue(from, to, 400, 400), to);
    assert.equal(countUpValue(from, to, 1000, 400), to);
  }
});
