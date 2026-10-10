// The side panel's own per-game async data — news, achievements, price, DLC — as plain
// fetch-and-cache functions with no reactivity of their own. panel.tsx wraps each of these in a
// `createResource` keyed on whichever game is open (see its own "Reactivity model" comment), so
// nothing here needs a notion of "the open game".
//
// This replaced panel.tsx's own loadNews/loadAchievements/loadPrice/loadDlc, which each wrote
// their result onto the `Game` object the panel had been handed (`game.news = data.news`,
// `game.priceLoading = true`, …). That single habit is what forced everything else about the
// panel's old reactivity model: a Solid store proxy rejects a direct property write, so the
// panel could only ever be given a deliberately plain *copy* of a store-backed row
// (rowStore.ts's old `panelRows` map), and since a plain object's field writes are invisible to
// Solid, showing anything they fetched needed an explicit `renderPanelBody()` bump — which
// re-rendered the entire panel body, not the one field that changed. Keeping this data off the
// row entirely is what let all of that go; see docs/dev/frontend.md's Reactivity section.
//
// Each result is cached for the session, keyed by appid (plus the account, where the result is
// account-specific), so reopening a game already seen doesn't refetch — the same guarantee the
// old `game.news !== undefined` row-field guards gave, just held here instead of on the row.
// `peek*` exists so panel.tsx's resource fetchers can return a cached value *synchronously*:
// createResource resolves a non-promise return with no pending state at all, so a reopen paints
// the real card immediately instead of flashing its loading skeleton again.
//
// The cache is written as soon as a fetch resolves, even for a game the panel has since moved on
// from — a createResource discards a superseded result, but the request was already paid for, so
// the next open of that game should still be instant. This is also what replaces the old
// `if (panelGame() === game)` staleness guards: nothing here can render anything, so a late
// resolve has nothing to race with.
//
// A factory plus a default instance, same shape (and same testability reasoning) as
// myOwnership.ts's createMyOwnershipCache.
import { achievementsAccountKey, achievementsRequestUrl, achievementsSteamUrl } from './achievementsRequest.ts';
import { applyPriceInfo, postPrices } from './priceLoading.ts';
import { discountPct } from './utils.ts';
import { getStoredRegion, resolveRegion } from './region.ts';
import type { Achievements, NewsItem, PriceFields } from './types.ts';
import type { PickAndMixTier } from './bundleRows.ts';

// `null` throughout means "asked, and there's nothing to show" — a failed fetch (news,
// achievements, DLC) or no ITAD key configured (price). Every section renders that as its own
// explicit "couldn't load"/"no pricing data" state, distinct from `undefined` ("not asked yet").
export type PanelNews = NewsItem[] | null;
export type PanelAchievements = Achievements | null;
export type PanelPrice = PriceFields | null;
export type PanelDlc = DlcEntry[] | null;
export type PanelBundles = GameBundle[] | null;

// One current bundle the game is in — GET /api/game-bundles/:appid (lib/itad.js's extractGameBundles).
export interface GameBundle {
  id: number;
  title: string;
  shop: string | null;
  url: string | null;
  expiry: string | null;
  tierPrice: number | null;
  tierCurrency: string | null;
  tierPriceMax?: number | null;
  pickAndMix?: PickAndMixTier[];
}

export interface DlcEntry {
  appid: number;
  name: string;
  capsule: string;
  releaseDate: string;
  comingSoon: boolean;
}

const DLC_CONCURRENCY = 4;

export function createPanelDataCache() {
  const news = new Map<number, PanelNews>();
  const achievements = new Map<string, PanelAchievements>();
  const price = new Map<number, PanelPrice>();
  const dlcEntries = new Map<number, DlcEntry | null>(); // null: the store has no entry for it
  const bundles = new Map<number, PanelBundles>();

  // Lazily resolved once per session rather than per-call — a plain GET /api/health, cheap to
  // over-share across every game a price is fetched for.
  let itadConfiguredPromise: Promise<boolean> | null = null;
  let itadOff = false; // known not configured, as opposed to not yet asked or a failed /api/health
  function isItadConfigured(): Promise<boolean> {
    if (!itadConfiguredPromise) {
      itadConfiguredPromise = fetch('/api/health')
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          itadOff = !d.itadConfigured;
          return !!d.itadConfigured;
        })
        .catch(() => {
          itadConfiguredPromise = null; // asked again next time, rather than "off" for the session
          return false;
        });
    }
    return itadConfiguredPromise;
  }
  // Read once a price has settled to null, by then the check has resolved.
  const isItadOff = (): boolean => itadOff;

  // News is deliberately NOT part of the host route's rating/HLTB/meta/tags stream (see
  // server.js's newsLimit comment for why) — it's fetched per game, on demand, the first time
  // that game's panel opens.
  function peekNews(appid: number): PanelNews | undefined {
    return news.get(appid);
  }

  async function fetchNews(appid: number, { force = false } = {}): Promise<PanelNews> {
    try {
      const res = await fetch(`/api/game-news/${appid}${force ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'News lookup failed');
      news.set(appid, data.news);
      return data.news;
    } catch {
      // Keep whatever was last successfully loaded rather than wiping it on a failed forced
      // refresh; `null` ("couldn't load") only the first time, when there's no fallback.
      const prev = news.get(appid);
      const value = prev ?? null;
      news.set(appid, value);
      return value;
    }
  }

  // Achievements — per *account*, not just per appid: `achievements[].achieved` is one specific
  // slot's progress, so the account's members are part of the cache key and a switch re-fetches
  // rather than showing the previous account's progress as if it were this one's. With no account
  // at all the list itself is still fetched and shown (names, descriptions, icons and community
  // rarity are store metadata); only the progress half is withheld, via `playerCount: 0`.
  function achievementsKey(appid: number, memberIds: string[]): string {
    return `${appid}:${achievementsAccountKey(memberIds)}`;
  }

  function peekAchievements(appid: number, memberIds: string[]): PanelAchievements | undefined {
    return achievements.get(achievementsKey(appid, memberIds));
  }

  // `achievementCount` (from the game's own store metadata, already streamed in for a loaded row)
  // short-circuits a game with no achievements at all: the route would answer the same thing from
  // its own check, but only after a round trip, and "no achievements" is a large share of any real
  // library.
  async function fetchAchievements(
    appid: number,
    memberIds: string[],
    { force = false, achievementCount }: { force?: boolean; achievementCount?: number | null } = {},
  ): Promise<PanelAchievements> {
    const key = achievementsKey(appid, memberIds);
    if (achievementCount === 0) {
      // The same empty payload the route itself would return — NOT `null`, which renders as
      // "Couldn't load achievements." rather than "This game has no achievements."
      const empty: Achievements = {
        achievements: [],
        total: 0,
        unlocked: 0,
        private: false,
        playerCount: memberIds.length,
        steamUrl: null,
      };
      achievements.set(key, empty);
      return empty;
    }
    try {
      const res = await fetch(achievementsRequestUrl(appid, memberIds, { force }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Achievements lookup failed');
      data.steamUrl = achievementsSteamUrl(appid, memberIds);
      achievements.set(key, data);
      return data;
    } catch {
      const value = achievements.get(key) ?? null;
      achievements.set(key, value);
      return value;
    }
  }

  // A single game's price via the shared POST /api/prices route (the same route a whole list
  // batches through) — only ever called for a game whose price nothing else already loaded; see
  // panel.tsx's own price source for that check.
  function peekPrice(appid: number): PanelPrice | undefined {
    return price.get(appid);
  }

  async function fetchPrice(appid: number, { force = false } = {}): Promise<PanelPrice> {
    try {
      if (!(await isItadConfigured())) {
        price.set(appid, null);
        return null;
      }
      const { prices } = await postPrices({ appids: [appid], country: resolveRegion(getStoredRegion()), force });
      const fields = {} as PriceFields;
      applyPriceInfo(fields, prices[appid], discountPct);
      price.set(appid, fields);
      return fields;
    } catch {
      // "IsThereAnyDeal didn't answer" rather than a stuck loading skeleton; the panel's ↻ retries.
      const value = price.get(appid) ?? null;
      price.set(appid, value);
      return value;
    }
  }

  // Unlike price, fetched even when the row is already priced: no list loads this.
  function peekBundles(appid: number): PanelBundles | undefined {
    return bundles.get(appid);
  }

  async function fetchBundles(appid: number, { force = false } = {}): Promise<PanelBundles> {
    try {
      if (!(await isItadConfigured())) {
        bundles.set(appid, null);
        return null;
      }
      const qs = new URLSearchParams({ country: resolveRegion(getStoredRegion()) });
      if (force) qs.set('refresh', '1');
      const res = await fetch(`/api/game-bundles/${appid}?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bundles lookup failed');
      bundles.set(appid, data.bundles);
      return data.bundles;
    } catch {
      const value = bundles.get(appid) ?? null;
      bundles.set(appid, value);
      return value;
    }
  }

  // DLC — unlike the three above, not fetched when the panel opens: the collapsed card's header
  // only needs `details.meta.dlc`'s bare appid *count* (already present for free, see
  // extractAppDetails in lib/steam.js), so the name/capsule-resolving fetch is deferred until the
  // card is actually expanded, and then covers only the entries it shows (DLC_PAGE at a time, see
  // panel.tsx). Each DLC costs one store-metadata lookup (GET /api/game-meta), at most
  // DLC_CONCURRENCY at once, kept for the session: a game can have hundreds of DLC, and resolving
  // full game details for each used to send hundreds of rating/HLTB/tags/ProtonDB lookups too.
  // A DLC the store has no entry for is left out; one that failed (rate-limited, offline) is
  // tried again on the next call rather than remembered.
  //
  // `onPartial` is called with a snapshot of the in-progress list (one slot per requested appid,
  // filled in as each resolves) so the card can stream entries in as they land instead of sitting
  // on its skeleton for however long the slowest one takes.
  async function fetchDlc(
    dlcIds: readonly number[],
    { onPartial }: { onPartial?: (entries: (DlcEntry | undefined)[]) => void } = {},
  ): Promise<PanelDlc> {
    const known = () => dlcIds.map((id) => dlcEntries.get(id) ?? undefined);
    onPartial?.(known());
    const missing = dlcIds.filter((id) => !dlcEntries.has(id));
    let failed = false;
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const id = missing[next++];
        try {
          const res = await fetch(`/api/game-meta/${id}`);
          const data = await res.json();
          if (!res.ok) failed = true;
          else
            dlcEntries.set(
              id,
              data.meta
                ? {
                    appid: id,
                    name: data.meta.name,
                    capsule: data.meta.capsule,
                    releaseDate: data.meta.releaseDate,
                    comingSoon: data.meta.comingSoon,
                  }
                : null,
            );
        } catch {
          failed = true;
        }
        onPartial?.(known()); // stream this entry in as soon as it resolves
      }
    };
    await Promise.all(Array.from({ length: Math.min(DLC_CONCURRENCY, missing.length) }, worker));
    const entries = dlcIds.map((id) => dlcEntries.get(id)).filter((d): d is DlcEntry => d != null);
    return entries.length || !failed ? entries : null;
  }

  return {
    peekNews,
    fetchNews,
    peekAchievements,
    fetchAchievements,
    peekPrice,
    fetchPrice,
    peekBundles,
    fetchBundles,
    fetchDlc,
    isItadOff,
  };
}

const defaultCache = createPanelDataCache();
export const peekNews = defaultCache.peekNews;
export const fetchNews = defaultCache.fetchNews;
export const peekAchievements = defaultCache.peekAchievements;
export const fetchAchievements = defaultCache.fetchAchievements;
export const peekPrice = defaultCache.peekPrice;
export const fetchPrice = defaultCache.fetchPrice;
export const peekBundles = defaultCache.peekBundles;
export const fetchBundles = defaultCache.fetchBundles;
export const fetchDlc = defaultCache.fetchDlc;
export const isItadOff = defaultCache.isItadOff;
