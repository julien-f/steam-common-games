// Time left for a streaming list load (ListRoute.tsx's per-game details), from how fast it went
// recently: cached games arrive in a burst, then uncached ones at the upstreams' throttled pace,
// so the overall average would promise far too little.
export interface LoadSample {
  t: number; // ms
  loaded: number;
}

// Null until there's enough to go on (samples at least 3 s apart within the window), or when the
// load has stalled over it.
export function etaSeconds(samples: LoadSample[], total: number, windowMs = 20_000): number | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  const first = samples.find((s) => s.t >= last.t - windowMs)!;
  const seconds = (last.t - first.t) / 1000;
  const gained = last.loaded - first.loaded;
  if (seconds < 3 || gained <= 0) return null;
  return Math.round((total - last.loaded) / (gained / seconds));
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return 'less than a minute left';
  return `about ${Math.round(seconds / 60)} min left`;
}
