// Shapes one raw ITAD bundle-list item (GET /bundles/v1, via this app's own GET /api/bundles)
// into the flat row BundlesBrowseRoute.tsx's table sorts/filters/groups over. Its own module
// rather than a few functions inside that route specifically so it's importable from a Node unit
// test — the route is a .tsx, and Node's type stripping doesn't transform JSX.
//
// Flattened at fetch time rather than read through per-column `value()` accessors so every column
// operates on a plain scalar (`row.shop`, not `row.page?.name`), which is also what the table's
// own filter checklists/group keys are built from.

import { formatMoney } from './utils.ts';

export interface PriceAmount {
  amount: number;
  currency: string;
}

// ITAD-hosted artwork for one game, as the bundle list itself returns it — `boxart` (300×450
// portrait) plus banners at 145/300/400/600 wide. Only `banner145` (145×55, ~7KB) is used: it's
// almost exactly the aspect of the game tables' own capsule thumbnails, so a strip of them reads
// as a bundle "cover" without growing the row. Every asset is optional — an entry ITAD has no
// artwork for (typically a non-game item: a course, a soundtrack) carries an empty object.
export interface GameAssets {
  boxart?: string;
  banner145?: string;
  banner300?: string;
  banner400?: string;
  banner600?: string;
}

// Only the fields actually read — the real response carries more (url, details, note, isMature,
// each tier's own game list, …), none of which the *picker* needs; opening a bundle re-fetches it
// in full via /lists/bundle/:bundleId (bundleData.ts's fetchBundleById).
export interface BundleListItem {
  id: number;
  title: string;
  page: { name?: string } | null;
  counts: { games?: number } | null;
  publish: string | null;
  expiry: string | null;
  tiers: { price: PriceAmount | null; games?: { assets?: GameAssets | null }[] | null }[];
  pickAndMix?: PickAndMixTier[] | null;
}

// Fanatical's quantity tiers for a "Build your own" bundle ITAD prices as null — added by
// server.js from lib/fanatical.js: "pick any `quantity` games for `prices[currency]`".
export interface PickAndMixTier {
  quantity: number;
  prices: Record<string, number>;
}

export interface PickTier {
  quantity: number;
  price: PriceAmount;
}

// In `currency` when Fanatical prices every tier in it, else USD — the same fallback ITAD's own
// USD-only shops land on.
export function pickTiers(raw: PickAndMixTier[] | null | undefined, currency: string): PickTier[] {
  if (!raw?.length) return [];
  const cur = [currency, 'USD'].find((c) => raw.every((t) => typeof t.prices[c] === 'number'));
  return cur ? raw.map((t) => ({ quantity: t.quantity, price: { amount: t.prices[cur], currency: cur } })) : [];
}

export interface PickPlan {
  cost: number;
  currency: string;
  // The tier whose per-game rate is charged.
  tier: PickTier;
  // Picks paid for beyond the selection: rounding up to a tier can beat the rate below it.
  spare: number;
}

// Fanatical charges every pick at the per-game rate of the largest tier reached (6 games at
// "5 for €5.99" = 6 × €1.198); below the smallest tier, that tier is the minimum. The cheapest way
// to take `n` picks is that, or a larger tier's own price with its unused picks free. On a cost
// tie, more picks win.
export function cheapestPicks(tiers: PickTier[], n: number): PickPlan | null {
  if (!tiers.length || n <= 0) return null;
  const sorted = [...tiers].sort((a, b) => a.quantity - b.quantity);
  let plan: PickPlan | null = null;
  sorted.forEach((tier, i) => {
    const taken = Math.max(n, tier.quantity);
    if (sorted[i + 1]?.quantity <= taken) return; // the larger tier's rate applies at `taken`
    const cost = Math.round((taken * Math.round(tier.price.amount * 100)) / tier.quantity) / 100;
    if (!plan || cost < plan.cost || (cost === plan.cost && taken - n > plan.spare))
      plan = { cost, currency: tier.price.currency, tier, spare: taken - n };
  });
  return plan;
}

// The per-game rate `n` picks are charged at; the smallest tier's for none.
export function pickRate(tiers: PickTier[], n: number): PriceAmount | null {
  const plan = cheapestPicks(tiers, Math.max(n, 1));
  return plan && { amount: plan.tier.price.amount / plan.tier.quantity, currency: plan.currency };
}

// The line under the selection toolbar's cost: "7 picks · €1.20/game", or
// "9 picks · 10-game tier · 1 more free" when the plan fills a tier.
export function pickPlanDetail(plan: PickPlan, picks: number): string {
  const how =
    picks + plan.spare === plan.tier.quantity
      ? `${plan.tier.quantity}-game tier`
      : `${formatMoney(plan.tier.price.amount / plan.tier.quantity, plan.currency)}/game`;
  const spare = plan.spare ? ` · ${plan.spare} more free` : '';
  return `${picks} pick${picks === 1 ? '' : 's'} · ${how}${spare}`;
}

// What the plan saves over the same games at their best deals, or `overpays` when it doesn't.
export function pickSavings(plan: PickPlan, bestDeals: number): { text: string; overpays: boolean } {
  const diff = Math.round((bestDeals - plan.cost) * 100) / 100;
  if (diff === 0) return { text: 'same as best deals', overpays: false };
  const amount = formatMoney(Math.abs(diff), plan.currency);
  return diff > 0 ? { text: `saves ${amount}`, overpays: false } : { text: `${amount} more`, overpays: true };
}

// A Steam package one bundle game expands to: its rows share one ITAD gid, price and pick.
export interface BundlePackage {
  gid: string;
  title: string;
  size: number;
  lead: boolean; // the package's first row, the one that carries its pick-and-mix rate
}

// Each ITAD gid spanning several resolved rows, keyed by the rows' appids.
export function bundlePackages(games: { gid: string; title: string; appid: number }[]): Map<number, BundlePackage> {
  const byGid = new Map<string, { title: string; appid: number }[]>();
  for (const g of games) byGid.set(g.gid, [...(byGid.get(g.gid) ?? []), g]);
  const out = new Map<number, BundlePackage>();
  for (const [gid, rows] of byGid)
    if (rows.length > 1)
      rows.forEach((r, i) => out.set(r.appid, { gid, title: rows[0].title, size: rows.length, lead: i === 0 }));
  return out;
}

// Widens a selection change to whole packages: a row ticked since `prev` brings its package-mates,
// one unticked takes them along. `null` when the selection is already whole.
export function wholePackages<T>(
  prev: ReadonlySet<T>,
  next: readonly T[],
  all: readonly T[],
  gidOf: (row: T) => string | undefined,
): T[] | null {
  const nextSet = new Set(next);
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const r of next) if (!prev.has(r) && gidOf(r)) added.add(gidOf(r)!);
  for (const r of prev) if (!nextSet.has(r) && gidOf(r)) removed.add(gidOf(r)!);
  if (!added.size && !removed.size) return null;
  const out = all.filter((r) => {
    const gid = gidOf(r);
    if (gid && removed.has(gid)) return false;
    return nextSet.has(r) || (!!gid && added.has(gid));
  });
  return out.length === next.length && out.every((r) => nextSet.has(r)) ? null : out;
}

export interface BundleRow {
  id: number;
  title: string;
  shop: string | null;
  games: number | null;
  tierCount: number;
  price: number | null;
  currency: string | null;
  // Set when `price` is a pick-and-mix tier's: it buys this many of the bundle's games.
  pickQuantity: number | null;
  publish: string | null;
  expiry: string | null;
  status: string;
  covers: string[];
}

// Cheapest tier that actually has a price — `null` means no tier had one at all (a "Build Your
// Own N Bundle" pick-and-mix format, never a free bundle: a genuinely free/$0 tier still has a
// real, truthy price object, so it groups with the priced tiers rather than with this case).
export function cheapestTierPrice(bundle: BundleListItem): PriceAmount | null {
  const priced = (bundle.tiers || []).filter((t) => t.price);
  if (!priced.length) return null;
  return priced.reduce(
    (min, t) => ((t.price as PriceAmount).amount < min.amount ? (t.price as PriceAmount) : min),
    priced[0].price as PriceAmount,
  );
}

// Local-time `YYYY-MM-DD HH:MM`. Built from the local getters rather than `toISOString()` (what
// bundles.tsx's own fmtExpiry used): ITAD's timestamps carry a real UTC offset, so a late-evening
// local time shifts a day under UTC.
//
// The time is shown, not just the date, because ITAD's timestamps are precise to the second and
// the table genuinely sorts on that precision — several bundles publish on the same calendar day
// (and a bundle that ends "today" ends at a specific hour). Day-only text made a correctly-ordered
// pair of same-day rows look arbitrarily ordered, with nothing on screen to explain the order.
// Split into two halves because the cell stacks them — date on top, time under it, smaller and
// dimmed (see renderDateTime in BundlesBrowseRoute.tsx). That keeps the full HH:MM precision while
// costing the column only as much *width* as the date alone; the rows are already tall enough for
// a second line, since the cover grid sets the row height regardless. Rounding the time to the
// hour to shorten it was considered and rejected — two bundles published at 21:21 and 21:16 on the
// same day (real, live data) would both read "21h", putting back exactly the unexplained ordering
// showing the time was meant to fix.
const pad2 = (n: number) => String(n).padStart(2, '0');

function parseBundleDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtBundleDatePart(iso: string | null | undefined): string {
  const d = parseBundleDate(iso);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '—';
}

// Empty (not '—') for a missing date — the stacked cell renders no second line at all in that
// case, rather than a second em dash under the first.
export function fmtBundleTimePart(iso: string | null | undefined): string {
  const d = parseBundleDate(iso);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
}

// "Sep 25, 20:00" (or "25 sept., 20:00", "9月25日 20:00", …) — the bundle detail card's own format,
// deliberately not the table's ISO one. A card is prose-shaped and read one bundle at a time,
// where `2026-09-25 20:00` looks like a log line; a table column is scanned down a page against
// its own sort, where ISO's fixed width and year-first ordering are the point.
//
// Formatting is `Intl.DateTimeFormat`'s, not hand-assembled: month name, field order, separators
// and 12-vs-24-hour clock are all the viewer's own locale conventions, which is not something to
// reimplement (and not something the app could get right for a viewer it never asked). `locale`
// defaults to the runtime's own — it exists so tests can pin one rather than asserting against
// whatever locale the test runner happens to have.
//
// The year is omitted for the current year, since a bundle ending this year saying so is noise —
// but an archived 2024 bundle must still say 2024.
export function fmtBundleDateFriendly(
  iso: string | null | undefined,
  { time = false, now = Date.now(), locale }: { time?: boolean; now?: number; locale?: string } = {},
): string {
  const d = parseBundleDate(iso);
  if (!d) return '—';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (!sameYear) opts.year = 'numeric';
  if (time) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return d.toLocaleString(locale, opts);
}

// The flat one-line form, still what the column's own `format` returns — it's the text the table's
// search matches against and the fallback whenever a cell isn't rendered through `render`.
export function fmtBundleDateTime(iso: string | null | undefined): string {
  const time = fmtBundleTimePart(iso);
  return time ? `${fmtBundleDatePart(iso)} ${time}` : fmtBundleDatePart(iso);
}

// The first `max` distinct game banners in the bundle (four, laid out 2×2 by the cover cell), in
// tier order — cheapest tier first, which
// is also the order the shop itself advertises. There is no bundle-level image anywhere in ITAD's
// data, so a bundle's "cover" can only ever be built out of its games' own artwork. Deduped by
// URL: a game unlocked at several tiers is listed in each of them (the same reason
// bundleData.ts's flattenBundleGames dedupes), and the same banner three times would read as
// three different games.
export function bundleCovers(bundle: BundleListItem, max = 4): string[] {
  const seen = new Set<string>();
  for (const tier of bundle.tiers || []) {
    for (const game of tier.games || []) {
      const url = game?.assets?.banner145;
      if (url) seen.add(url);
      if (seen.size >= max) return [...seen];
    }
  }
  return [...seen];
}

// A stable hue (0-359) for a shop name, so each shop's chip keeps one consistent color. Hashed
// from the name rather than looked up in a hand-maintained {shop: color} map, for the same reason
// the Production Tier heuristic refuses a publisher allowlist (see docs/dev/decisions.md): ITAD lists shops
// this app has never heard of, and a map would silently fall back to one shared default color for
// every one of them. The cost is that a shop ITAD spells two ways (observed live:
// "GreenManGaming" and "GreenMan Gaming") gets two colors — but those genuinely are two distinct
// values everywhere else in this table too, including its own filter checklist and grouping.
// Only the hue is derived; saturation/lightness are fixed in CSS, so no hash can produce an
// unreadable chip.
export function shopHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export interface BundleTierSummary {
  price: number | null;
  currency: string | null;
  gameCount: number;
  // Set on a Fanatical pick-and-mix tier: how many of the `gameCount` games this price picks.
  quantity?: number;
}

// One entry per tier, cheapest first (ITAD's tiers are observed to always be price-ascending), for
// the bundle detail card's "$5 · $15 · $25" line. `gameCount` is that tier's *own* game list as
// ITAD returns it — pricier tiers include everything the cheaper ones unlock, so these deliberately
// don't sum to the bundle's total; the card labels them as tiers, not as a partition. A `null`
// price is a pick-and-mix ("Build Your Own") tier, rendered "Varies" like everywhere else, never
// as free. Kept here (pure, unit-tested) rather than inline in ListRoute.tsx's JSX.
// Fanatical's quantity tiers stand in for ITAD's lone null-price tier when `currency` is given and they're known.
export function bundleTierSummary(
  bundle: {
    tiers?: { price?: PriceAmount | null; games?: unknown[] | null }[] | null;
    pickAndMix?: PickAndMixTier[] | null;
  },
  currency?: string,
): BundleTierSummary[] {
  const picks = currency ? pickTiers(bundle.pickAndMix, currency) : [];
  if (picks.length && (bundle.tiers || []).every((t) => !t.price)) {
    const pool = Math.max(0, ...(bundle.tiers || []).map((t) => (t.games || []).length));
    return picks.map((t) => ({
      price: t.price.amount,
      currency: t.price.currency,
      gameCount: pool,
      quantity: t.quantity,
    }));
  }
  return (bundle.tiers || []).map((tier) => ({
    price: tier.price ? tier.price.amount : null,
    currency: tier.price ? tier.price.currency : null,
    gameCount: (tier.games || []).length,
  }));
}

export interface BundleUrgency {
  tier: 'ended' | 'urgent' | 'soon' | 'later';
  label: string;
}

// How much time is left on a bundle, as the Ends cell renders it: a color tier plus a short
// relative label. `later` carries no label at all — past a week out, the date itself says
// everything, and a "in 23d" on every row would be noise competing with the rows that are
// genuinely about to go. `null` (no expiry at all) is an open-ended bundle, not a missing date.
//
// Inside the last day the label counts hours rather than saying "<1d" — that's the window where
// the difference between 20 hours and 2 hours actually changes what you do about it, and it's the
// only place this granularity is worth the extra text. Past 24h it goes back to whole days: "in
// 30h" is harder to read at a glance than "in 1d" and no more actionable.
export function bundleUrgency(expiry: string | null | undefined, now: number = Date.now()): BundleUrgency | null {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (isNaN(t)) return null;
  const hours = (t - now) / 3600000;
  if (hours <= 0) return { tier: 'ended', label: 'ended' };
  // Floored, so "in 1h" always means at least an hour is genuinely left; under that there's no
  // whole hour to name, hence "<1h" rather than a rounded-up "in 1h" that overstates it.
  if (hours < 1) return { tier: 'urgent', label: '<1h' };
  if (hours < 24) return { tier: 'urgent', label: `in ${Math.floor(hours)}h` };
  if (hours < 48) return { tier: 'urgent', label: 'in 1d' };
  const days = Math.floor(hours / 24);
  if (hours < 24 * 7) return { tier: 'soon', label: `in ${days}d` };
  return { tier: 'later', label: '' };
}

// The urgency tier as a plain label — what the browse table's hidden "Ends in" column filters and
// groups on, and what its hero card's "Ending soon" tile toggles. `Open-ended` is a named bucket
// rather than the table's generic "(none)": a bundle with no end date is a real case, not missing
// data.
export const ENDS_IN = {
  urgent: 'Within 48h',
  soon: 'This week',
  later: 'Later',
  open: 'Open-ended',
  ended: 'Ended',
} as const;

// Soonest-first, for the column's own comparator: alphabetically these order Ended < Later <
// Open-ended < This week < Within 48h, which says nothing about urgency.
const ENDS_IN_ORDER: string[] = [ENDS_IN.urgent, ENDS_IN.soon, ENDS_IN.later, ENDS_IN.open, ENDS_IN.ended];

export function bundleEndsIn(expiry: string | null | undefined, now: number = Date.now()): string {
  const urgency = bundleUrgency(expiry, now);
  return urgency ? ENDS_IN[urgency.tier] : ENDS_IN.open;
}

// Values only, no rows — the shape `ColumnDef.compare` takes, which also orders the column's
// filter checklist and its group headers.
export function compareEndsIn(a: unknown, b: unknown): number {
  return ENDS_IN_ORDER.indexOf(String(a)) - ENDS_IN_ORDER.indexOf(String(b));
}

// The publish-side counterpart of ENDS_IN, for the browse table's hidden "Age" column and the
// "New" tile that toggles it — "what appeared since I last looked" is the other half of the
// browsing question, and the Published column can only answer it by being sorted and read.
export const BUNDLE_AGE = {
  fresh: 'Last 24h',
  week: 'This week',
  older: 'Older',
  unknown: 'Unknown',
} as const;

const BUNDLE_AGE_ORDER: string[] = [BUNDLE_AGE.fresh, BUNDLE_AGE.week, BUNDLE_AGE.older, BUNDLE_AGE.unknown];

export function bundleAge(publish: string | null | undefined, now: number = Date.now()): string {
  const d = parseBundleDate(publish);
  if (!d) return BUNDLE_AGE.unknown;
  const hours = (now - d.getTime()) / 3600000;
  if (hours < 24) return BUNDLE_AGE.fresh;
  if (hours < 24 * 7) return BUNDLE_AGE.week;
  return BUNDLE_AGE.older;
}

// Newest-first, the direction this column is actually read in — see compareEndsIn.
export function compareBundleAge(a: unknown, b: unknown): number {
  return BUNDLE_AGE_ORDER.indexOf(String(a)) - BUNDLE_AGE_ORDER.indexOf(String(b));
}

// `now` is a parameter purely so the Active/Expired split is testable without freezing the clock.
// A bundle with no expiry at all counts as Active — that's how ITAD represents an open-ended one,
// not a missing date to guess at.
// `currency` picks which of Fanatical's pick-and-mix prices stands in for a null tier price.
export function toBundleRow(bundle: BundleListItem, now: number = Date.now(), currency = 'USD'): BundleRow {
  const firstPick = cheapestTierPrice(bundle) ? null : (pickTiers(bundle.pickAndMix, currency)[0] ?? null);
  const price = firstPick ? firstPick.price : cheapestTierPrice(bundle);
  const expired = !!bundle.expiry && new Date(bundle.expiry).getTime() < now;
  return {
    id: bundle.id,
    title: bundle.title,
    shop: bundle.page?.name || null,
    games: bundle.counts?.games ?? null,
    tierCount: (bundle.tiers || []).length,
    price: price ? price.amount : null,
    currency: price ? price.currency : null,
    pickQuantity: firstPick ? firstPick.quantity : null,
    publish: bundle.publish,
    expiry: bundle.expiry,
    status: expired ? 'Expired' : 'Active',
    covers: bundleCovers(bundle),
  };
}
