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
// row entirely is what let all of that go; see CLAUDE.md's "Frontend reactivity" section.
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

// `null` throughout means "asked, and there's nothing to show" — a failed fetch (news,
// achievements, DLC) or no ITAD key configured (price). Every section renders that as its own
// explicit "couldn't load"/"no pricing data" state, distinct from `undefined` ("not asked yet").
export type PanelNews = NewsItem[] | null;
export type PanelAchievements = Achievements | null;
export type PanelPrice = PriceFields | null;
export type PanelDlc = DlcEntry[] | null;

export interface DlcEntry {
  appid: number;
  name: string;
  capsule: string;
  releaseDate: string;
  comingSoon: boolean;
}

export function createPanelDataCache() {
  const news = new Map<number, PanelNews>();
  const achievements = new Map<string, PanelAchievements>();
  const price = new Map<number, PanelPrice>();
  const dlc = new Map<number, PanelDlc>();

  // Lazily resolved once per session rather than per-call — a plain GET /api/health, cheap to
  // over-share across every game a price is fetched for.
  let itadConfiguredPromise: Promise<boolean> | null = null;
  function isItadConfigured(): Promise<boolean> {
    if (!itadConfiguredPromise) {
      itadConfiguredPromise = fetch('/api/health').then(r => r.json()).then(d => !!d.itadConfigured).catch(() => false);
    }
    return itadConfiguredPromise;
  }

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
      const empty: Achievements = { achievements: [], total: 0, unlocked: 0, private: false, playerCount: memberIds.length, steamUrl: null };
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
      achievements.set(key, null);
      return null;
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
      // "No pricing data available." rather than a stuck loading skeleton, same fallback the
      // list-level price loaders use for a failed batch (see priceLoading.ts).
      price.set(appid, null);
      return null;
    }
  }

  // DLC — unlike the three above, not fetched when the panel opens: the collapsed card's header
  // only needs `details.meta.dlc`'s bare appid *count* (already present for free, see
  // extractAppDetails in lib/steam.js), so the name/capsule-resolving fetch is deferred until the
  // card is actually expanded.
  //
  // Each DLC appid is resolved through the exact same `GET /api/game-details/:appid` every other
  // single-game lookup goes through, not a bespoke batch endpoint: a DLC appid isn't
  // fundamentally different from any other appid this app looks up, so it shouldn't need its own
  // rate-limit policy or its own cap on how many resolve at once. An entry that fails to resolve
  // (delisted, or just rate-limited this time) is dropped rather than surfaced as an error — the
  // rest is still worth showing. Resolving the *full* response (rating/HLTB/tags/ProtonDB too)
  // when only `meta` is displayed is a feature, not waste: it warms that DLC's own cache, so
  // clicking into its panel next opens instantly.
  //
  // `onPartial` is called with a snapshot of the in-progress list (one slot per requested appid,
  // filled in as each resolves) so the card can stream entries in as they land instead of sitting
  // on its skeleton for however long the *slowest* of a Stellaris-sized list takes.
  function peekDlc(appid: number): PanelDlc | undefined {
    return dlc.get(appid);
  }

  async function fetchDlc(
    appid: number,
    dlcIds: readonly number[],
    { force = false, onPartial }: { force?: boolean; onPartial?: (entries: (DlcEntry | undefined)[]) => void } = {},
  ): Promise<PanelDlc> {
    if (!dlcIds.length) {
      dlc.set(appid, []);
      return [];
    }
    // Seeded from the previous complete list (keyed by appid) so a forced refresh keeps showing
    // the old entries in place while each is re-fetched, instead of the list shrinking back to
    // empty and refilling.
    const prevById = new Map((dlc.get(appid) || []).map(d => [d.appid, d]));
    const partial: (DlcEntry | undefined)[] = dlcIds.map(id => prevById.get(id));
    onPartial?.(partial.slice());
    try {
      await Promise.all(dlcIds.map(async (id, i) => {
        try {
          const res = await fetch(`/api/game-details/${id}${force ? '?refresh=1' : ''}`);
          const data = await res.json();
          partial[i] = (res.ok && data.meta)
            ? { appid: id, name: data.meta.name, capsule: data.meta.capsule, releaseDate: data.meta.releaseDate, comingSoon: data.meta.comingSoon }
            : undefined;
        } catch {
          partial[i] = undefined;
        }
        onPartial?.(partial.slice()); // stream this entry in as soon as it resolves
      }));
      const entries = partial.filter((d): d is DlcEntry => d != null);
      dlc.set(appid, entries);
      return entries;
    } catch {
      const value = dlc.get(appid) ?? null;
      dlc.set(appid, value);
      return value;
    }
  }

  return { peekNews, fetchNews, peekAchievements, fetchAchievements, peekPrice, fetchPrice, peekDlc, fetchDlc };
}

const defaultCache = createPanelDataCache();
export const peekNews = defaultCache.peekNews;
export const fetchNews = defaultCache.fetchNews;
export const peekAchievements = defaultCache.peekAchievements;
export const fetchAchievements = defaultCache.fetchAchievements;
export const peekPrice = defaultCache.peekPrice;
export const fetchPrice = defaultCache.fetchPrice;
export const peekDlc = defaultCache.peekDlc;
export const fetchDlc = defaultCache.fetchDlc;
