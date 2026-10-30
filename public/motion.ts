// JS-driven motion. CSS animations and transitions are already cut by base.css's reduced-motion
// rule; the Web Animations API isn't, so every JS animation goes through `animate` here.

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Resolves when the animation ends or is cancelled, and at once under reduced motion, so cleanup
// waiting on it (a deferred unmount) always runs.
export function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  const a = el.animate(keyframes, options);
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

// A `--dur-*` token in ms and `--ease-out`, read from tokens.css, which stays their one source.
export function durationToken(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}
export function easeOut(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
}
