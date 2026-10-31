import { createEffect, createSignal, on, onCleanup } from 'solid-js';

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
const SLIDE = 'row-slide';

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

interface ViewState {
  sort: { entries: () => unknown };
  filter: { include: () => unknown; exclude: () => unknown; ranges: () => unknown };
  group: { by: () => unknown };
}

// Not on the text search, which changes on every key. Positions are read on the input starting
// the change: the table has no hook before it re-renders.
export function slideRowsOnViewChange(table: ViewState, container: () => HTMLElement | undefined): void {
  let before: Map<string, number> | null = null;
  const rowsOf = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('tr[data-row-key]')];
  const snapshot = () => {
    const c = container();
    if (!c?.isConnected || prefersReducedMotion()) return;
    const rows = rowsOf(c);
    // Mid-slide, a row's box is where it's drawn, not where it sits.
    for (const row of rows) for (const a of row.getAnimations()) if (a.id === SLIDE) a.cancel();
    before = new Map(rows.map((row) => [row.dataset.rowKey!, row.getBoundingClientRect().top]));
  };
  document.addEventListener('pointerdown', snapshot, true);
  document.addEventListener('keydown', snapshot, true);
  onCleanup(() => {
    document.removeEventListener('pointerdown', snapshot, true);
    document.removeEventListener('keydown', snapshot, true);
  });
  createEffect(
    on(
      [table.sort.entries, table.filter.include, table.filter.exclude, table.filter.ranges, table.group.by],
      () => {
        const from = before;
        before = null;
        const c = container();
        if (!from || !c) return;
        queueMicrotask(() => {
          const duration = durationToken('--dur-3');
          const easing = easeOut();
          for (const row of rowsOf(c)) {
            const top = from.get(row.dataset.rowKey!);
            const dy = top == null ? 0 : top - row.getBoundingClientRect().top;
            if (top == null) void animate(row, [{ opacity: 0 }, { opacity: 1 }], { id: SLIDE, duration, easing });
            else if (dy)
              void animate(row, [{ translate: `0 ${dy}px` }, { translate: '0 0' }], { id: SLIDE, duration, easing });
          }
        });
      },
      { defer: true },
    ),
  );
}

const COUNT_UP_MS = 400;

// The number shown `t` ms into a count from `from` to `to`: easing out, whole at every step.
export function countUpValue(from: number, to: number, t: number, duration: number): number {
  if (t >= duration) return to;
  const k = 1 - (1 - Math.max(0, t) / duration) ** 3;
  return Math.round(from + (to - from) * k);
}

// The number to draw while a numeric value counts to a change, else null. From the last non-zero
// value of the same `key`: lists empty out before each reload, which a count would only replay.
export function createCountUp(value: () => unknown, key: () => string): () => number | null {
  const [shown, setShown] = createSignal<number | null>(null);
  let last: { key: string; n: number } | null = null;
  let frame = 0;
  createEffect(
    on([value, key], ([v, k]) => {
      cancelAnimationFrame(frame);
      setShown(null);
      if (typeof v !== 'number') return void (last = null);
      const from = last?.key === k ? last.n : null;
      if (v !== 0) last = { key: k, n: v };
      if (from == null || v === 0 || from === v || prefersReducedMotion()) return;
      const start = performance.now();
      const step = (now: number) => {
        const t = now - start;
        setShown(t >= COUNT_UP_MS ? null : countUpValue(from, v, t, COUNT_UP_MS));
        if (t < COUNT_UP_MS) frame = requestAnimationFrame(step);
      };
      setShown(from);
      frame = requestAnimationFrame(step);
    }),
  );
  onCleanup(() => cancelAnimationFrame(frame));
  return shown;
}
