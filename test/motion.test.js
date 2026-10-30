'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { animate, prefersReducedMotion } = require('../public/motion.ts');

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
