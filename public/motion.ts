import { createEffect } from 'solid-js';

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

const CASCADE_ROWS = 8;

// A table's first rows come in staggered (`.dt-tr--arrive`), once per call: the caller decides
// what counts as a new load, so a refresh or a view change doesn't replay it.
export function cascadeFirstRows(count: () => number, container: () => HTMLElement | undefined): void {
  let done = false;
  createEffect(() => {
    if (done || !count()) return;
    done = true;
    // Before the rows' first paint, so they don't show and then vanish.
    queueMicrotask(() => {
      const rows = [...(container()?.querySelectorAll<HTMLElement>('tr[data-proc-idx]') ?? [])];
      rows.slice(0, CASCADE_ROWS).forEach((row, i) => {
        row.style.setProperty('--i', String(i));
        row.classList.add('dt-tr--arrive');
        const done = (e: AnimationEvent) => {
          if (e.target !== row) return;
          row.classList.remove('dt-tr--arrive');
          row.style.removeProperty('--i');
          row.removeEventListener('animationend', done);
        };
        row.addEventListener('animationend', done);
      });
    });
  });
}
