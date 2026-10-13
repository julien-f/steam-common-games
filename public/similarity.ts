type Weights = Record<string, number | null> | null | undefined;
type TagWeights = Record<string, number | null>;
type Vector = Map<string, number>;
type Tagged = { appid: number; productionTier?: string | null; details?: { tagWeights?: Weights } | null };

// Production Tier as one more dimension: budget is something Steam tags don't say (no "AAA" tag).
const TIER_PREFIX = 'tier:';
function featuresOf(g: Omit<Tagged, 'appid'>): TagWeights {
  const tags = g.details!.tagWeights!;
  return g.productionTier ? { ...tags, [TIER_PREFIX + g.productionTier]: 1 } : tags;
}

// 0 for a tag every game carries, higher the rarer it is.
function inverseFrequency(corpus: readonly TagWeights[]): (tag: string) => number {
  const df = new Map<string, number>();
  for (const w of corpus) for (const tag of Object.keys(w)) df.set(tag, (df.get(tag) ?? 0) + 1);
  return (tag) => Math.log((1 + corpus.length) / (1 + (df.get(tag) ?? 0)));
}

function vectorOf(weights: TagWeights, idf: (tag: string) => number, scale = 1): Vector {
  const v: Vector = new Map();
  for (const [tag, w] of Object.entries(weights)) if (w) v.set(tag, w * scale * idf(tag));
  return v;
}

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  for (const [tag, x] of a) dot += x * (b.get(tag) ?? 0);
  const norms = Math.hypot(...a.values()) * Math.hypot(...b.values());
  return norms ? dot / norms : 0;
}

export interface Similar<T> {
  game: T;
  score: number; // 0–100
}

// Cosine over tag weights scaled by rarity (IDF), so tags nearly all `games` carry don't make all alike.
export function similarGames<T extends Tagged>(target: T, games: readonly T[], limit: number): Similar<T>[] {
  const weighted = games.filter((g) => g.appid !== target.appid && g.details?.tagWeights);
  if (!target.details?.tagWeights) return [];
  const idf = inverseFrequency([featuresOf(target), ...weighted.map(featuresOf)]);
  const t = vectorOf(featuresOf(target), idf);
  return weighted
    .map((game) => ({ game, score: Math.round(cosine(vectorOf(featuresOf(game), idf), t) * 100) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Below this many played games, a profile says more about chance than taste.
const MIN_PLAYED_FOR_PROFILE = 5;

// Tag weights × log playtime (one 2000 h game can't drown the rest) × rarity; null if too few played.
function playProfile(played: readonly { hours: number; weights: TagWeights }[], idf: (tag: string) => number) {
  if (played.length < MIN_PLAYED_FOR_PROFILE) return null;
  const profile: Vector = new Map();
  for (const { hours, weights } of played)
    for (const [tag, x] of vectorOf(weights, idf, Math.log1p(hours))) profile.set(tag, (profile.get(tag) ?? 0) + x);
  return profile;
}

export function topPlayedTags(
  games: readonly (Omit<Tagged, 'appid'> & { playtime?: number })[],
  limit: number,
): string[] {
  const weighted = games.filter((g) => g.details?.tagWeights);
  const idf = inverseFrequency(weighted.map(featuresOf));
  const played = weighted.filter((g) => g.playtime).map((g) => ({ hours: g.playtime!, weights: featuresOf(g) }));
  return [...(playProfile(played, idf) ?? [])]
    .filter(([tag, score]) => score > 0 && !tag.startsWith(TIER_PREFIX))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

// Per game, how close it is (0–100) to each player's play profile; null for a player without one.
export function playerFits(
  games: readonly Tagged[],
  hoursPlayed: readonly ((appid: number) => number | undefined)[],
): Map<number, (number | null)[]> | null {
  const weighted = games.filter((g) => g.details?.tagWeights);
  const idf = inverseFrequency(weighted.map(featuresOf));
  const profiles = hoursPlayed.map((hours) =>
    playProfile(
      weighted.filter((g) => hours(g.appid)).map((g) => ({ hours: hours(g.appid)!, weights: featuresOf(g) })),
      idf,
    ),
  );
  if (!profiles.some(Boolean)) return null;
  return new Map(
    weighted.map((g) => {
      const v = vectorOf(featuresOf(g), idf);
      return [g.appid, profiles.map((p) => (p ? Math.round(cosine(p, v) * 100) : null))];
    }),
  );
}
