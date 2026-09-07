// Shapes one raw ITAD bundle-list item (GET /bundles/v1, via this app's own GET /api/bundles)
// into the flat row BundlesBrowseRoute.tsx's table sorts/filters/groups over. Its own module
// rather than a few functions inside that route specifically so it's importable from a Node unit
// test — the route is a .tsx, and Node's type stripping doesn't transform JSX.
//
// Flattened at fetch time rather than read through per-column `value()` accessors so every column
// operates on a plain scalar (`row.shop`, not `row.page?.name`), which is also what the table's
// own filter checklists/group keys are built from.

export interface PriceAmount { amount: number; currency: string }

// ITAD-hosted artwork for one game, as the bundle list itself returns it — `boxart` (300×450
// portrait) plus banners at 145/300/400/600 wide. Only `banner145` (145×55, ~7KB) is used: it's
// almost exactly the aspect of the game tables' own capsule thumbnails, so a strip of them reads
// as a bundle "cover" without growing the row. Every asset is optional — an entry ITAD has no
// artwork for (typically a non-game item: a course, a soundtrack) carries an empty object.
export interface GameAssets { boxart?: string; banner145?: string; banner300?: string; banner400?: string; banner600?: string }

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
}

export interface BundleRow {
  id: number;
  title: string;
  shop: string | null;
  games: number | null;
  tierCount: number;
  price: number | null;
  currency: string | null;
  publish: string | null;
  expiry: string | null;
  status: string;
  covers: string[];
}

// Cheapest tier that actually has a price — `null` means no tier had one at all (a "Build Your
// Own N Bundle" pick-and-mix format, never a free bundle: a genuinely free/$0 tier still has a
// real, truthy price object, so it groups with the priced tiers rather than with this case).
export function cheapestTierPrice(bundle: BundleListItem): PriceAmount | null {
  const priced = (bundle.tiers || []).filter(t => t.price);
  if (!priced.length) return null;
  return priced.reduce((min, t) => (t.price as PriceAmount).amount < min.amount ? (t.price as PriceAmount) : min, priced[0].price as PriceAmount);
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
// the Production Tier heuristic refuses a publisher allowlist (see CLAUDE.md): ITAD lists shops
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

export interface BundleUrgency { tier: 'ended' | 'urgent' | 'soon' | 'later'; label: string }

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

// `now` is a parameter purely so the Active/Expired split is testable without freezing the clock.
// A bundle with no expiry at all counts as Active — that's how ITAD represents an open-ended one,
// not a missing date to guess at.
export function toBundleRow(bundle: BundleListItem, now: number = Date.now()): BundleRow {
  const price = cheapestTierPrice(bundle);
  const expired = !!bundle.expiry && new Date(bundle.expiry).getTime() < now;
  return {
    id: bundle.id,
    title: bundle.title,
    shop: bundle.page?.name || null,
    games: bundle.counts?.games ?? null,
    tierCount: (bundle.tiers || []).length,
    price: price ? price.amount : null,
    currency: price ? price.currency : null,
    publish: bundle.publish,
    expiry: bundle.expiry,
    status: expired ? 'Expired' : 'Active',
    covers: bundleCovers(bundle),
  };
}
