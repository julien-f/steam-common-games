type Weights = Record<string, number | null> | null | undefined;

export interface Similar<T> {
  game: T;
  score: number; // 0–100
}

// Cosine over tag weights scaled by rarity (IDF), so tags nearly all `games` carry don't make all alike.
export function similarGames<T extends { appid: number; details?: { tagWeights?: Weights } | null }>(
  target: T,
  games: readonly T[],
  limit: number,
): Similar<T>[] {
  const weighted = games.filter((g) => g.appid !== target.appid && g.details?.tagWeights);
  const targetWeights = target.details?.tagWeights;
  if (!targetWeights) return [];
  const corpus = [targetWeights, ...weighted.map((g) => g.details!.tagWeights!)];
  const df = new Map<string, number>();
  for (const w of corpus) for (const tag of Object.keys(w)) df.set(tag, (df.get(tag) ?? 0) + 1);
  const idf = (tag: string) => Math.log((1 + corpus.length) / (1 + df.get(tag)!));
  const vector = (w: Record<string, number | null>) => {
    const v = new Map<string, number>();
    for (const [tag, weight] of Object.entries(w)) if (weight) v.set(tag, weight * idf(tag));
    return v;
  };
  const norm = (v: Map<string, number>) => Math.hypot(...v.values());
  const t = vector(targetWeights);
  const tNorm = norm(t);
  if (!tNorm) return [];
  return weighted
    .map((game) => {
      const v = vector(game.details!.tagWeights!);
      let dot = 0;
      for (const [tag, x] of v) dot += x * (t.get(tag) ?? 0);
      const vNorm = norm(v);
      return { game, score: vNorm ? Math.round((dot / (tNorm * vNorm)) * 100) : 0 };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
