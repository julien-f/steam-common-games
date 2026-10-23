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

export interface PlayerFits {
  byGame: Map<number, (number | null)[]>; // per player, 0–100; null for one without a profile
  profiled: boolean[];
}

// Per game, how close it is to each player's play profile; null when no player has one.
export function playerFits(
  games: readonly Tagged[],
  hoursPlayed: readonly ((appid: number) => number | undefined)[],
): PlayerFits | null {
  const weighted = games.filter((g) => g.details?.tagWeights);
  const idf = inverseFrequency(weighted.map(featuresOf));
  const profiles = hoursPlayed.map((hours) =>
    playProfile(
      weighted.filter((g) => hours(g.appid)).map((g) => ({ hours: hours(g.appid)!, weights: featuresOf(g) })),
      idf,
    ),
  );
  if (!profiles.some(Boolean)) return null;
  const byGame = new Map(
    weighted.map((g) => {
      const v = vectorOf(featuresOf(g), idf);
      return [g.appid, profiles.map((p) => (p ? Math.round(cosine(p, v) * 100) : null))];
    }),
  );
  return { byGame, profiled: profiles.map(Boolean) };
}

export interface LibraryGame {
  appid: number;
  name: string;
  tags: Record<string, number>; // its top LIBRARY_TAGS features
}

// An account's play profile and library, kept to score games outside it (a wishlist, a bundle, a lookup).
export interface Taste {
  at: number;
  profile: Record<string, number> | null; // null: too few games played
  idf: Record<string, number>; // across the library; a tag it lacks gets `unseenIdf`
  unseenIdf: number;
  games: LibraryGame[];
}

// Keeps a large library's entry small; the weakest tags barely move a cosine.
const LIBRARY_TAGS = 10;

const round2 = (x: number) => Math.round(x * 100) / 100;

function topFeatures(g: Omit<Tagged, 'appid'>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(featuresOf(g))
      .filter((e): e is [string, number] => !!e[1])
      .sort((a, b) => b[1] - a[1])
      .slice(0, LIBRARY_TAGS)
      .map(([tag, w]) => [tag, round2(w)]),
  );
}

export function tasteOf(games: readonly (Tagged & { name: string; playtime?: number })[], at: number): Taste | null {
  const weighted = games.filter((g) => g.details?.tagWeights);
  if (!weighted.length) return null;
  const corpus = weighted.map(featuresOf);
  const idf = inverseFrequency(corpus);
  const played = weighted.filter((g) => g.playtime).map((g) => ({ hours: g.playtime!, weights: featuresOf(g) }));
  const profile = playProfile(played, idf);
  const tags = new Set(corpus.flatMap(Object.keys));
  return {
    at,
    profile: profile && Object.fromEntries([...profile].map(([tag, x]) => [tag, round2(x)])),
    idf: Object.fromEntries([...tags].map((tag) => [tag, round2(idf(tag))])),
    unseenIdf: round2(Math.log(1 + corpus.length)),
    games: weighted.map((g) => ({ appid: g.appid, name: g.name, tags: topFeatures(g) })),
  };
}

const idfOf = (taste: Taste) => (tag: string) => taste.idf[tag] ?? taste.unseenIdf;

// The library's games closest to `game`, by the same measure as similarGames.
export function similarInLibrary(taste: Taste, game: Tagged, limit: number): Similar<LibraryGame>[] {
  if (!game.details?.tagWeights) return [];
  const t = vectorOf(topFeatures(game), idfOf(taste));
  return taste.games
    .filter((g) => g.appid !== game.appid)
    .map((g) => ({ game: g, score: Math.round(cosine(vectorOf(g.tags, idfOf(taste)), t) * 100) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Built once per stored taste, not once per scored row.
const profileVectors = new WeakMap<Taste, Vector>();

// 0–100; null for a game without tag weights, or a library with too few games played.
export function fitTo(taste: Taste, game: Omit<Tagged, 'appid'>): number | null {
  if (!taste.profile || !game.details?.tagWeights) return null;
  let profile = profileVectors.get(taste);
  if (!profile) profileVectors.set(taste, (profile = new Map(Object.entries(taste.profile))));
  const v = vectorOf(featuresOf(game), idfOf(taste));
  return Math.round(cosine(profile, v) * 100);
}
