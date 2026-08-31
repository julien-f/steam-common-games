import type { Game } from './types.ts';

// Extract username/ID from a pasted Steam profile URL
export function normalizeInput(raw: string): string {
  const mId  = raw.match(/steamcommunity\.com\/id\/([^/?\s]+)/);
  if (mId)  return mId[1];
  const mNum = raw.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (mNum) return mNum[1];
  return raw;
}

// Adapted from SteamDB's current rating formula — they moved away from the Wilson score
// interval to this Bayesian shrinkage, specifically because Wilson's confidence-bound framing
// was hard to explain to users. It starts every game at a neutral 50% prior and lets the
// observed positive ratio pull it away as review volume grows. See
// https://github.com/SteamDatabase/steamdb.info-issues/issues/793.
// SHRINK_STRENGTH scales how fast that pull happens: the shrinkage weight decays as
// (total+1)^-(SHRINK_STRENGTH * log10(2)) ≈ (total+1)^-(0.301 * SHRINK_STRENGTH), so higher
// values trust smaller samples more and converge to the raw ratio sooner. SteamDB's own
// published formula is SHRINK_STRENGTH = 1 (their 90%-positive/100-review example lands at
// 80%); this app deliberately runs hotter than that — at SHRINK_STRENGTH = 2 the same example
// lands at ~87.5%, i.e. roughly the convergence SteamDB reaches only around 1,000 reviews.
// Whatever this is set to, the result is mathematically guaranteed to stay between 50 and the
// raw ratio `p`, moving monotonically closer to `p` as `total` grows — it can never overshoot
// past `p`, since the shrinkage weight is always in (0, 1].
// Returns the raw, unrounded value (0-100) — round only for display; sorting/grouping should
// use the full precision so games with the same rounded score still order deterministically.
const STEAMDB_RATING_SHRINK_STRENGTH = 2;
export function computeSteamdbRating(positive: number, total: number): number | null {
  if (!total) return null;
  const p = positive / total;
  const weight = 2 ** (-STEAMDB_RATING_SHRINK_STRENGTH * Math.log10(total + 1));
  return (p - (p - 0.5) * weight) * 100;
}

// Rough AAA/AA/Indie production-tier proxy. Steam's API has no direct budget/studio-size
// signal, so this leans on the only things that correlate with it at all: launch price
// (`priceInitial`, whole cents, USD — see isFree/priceInitial in lib/steam.js's
// extractAppDetails), review volume as a reach proxy, and Metacritic presence as a "got
// professional press coverage at all" signal. It's a heuristic, not fact — see CLAUDE.md's
// AAA/AA/Indie section for the tradeoffs and known misclassifications (cheap AAA
// remasters/rereleases, prestige-priced small-studio sim games, veteran-founded small studios
// with high polish — none of these have any data-side tell). Returns null, not a tier, when
// there isn't enough signal to guess at all (DLC/non-game entries — `isDlc`/`type` — or a
// priced game with no price data).
//
// DLC/expansion appids are skipped outright rather than scored on their own price: a $10
// expansion attached to a AAA base game would otherwise read as Indie. No parent-game lookup
// is attempted (that would mean fetching the base game's own rating/meta just for this), so
// DLC rows simply render blank in this column. Same reasoning extends to Steam's other
// non-game content types (see NON_GAME_TYPES below) — a soundtrack or video has no "budget
// tier" at all, and `isDlc` (`fullgame != null`) alone doesn't catch those since they have no
// base-game back-reference. `isDlc` is still checked independently of `type` as a belt-and-
// suspenders fallback — `type` is only ever missing when Steam's response omits it entirely.
const AAA_PRICE_CENTS = 5000; // $50+ launch price
const AA_PRICE_CENTS = 2000;  // $20+ launch price — the AA/premium-indie overlap zone
const AA_REVIEW_THRESHOLD = 20000;         // needed (alongside AA-band price) to clear "just an expensive indie game"
const FREE_AAA_REVIEW_THRESHOLD = 200000;  // the only lever available for F2P titles, which have no price signal at all
// Steam's appdetails `type` field, values other than 'game' — see the `type` comment in
// lib/steam.js's extractAppDetails. Shared with public/library.js's Type column so the two
// don't drift into disagreeing about what counts as "not really a game".
export const NON_GAME_TYPES = new Set(['dlc', 'demo', 'music', 'video', 'series', 'episode', 'mod', 'hardware', 'advertising']);
export type ProductionTier = 'AAA' | 'AA' | 'Indie';
export function computeProductionTier({ isFree, priceInitial, reviewsTotal, hasMetacritic, isDlc, type }: {
  isFree?: boolean; priceInitial?: number | null; reviewsTotal?: number | null; hasMetacritic?: boolean; isDlc?: boolean; type?: string | null;
} = {}): ProductionTier | null {
  if (isDlc || (type != null && NON_GAME_TYPES.has(type))) return null;
  const reviews = reviewsTotal ?? 0;
  if (isFree) return reviews >= FREE_AAA_REVIEW_THRESHOLD ? 'AAA' : 'Indie';
  if (priceInitial == null) return null;
  if (priceInitial >= AAA_PRICE_CENTS) return 'AAA';
  if (priceInitial >= AA_PRICE_CENTS) return (reviews >= AA_REVIEW_THRESHOLD || hasMetacritic) ? 'AA' : 'Indie';
  return 'Indie';
}

export function scoreColor(n: number | null): string {
  if (n == null) return 'var(--text1)';
  if (n >= 80) return '#57cbde';
  if (n >= 65) return '#a3cf4e';
  if (n >= 50) return '#e4a82e';
  return '#cc5050';
}

// Shared money formatter — imported by public/gameColumns.js's price-column renderers (same as
// scoreColor/dealRecordTier above) and by panel.js's Price card directly. Lives here rather than
// alongside the rest of the price-column logic in gameColumns.js specifically so panel.js can
// import it without also pulling in gameColumns.js's `@vates/data-table-core` dependency,
// meaningless for a plain side panel. `currency` falsy (not yet known/loaded) falls back
// to USD rather than throwing; an invalid/unrecognized currency code falls back to a plain
// "12.34 XYZ" string rather than letting Intl.NumberFormat's own error propagate.
export function formatMoney(v: number, currency?: string | null): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(v); }
  catch { return `${v.toFixed(2)} ${currency || ''}`; }
}

// Single source of truth for "is this price a historical record, and how should it look" —
// shared by renderBestDeal (bundles.js/library.js), panel.js's Price card (priceHtml), and the
// Price Status column (PRICE_STATUS_TIERS/computePriceStatus, bundles.js/library.js), all of
// which used to hand-roll their own copy of this exact tier logic. A 3-month-low tier was once
// added to the Price Status column before anyone remembered to add it to the other three places
// too — this function exists specifically so that can't happen again: change the tier list once,
// here, and every caller picks it up.
//
// Ordered rarest/best record first — a price only ever matches the first (rarest) tier it
// qualifies for, since an all-time low is by definition also a 1yr/3mo low (a longer lookback
// window can only find a price at or below any shorter window's minimum). Colors reuse
// scoreColor's own "excellent"/"good"/"ok" tiers rather than a new palette; the icons step down
// from a filled 🔥 to a filled ★ to an outline ☆, reading as "still a record, just a
// lesser/older one" for the shortest window.
// statusLabel/tooltipLabel spell out "Year"/"Month" in full — matching the wording of the
// lowY1/lowM3 columns themselves ("1-Year Low"/"3-Month Low", gameColumns.js) — rather than the
// abbreviated "1yr"/"3mo" this used to carry, which drifted from those column labels the moment
// they were spelled out. tooltipLabel is the same wording lowercased to read inline in a
// sentence ("Fanatical — 1-year low"); statusLabel is the title-cased standalone form shown as
// the Price Status column's own cell value.
export interface DealRecordTier {
  tier: 'all-time' | '1yr' | '3mo';
  low: 'lowAll' | 'lowY1' | 'lowM3';
  statusLabel: string;
  tooltipLabel: string;
  color: string;
  icon: string;
  bold?: boolean;
}
export const DEAL_RECORD_TIERS: DealRecordTier[] = [
  { tier: 'all-time', low: 'lowAll', statusLabel: 'All-Time Low',  tooltipLabel: 'all-time low',  color: scoreColor(90), icon: '🔥', bold: true },
  { tier: '1yr',       low: 'lowY1',  statusLabel: '1-Year Low',   tooltipLabel: '1-year low',    color: scoreColor(70), icon: '★' },
  { tier: '3mo',        low: 'lowM3',  statusLabel: '3-Month Low', tooltipLabel: '3-month low',   color: scoreColor(55), icon: '☆' },
];
// `lows` is any object carrying `lowAll`/`lowY1`/`lowM3` fields — a row/game object works as-is,
// no need to destructure at the call site. `<=`, not `<` — the current deal genuinely can BE the
// historical low itself (it's what set it), not only ever beat it. Returns `null` (not a tier)
// when `price` is missing or doesn't beat any of the three windows.
export function dealRecordTier(price: number | null | undefined, lows?: { lowAll?: number | null; lowY1?: number | null; lowM3?: number | null } | null): DealRecordTier | null {
  if (price == null) return null;
  for (const t of DEAL_RECORD_TIERS) {
    const low = lows?.[t.low];
    if (low != null && price <= low) return t;
  }
  return null;
}

// How much cheaper the best deal is than Steam Full Price, as a whole percentage — computed by
// each page's own loadPrices/loadWishlistPrices (from the same response's steamRegular/
// bestDeal.price) rather than taken from ITAD's own per-deal `cut` field, deliberately: `cut` is
// that shop's own discount off *its own* regular price, which shops set independently and isn't
// consistent from row to row, whereas Steam Full Price is one stable, Valve-set anchor this app
// already treats as the reference price throughout — every row's Discount ends up answering the
// same "vs. buying it on Steam" question. Best Deal is defined as the cheapest price across
// *every* shop including Steam, so `bestDealAmt <= steamRegularAmt` always holds — this can't go
// negative in practice. Lives here (not gameColumns.js, where the rest of the price-column logic
// sits) for the same reason dealRecordTier/formatMoney do — panel.js's Price card needs it too,
// without pulling in gameColumns.js's @vates/data-table-core dependency.
export function discountPct(bestDealAmt: number | null | undefined, steamRegularAmt: number | null | undefined): number | null {
  if (steamRegularAmt == null || !(steamRegularAmt > 0) || bestDealAmt == null) return null;
  return Math.round((1 - bestDealAmt / steamRegularAmt) * 100);
}

export function fmtH(h: number | null | undefined): string {
  if (!h) return '<span class="dim">—</span>';
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

// Format Steam playtime (minutes) as a compact string, e.g. "47m" or "12h". Returns '' for 0.
export function fmtPlaytime(mins: number | null | undefined): string {
  if (!mins) return '';
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
}

// Format a GetOwnedGames `rtime_last_played` Unix timestamp (seconds) as a plain ISO date
// (e.g. "2026-07-01") — same bare-date convention as the releaseDate/dateAdded table columns,
// rather than a relative "3 days ago" string. Returns '' for 0/missing (owned but never
// launched — a real, meaningful state, not absent data).
export function fmtLastPlayed(epochSec: number | null | undefined): string {
  if (!epochSec) return '';
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

export function foldStr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderScoreCell(game: Game): string {
  if (game.loading) return '<span class="sk"></span>';
  const r = game.details?.rating;
  return r
    ? `<div class="score-num" style="color:${scoreColor(r.score)}">${r.score}</div><div class="score-label">${esc(r.desc)}</div>`
    : '<span class="dim">—</span>';
}

export function renderMainCell(game: Game): string {
  if (game.loading) return '<span class="sk sm"></span>';
  const h = game.details?.hltb;
  return h ? fmtH(h.main) : '<span class="dim">—</span>';
}

export function renderExtraCell(game: Game): string {
  if (game.loading) return '<span class="sk sm"></span>';
  const h = game.details?.hltb;
  return h ? fmtH(h.extra) : '<span class="dim">—</span>';
}
