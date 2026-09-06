// Bundle fetch/flatten/resolve pipeline — the ITAD-backed data layer behind a bundle's games
// (see docs/list-centric-redesign.md's implementation plan, Phase 4 step 2), extracted from
// bundles.tsx's own inline logic so it's usable both by the new BundlesBrowseRoute/ListRoute
// (bundle kind) and by listResolve.ts's `bundle` ListRef case, decoupled from bundles.tsx's
// bespoke table UI (which stays local to that legacy page until Phase 7 deletes it).

export interface PriceAmount { amount: number; currency: string }

export interface FlatGame {
  gid: string; slug: string; title: string; type: string;
  assets: { boxart?: string } | null;
  tierPrice: number | null; tierCurrency: string | null; addon: boolean;
}

// A flat game that also resolved to a Steam appid.
export type ResolvedGame = FlatGame & { appid: number };

export interface BundleTier {
  price: PriceAmount | null;
  games: { id: string; slug: string; title: string; type: string; assets?: { boxart?: string } | null }[];
  addon: boolean | null;
}

// One bundle as ITAD's /bundles/v1 (via GET /api/bundles or GET /api/bundles/:id) returns it —
// only the fields read here.
export interface Bundle {
  id: number; title: string;
  page: { name?: string } | null;
  counts: { games?: number } | null;
  expiry: string | null;
  url: string | null; details: string | null;
  tiers: BundleTier[];
}

// A game can appear in more than one tier (a cheap tier's games are still included in every
// pricier tier above it) — dedupes by ITAD game id, keeping the cheapest tier's price, since
// ITAD's tiers are observed to always be price-ascending (so "first occurrence wins" is enough,
// no explicit min() needed).
export function flattenBundleGames(bundle: Bundle): FlatGame[] {
  const seen = new Map<string, FlatGame>();
  for (const tier of bundle.tiers || []) {
    for (const g of tier.games || []) {
      if (seen.has(g.id)) continue;
      seen.set(g.id, {
        gid: g.id, slug: g.slug, title: g.title, type: g.type, assets: g.assets ?? null,
        tierPrice: tier.price ? tier.price.amount : null,
        tierCurrency: tier.price ? tier.price.currency : null,
        addon: !!tier.addon,
      });
    }
  }
  return [...seen.values()];
}

export async function fetchBundleById(id: number, { country }: { country?: string } = {}): Promise<Bundle> {
  const qs = country ? `?${new URLSearchParams({ country })}` : '';
  const res = await fetch(`/api/bundles/${id}${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Bundle lookup failed');
  return data;
}

// gid -> Steam appid, or null when that game has no "app/" (store page) listing — a "sub"
// (package/bundle sub) or unresolved entry, same as no Steam listing at all.
export async function resolveBundleAppids(gids: string[]): Promise<Record<string, number | null>> {
  const res = await fetch('/api/bundles/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gids }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Resolution failed');
  return data.appids;
}

// Flattens + resolves + de-dupes-by-appid a whole bundle in one call — the same steps
// bundles.tsx's own openBundle does inline today. A second, distinct ITAD game id occasionally
// resolves to the same Steam appid (an observed ITAD data-quality case) — kept first-occurrence
// (already cheapest-tier-first, from flattenBundleGames), same rule bundles.tsx applies.
export async function resolveBundleGames(bundle: Bundle): Promise<{ resolved: ResolvedGame[]; unresolved: FlatGame[] }> {
  const games = flattenBundleGames(bundle);
  const appidsByGid = await resolveBundleAppids(games.map(g => g.gid));

  const resolved: ResolvedGame[] = [];
  const unresolved: FlatGame[] = [];
  const seenAppids = new Set<number>();
  for (const g of games) {
    const appid = appidsByGid[g.gid];
    if (!appid) { unresolved.push(g); continue; }
    if (seenAppids.has(appid)) continue;
    seenAppids.add(appid);
    resolved.push({ ...g, appid });
  }
  return { resolved, unresolved };
}

// listResolve.ts's ListResolveFetchers.bundle — just the flat, resolved appid set.
export async function fetchBundleAppids(bundleId: string): Promise<Set<number>> {
  const bundle = await fetchBundleById(Number(bundleId));
  const { resolved } = await resolveBundleGames(bundle);
  return new Set(resolved.map(g => g.appid));
}
