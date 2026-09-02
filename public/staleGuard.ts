// Shared "cancel a superseded async call" guard — the same generation-counter idiom
// app.tsx's own `runId`/`thisRun` already used, extracted so bundles.tsx/library.tsx don't each
// hand-roll their own copy under a different name (bundles.tsx's was `openBundleGen`/`gen`).
//
// Usage: call `next()` at the start of the async operation to get this call's own generation
// number, then check `isStale(gen)` at every point afterward where a superseded call must stop
// touching shared state — right after an `await` that could have let a newer call start and
// reset that state in the meantime, and inside any loop (e.g. an SSE/stream read loop) that
// spans multiple awaits, not just once at the top of the function.
export interface StaleGuard {
  next(): number;
  isStale(gen: number): boolean;
  // The generation currently in effect, with no bump — for a caller that isn't itself starting
  // a new generation (e.g. a "↻ Refresh" button re-running work for whatever's already loaded)
  // but still wants its own async work to bail out if a genuinely new load supersedes it while
  // it's in flight.
  current(): number;
}

export function createStaleGuard(): StaleGuard {
  let gen = 0;
  return {
    next: () => ++gen,
    isStale: g => g !== gen,
    current: () => gen,
  };
}
