'use strict';

import { createDataTable, syncViewToUrl, resetView } from '@vates/data-table-vanilla';
import {
  processData, searchData, DEFAULT_LABELS, compareMissingLast,
  bucketNumericRange, bucketDatePart, formatNumericRange, formatDatePart,
} from '@vates/data-table-core';

const fmt = {
  loading: v => v === undefined ? '…' : v,
  num:  v => v === undefined ? '…' : v === null ? '—' : String(v),
  numRound: v => v === undefined ? '…' : v === null ? '—' : String(Math.round(v)),
  dec1: v => v === undefined ? '…' : v === null ? '—' : Number(v).toFixed(1),
  str:  v => v === undefined ? '…' : v || '—',
  ct:   v => v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString(),
  arr:  v => v === undefined ? '…' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—'),
};

// Bare colored number rather than a progress bar — a bar's fill color carries the same
// good/bad signal the number's color already does, and with up to four score-ish columns
// (SteamDB Rating, Wilson Score, Steam %, Metacritic Score) visible at once, bars add visual
// weight without adding information. Uses the global `scoreColor()` from utils.js so the
// color scale matches the side panel's score display exactly, instead of a second copy of
// the same thresholds.
// `computeSteamdbRating` returns unrounded precision (0-100) so sort/group operate on the full
// number rather than the display-rounded integer — round only where displayed (here, and in
// `fmt.numRound`/`applyDetailsEvent` below).
function renderScoreNum(v) {
  if (v === undefined) return document.createTextNode('…');
  if (v === null) return document.createTextNode('—');
  const rounded = Math.round(v);
  const span = document.createElement('span');
  span.style.color = scoreColor(rounded);
  span.textContent = String(rounded);
  return span;
}

// ProtonDB's Linux/Steam Deck compatibility tiers, worst to best (see the matching color map
// in public/panel.js, which renders the same badge in the side panel — kept as a separate copy
// there since panel.js is a classic script and library.js a module, not for any semantic
// reason). "Native" (an actual Linux port, no Proton needed) ranks above "Platinum" (flawless
// *through* Proton). No "pending" entry — extractProtonDb (lib/steam.js) already collapses that
// tier to null server-side, since "too few reports to rate yet" isn't a quality tier at all, so
// it never reaches the client as a value that would need a place in this ordering.
const PROTON_TIER_ORDER = ['borked', 'bronze', 'silver', 'gold', 'platinum', 'native'];
const PROTON_TIER_COLORS = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};

// Backing value is the plain capitalized tier name ("Gold", "Platinum") — @vates/data-table-core
// 0.7.0 added a per-column `compare` option (see the ProtonDB column below) precisely so a
// categorical column can sort by real quality order without needing display text to double as
// a sort key; see https://github.com/vatesfr/data-table/issues/15 for the request behind it (an
// earlier version of this column baked a rank digit into the value itself — "3 Gold" — to work
// around not having this, which leaked into the filter checklist/search text; not needed anymore).
function protonDbValue(tier) {
  if (PROTON_TIER_ORDER.indexOf(tier) === -1) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// Friendly labels for Steam's raw appdetails `type` enum (see the `type` comment in
// lib/steam.js's extractAppDetails) — backs the Type column below. `game` isn't listed:
// applyDetailsEvent falls back to the raw string itself for any value not in this map, and
// 'game' reads fine as-is capitalized... except it isn't capitalized raw, so it's listed too
// for consistent casing. Values Steam is known to actually use for entries that can end up
// owned/wishlisted (a soundtrack or artbook DLC, not just base games); `demo`/`advertising`
// are here mostly for completeness — a free demo/ad appid isn't normally something a person
// owns or wishlists in its own right.
const TYPE_LABELS = {
  game: 'Game', dlc: 'DLC', music: 'Soundtrack', video: 'Video',
  series: 'Series', episode: 'Episode', mod: 'Mod', hardware: 'Hardware', demo: 'Demo',
  advertising: 'Advertising',
};

// Worst-to-best ordering for the Production Tier column's `compare` below. `computeProductionTier`
// (public/utils.js) already returns null for "not enough signal to guess" (DLC, or a priced game
// with no price data) — `compareMissingLast` handles that the same way every other heuristic/
// possibly-absent column here does, pinning it last regardless of sort direction.
const PRODUCTION_TIER_ORDER = ['Indie', 'AA', 'AAA'];
const compareProductionTier = compareMissingLast((a, b) =>
  PRODUCTION_TIER_ORDER.indexOf(a) - PRODUCTION_TIER_ORDER.indexOf(b));

// Ordering used by the ProtonDB column's `compare` below — same tier list as protonDbValue.
// `compareMissingLast` (new in 0.7.0 alongside `compare` itself) pins a missing rating to the
// end of the sort regardless of ascending/descending, rather than an empty value sorting first
// under plain ascending lexicographic comparison — games with no ProtonDB data yet shouldn't
// float to the top just because "" sorts before every real tier name.
const compareProtonTier = compareMissingLast((a, b) =>
  PROTON_TIER_ORDER.indexOf(a.toLowerCase()) - PROTON_TIER_ORDER.indexOf(b.toLowerCase()));

// The generic colored-pill treatment (`.status-badge`, shared style.css rule) — shared with
// renderDemoBadge below rather than each column inventing its own pill styling.
function renderProtonBadge(v) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = PROTON_TIER_COLORS[v.toLowerCase()] || '#52525b';
  span.textContent = v;
  return span;
}

// Same `.status-badge` pill shape as renderProtonBadge above, in the app's own accent blue —
// the same color and dark-on-blue text the side panel's "🎮 Try the Free Demo" banner already
// uses (`.panel-demo-banner`, style.css) — so the two read as the same "this game has a demo"
// signifier rather than introducing a new color/shape just for this column.
function renderDemoBadge(v) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = 'var(--accent)';
  span.style.color = '#0b1620';
  span.textContent = 'Demo';
  return span;
}

// Ignores `value` and reads `row.capsule` directly — `value` is forced to null on this column
// (see COLUMNS below) so the raw image URL never surfaces in full-text search matches.
function renderThumb(_, row) {
  const img = document.createElement('img');
  img.className = 'game-thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.width = 120;
  img.height = 45;
  if (row.capsule) img.src = row.capsule;
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

// Plain numeric comparator, wrapped so a `null` ("no data" — no reviews, no Metacritic score,
// no HLTB match) always sorts last regardless of direction. Without this, a `type: 'number'`
// column's own coercion (`Number(null) === 0`) makes "no data" indistinguishable from an actual
// zero score/duration — most visibly on `steamdbRating`, the default sort column: a game with
// zero reviews currently ties with one confirmed 0% positive instead of being set apart from it.
const compareNumMissingLast = compareMissingLast((a, b) => a - b);

// Steam's release_date.date only gets this coarse ("2026", "Fall 2026", "2026 or later") while
// a game is still unreleased — once it ships, Steam always returns a specific day. JS's own Date
// parser anchors whatever it can partially recognize at the START of that period ("2026" -> Jan 1,
// "October 2026" -> Oct 1), which would sort a still-unreleased game BEFORE games that already
// shipped earlier that same year/month — backwards, since the real date can only land later.
// Anchor coarse dates at the END of their stated period instead (the latest point consistent with
// what Steam told us); a fully-specified date (or wishlist's `dateAdded`, always a precise
// timestamp) matches none of these patterns and falls through to plain `new Date()` unchanged.
//
// A bare year and Q4 of that same year both anchor at Dec 31 — same timestamp, so without a
// tie-break they wouldn't sort in any defined order relative to each other. "2026" carries less
// information than "Q4 2026" (it could still land in Q1-Q3), so nudge it 1ms later: a vaguer claim
// for the same end-of-period ranks just after a more specific one, without disturbing its order
// against any other, actually-different, day.
//
// Steam also uses two placeholders with no date in them at all: "Coming soon" and "To be
// announced"/"TBA". Deliberately NOT handled here — this function is also the column's
// `parseDate`, which the table framework reuses for the range-filter bounds and the date-tree
// filter dropdown, not just sorting. If a placeholder produced a real (if huge) timestamp, one
// "Coming soon" wishlist row would drag the whole column's computed max to that fake date,
// squashing every real release date into a sliver of the range slider, and a "released after X"
// filter would wrongly match games we have no actual date for. Letting them fall through to plain
// `new Date(s).getTime()` (NaN, same as any other unrecognized string) makes every one of those
// consumers correctly treat "unreleased" as "no known date" instead of "year 9999". Sort order is
// handled separately below, by `releaseSortTimestamp`, the only consumer that actually wants a
// deterministic placeholder position.
const SEASON_END = { spring: [5, 20], summer: [8, 21], fall: [11, 20], autumn: [11, 20], winter: [2, 19] };
function endOfReleasePeriod(str) {
  const s = String(str).trim();
  let m;
  if ((m = /^(spring|summer|fall|autumn|winter)\s+(\d{4})$/i.exec(s))) {
    const [month, day] = SEASON_END[m[1].toLowerCase()];
    const year = m[1].toLowerCase() === 'winter' ? Number(m[2]) + 1 : Number(m[2]); // winter spills into next year
    return new Date(year, month, day).getTime();
  }
  if ((m = /^Q([1-4])\s+(\d{4})$/i.exec(s))) {
    return new Date(Number(m[2]), Number(m[1]) * 3, 0).getTime(); // last day of the quarter's final month
  }
  if ((m = /^(\d{4})(?:\s+or\s+later)?$/i.exec(s))) {
    return new Date(Number(m[1]), 11, 31).getTime() + 1; // bare year, or open-ended "2026 or later" — end of that year, nudged 1ms past a same-year Q4 tie
  }
  if (/^[A-Za-z]+\s+\d{4}$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); // month name + year, no day — last day of that month
  }
  return new Date(s).getTime();
}

// Sort-only view of the Released column. "Coming soon" (some info — it's presumably nearer than a
// distant bare year) and "To be announced"/"TBA" (no info whatsoever) both need to sort after
// every real or coarse date — including a far-future bare year like "2028" — while still
// preserving Coming soon < TBA between themselves. Sentinel timestamps anchored past any realistic
// release year do that; they're deliberately not NaN (unlike a genuinely unrecognized string) so
// they get a real, deterministic position instead of falling into the null/empty "missing" bucket
// handled by compareDateMissingLast below. Kept local to the sort comparator (not folded back into
// endOfReleasePeriod/parseDate) so the range-filter bounds and date-tree — which also read
// `parseDate` — never see these fake dates; see the comment on endOfReleasePeriod above.
const COMING_SOON_SENTINEL = new Date(9999, 0, 1).getTime();
const TBA_SENTINEL         = new Date(9999, 0, 2).getTime();
function releaseSortTimestamp(str) {
  const s = String(str).trim();
  if (/^coming soon$/i.test(s)) return COMING_SOON_SENTINEL;
  if (/^(to be announced|tba)$/i.test(s)) return TBA_SENTINEL;
  return endOfReleasePeriod(s);
}

// Same idea for `type: 'date'` columns (`releaseDate`, wishlist's `dateAdded`) — setting
// `compare` bypasses the column's own `parseDate`/type coercion too, so a `null` date would
// otherwise become epoch 1970 via `new Date(null).getTime()` and sort as impossibly old, and a
// string neither `releaseSortTimestamp` nor plain `new Date()` can make sense of (not one of the
// recognized coarse forms, and not a valid date either) would sort at a nondeterministic spot via
// NaN comparisons — both need to be pinned last instead. "Coming soon" and "To be announced" are
// NOT examples of that — `releaseSortTimestamp` gives them real sentinel positions (see above) so
// they sort deterministically after every dated/coarse entry instead of landing in this bucket.
const compareDateMissingLast = compareMissingLast(
  (a, b) => releaseSortTimestamp(a) - releaseSortTimestamp(b),
  v => v == null || v === '' || isNaN(releaseSortTimestamp(v)),
);

// Amber-flags still-unreleased games in the Released column — reuses scoreColor's own
// mid-tier amber (`#e4a82e`) rather than introducing a new color, so it reads as "notable,
// not final" the same way a middling score does elsewhere in the table. Backed by Steam's own
// `comingSoon` flag (see extractAppDetails in lib/steam.js), not by comparing the parsed date
// to today — a coarse placeholder like "Coming soon" has no parseable date to compare at all.
function renderReleaseDate(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  if (row.comingSoon) span.style.color = '#e4a82e';
  span.textContent = v;
  return span;
}

// ── Group-by bucketing for continuous/high-cardinality columns ─────────────────────────────
// @vates/data-table-core's `groupValue`/`groupFormat` exist precisely so a `type: 'number'`/
// `type: 'date'` column with a near-unique value per row (an exact review count, an hours-played
// figure, an exact release date) can still group into a handful of useful buckets instead of one
// row-sized group per game. None of the columns below used to set it at all.

// reviewsTotal and playtime both span several orders of magnitude — a handful of games with
// millions of reviews or thousands of hours sitting next to dozens with single digits — so a
// fixed linear step (`bucketNumericRange`) is the wrong tool for either: too small a step and the
// long tail collapses into one dominant bucket, too large and the 0-100 range where most of the
// actual variety lives gets flattened into one or two. Half-decade ("1-3-10") log buckets fix
// both ends — twice the resolution of plain base-10 decades, which checked against a real
// library's data put the entire 1h-10h range (roughly half of any typical player's *played*
// games) into a single indistinguishable bucket. Snapping to the fixed {1, 3, 10, 30, 100, ...}
// staircase (rather than the raw irrational 10**(n/2) it approximates) keeps every boundary a
// clean, recognizable number instead of "3.162".
function halfDecadeBucket(value) {
  const n = Number(value);
  if (!(n > 0)) return 0; // covers a real 0 and (via withMissingGroup below) never sees a missing value
  // Collapse everything under 1 into its own single bucket rather than continuing the half-decade
  // staircase below it (0.3-1, 0.1-0.3, 0.03-0.1, 0.01-0.03, ...) — verified against a real
  // library, that finer breakdown split "barely touched" playtime into four buckets nobody
  // actually distinguishes between (a game played for 2 minutes vs. 40 isn't a meaningful
  // difference), just to preserve resolution reviewsTotal never even reaches this range to need.
  // The sentinel is 0.5, not e.g. -1 — group order sorts by this raw numeric key (including when
  // grouping auto-applies a matching sort, see bindGroupBySort above), and a value below 0 would
  // rank "played a little" as LESS than the real-zero "Not played" bucket, backwards from what it
  // means; 0.5 keeps 0 < 0.5 < 1 < 3 < ... ordering correct in both directions.
  if (n < 1) return 0.5;
  const exp = Math.floor(Math.log10(n) + 1e-9); // epsilon guards e.g. log10(1000) landing a hair under 3
  const base = 10 ** exp;
  return n < base * 3 ? base : base * 3;
}
function nextHalfDecadeBound(lower) {
  const exp = Math.floor(Math.log10(lower) + 1e-9);
  const base = 10 ** exp;
  return lower === base ? base * 3 : base * 10;
}
// Whole numbers as-is; large ones with a k/M suffix (same readability idea as fmt.ct's
// toLocaleString); sub-1 ones (only ever reached by playtime, which has real data down to a few
// minutes) kept as a short decimal instead of rounding away to a misleading "0".
function formatMagnitude(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  if (n > 0 && n < 1) return String(+n.toFixed(2));
  return String(Math.round(n));
}
function formatHalfDecadeBucket(unit, zeroLabel, subOneLabel = `<1${unit}`) {
  return keyPart => {
    const lower = Number(keyPart);
    if (lower === 0) return zeroLabel;
    if (lower === 0.5) return subOneLabel;
    return `${formatMagnitude(lower)}–${formatMagnitude(nextHalfDecadeBound(lower))}${unit}`;
  };
}

// A `groupValue` that returns `null`/`undefined` for a missing value ends up keyed by the empty
// string once the table's own internals stringify it (`null ?? ''`) — but bucketNumericRange/
// bucketDatePart don't know that convention; each calls `String(value)`/coerces it *before* any
// such check, so a genuinely missing `null` column value (a failed rating fetch, an unparseable
// release date) would come out the other end as the literal string `"null"` and show up as a
// group header that reads "null" rather than "—". Checking for "missing" ourselves before ever
// calling the underlying bucket function sidesteps that regardless of which one's used —
// `lastPlayed`'s "never played by anyone" is `''`, not `null`, so it takes its own `isMissing`.
function withMissingGroup(bucketFn, isMissing = v => v == null) {
  return value => isMissing(value) ? null : bucketFn(value);
}
// Pairs with withMissingGroup above — the empty-string group key it produces for a missing value
// needs its own label rather than being handed to a real formatter that has no idea what to do
// with it (formatDatePart('year') on '' would print '' itself: `new Date('')` is invalid, but
// still not NaN in a way that function checks for).
function formatMissingGroup(formatFn, missingLabel = '—') {
  return keyPart => keyPart === '' ? missingLabel : formatFn(keyPart);
}

// Grouped into sections (identity → scores → HLTB → play time/dates → classification →
// compatibility → extras) rather than roughly the order each was added to the
// codebase — with 20+ columns now, an alphabetical or add-order list makes both the column
// picker and this source file hard to scan. Within a section, the most commonly-useful/
// default-visible column leads. WISHLIST_COLUMNS (below) inserts its two wishlist-only columns
// into the matching sections rather than tacking them on at the end, for the same reason.
const COLUMNS = [
  // ── Identity ────────────────────────────────────────────────────────────────
  { key: 'capsule', label: '', width: 128, sortable: false, filterable: false, groupable: false,
    value: () => null, render: renderThumb },
  // Not groupable — a game's name is (almost always) unique per row, same "one group per row is
  // useless" reasoning steamdbRating's own groupable:false comment below already gives; `priority`
  // (Wishlist Rank) gets the same treatment further down for the identical reason.
  { key: 'name',             label: 'Name',            filterable: false, groupable: false },

  // ── Scores & reviews ────────────────────────────────────────────────────────
  // The default-visible score: SteamDB's current formula (see computeSteamdbRating in utils.js)
  // — shown first because it's the number most people recognize from SteamDB itself. Stored
  // unrounded so sort/default-sort operate on full precision (two games both displaying "97"
  // still order deterministically); not groupable for the same reason — grouping keys off the
  // raw value, and a near-unique float per game would produce a useless one-row-per-group split.
  // `defaultSortDir: 'desc'` (new in @vates/data-table-core 0.8.0) on this and the other three
  // score-ish columns below — a fresh click on any of them should show the best-rated games
  // first, not the worst; without it a first click started every numeric column ascending
  // (worst-first) regardless of what the number actually means. Only changes where a *new* sort
  // entry starts; it doesn't touch this column's own already-applied `DEFAULT_SORT` above.
  { key: 'steamdbRating',    label: 'SteamDB Rating',  type: 'number', groupable: false, format: fmt.numRound, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Wilson score lower bound — statistically rigorous but harder to explain than SteamDB's
  // current formula (which is why it isn't the default-visible score anymore); kept available
  // for anyone who wants the more conservative, confidence-bound number instead.
  { key: 'score',            label: 'Wilson Score',    type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Raw positive/total ratio — the plain percentage Steam's own store page shows, as opposed to
  // the two adjusted scores above. No "%" in the cell (the column header already says so) —
  // same bare colored number treatment as the other three score columns for consistency.
  { key: 'positivePct',      label: 'Steam %',         type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Grouped with the other user-review scores above rather than off near HLTB/playtime — it's a
  // critic (not player) score, but it's still one of the four "how good is this game" numbers,
  // and keeping all of them contiguous makes them easier to compare at a glance.
  { key: 'metacritic',       label: 'Metacritic Score',type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // No compare override here — 0 reviews is a real, meaningful value (not "no data" standing in
  // for one), so the default numeric sort already treats it correctly, unlike the score/HLTB
  // columns above and below. `defaultSortDir: 'desc'` still applies though — the most-reviewed
  // (most talked-about) games are the more useful thing to see on a first click, same reasoning
  // as the score columns just without the missing-data wrinkle. `null` (a failed rating fetch, not
  // a confirmed 0) is still possible though, hence `withMissingGroup` on the grouping side below —
  // see its own comment above for why that needs to be checked explicitly rather than left to
  // halfDecadeBucket's own `Number(null) === 0` coercion, which would otherwise silently fold a
  // failed fetch into the same group as a genuinely zero-review game.
  { key: 'reviewsTotal',     label: 'Review Count',    type: 'number', groupable: true, format: fmt.ct, defaultSortDir: 'desc',
    groupValue: withMissingGroup(halfDecadeBucket), groupFormat: formatMissingGroup(formatHalfDecadeBucket('', '0')) },

  // ── How Long To Beat ────────────────────────────────────────────────────────
  // "All PlayStyles" listed first among the HLTB columns — same convention as the side panel,
  // which shows it leftmost precisely because it's a single representative number rather than
  // one specific playstyle (see the comment on `all` in lib/hltb.js). Keeping it first here too
  // means toggling on Main/+Extra/100% doesn't push it out of its default-visible position.
  // HLTB times are bounded to roughly 0-150h for the overwhelming majority (a handful of
  // open-world completionist runs into the 300-500h range, nothing like reviewsTotal/playtime's
  // spread into the millions/thousands) — a plain linear step stays meaningful across that whole
  // range, unlike those two, so a 10h `bucketNumericRange` is the right tool here rather than the
  // log buckets above. `null` (no HLTB match found) needs the same `withMissingGroup` treatment.
  { key: 'hltbAll',          label: 'All (h)',         type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')) },
  { key: 'hltbMain',         label: 'Main (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')) },
  { key: 'hltbExtra',        label: '+Extra (h)',      type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')) },
  { key: 'hltbCompletionist',label: '100% (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')) },

  // ── Play time & dates ───────────────────────────────────────────────────────
  // No compare override here either — 0 hours played is real data (owned, never launched), not
  // a stand-in for "unknown," so the default numeric sort is already correct. `defaultSortDir:
  // 'desc'` still applies — "what have I sunk the most hours into" is the more common question
  // than the reverse.
  // Same log-scale reasoning as reviewsTotal above — Steam playtime is famously long-tailed
  // (thousands of hours in a handful of games next to dozens barely launched), verified against a
  // real library where p50-p90 of played games alone spanned 1.1h-9.8h, entirely inside one
  // base-10 decade. `totalMin / 60` (see loadLibrary below) is always a real number, never `null`
  // — a slot that owns but never played a game still sums to a real 0 — so no `withMissingGroup`
  // wrapper is needed here, unlike reviewsTotal/hltb*/the three date columns.
  { key: 'playtime',         label: 'Played (h)',      type: 'number', groupable: true,
    format: v => v > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc',
    groupValue: halfDecadeBucket, groupFormat: formatHalfDecadeBucket('h', 'Not played') },
  // Most recent `rtime_last_played` across every account merged into this row (a Steam Family
  // slot unions several accounts — see groupByOwnership — so "last played" here means "by
  // anyone in the slot", not any one account in particular). '' (never played by anyone in the
  // slot) is real data, not missing data, so no compare override is needed beyond the shared
  // date comparator below, which already pins an empty string last.
  // Hidden by default (see DEFAULT_VISIBLE) — Steam's GetOwnedGames only returns real
  // rtime_last_played data for the account whose own key is querying it; every other account
  // comes back with it absent, indistinguishable from "owned but never launched". Most searches
  // here involve at least one non-key-owner account, so a visible-by-default column would read
  // as meaningful data when it's often just an API restriction. updateLastPlayedTooltip() below
  // adds a header tooltip warning specifically when every loaded row shows no value at all —
  // the tell for "this whole column is unavailable", not "nobody's touched their library".
  // `defaultSortDir: 'desc'` — "last modified"-style date column, the textbook case the option's
  // own doc comment cites; a first click should surface who's been played most recently, not
  // dredge up the stalest entry. `defaultValueSort` (also new in 0.8.0) opens the date filter
  // tree most-recent-year-first instead of the tree's own default oldest-first — `by: 'alpha'`
  // is what a date tree actually uses (there's no by-count order for a tree of date branches;
  // see the Grouped columns / Date filter tree docs), just flipped to descending.
  // Grouped by year (`bucketDatePart('year')`) rather than the exact date — an exact release/
  // last-played date is close to unique per game, so ungrouped grouping would produce close to
  // one row-sized group per game, the same "continuous column" problem reviewsTotal/playtime have
  // above. "Never played by anyone in the slot" is `''`, not `null` (see fmtLastPlayed in
  // utils.js), hence the explicit `isMissing` override — `withMissingGroup`'s default only checks
  // for `null`/`undefined`.
  { key: 'lastPlayed',       label: 'Last Played',   type: 'date', groupable: true, format: fmt.str,
    compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year'), v => v == null || v === ''),
    groupFormat: formatMissingGroup(formatDatePart('year')) },
  // Same year-bucketed grouping, using this column's own `parseDate` (endOfReleasePeriod) so a
  // fuzzy "Fall 2026"/bare-year release groups under the year it actually resolves to instead of
  // bucketDatePart's own default `new Date(value).getTime()`, which can't make sense of those
  // forms at all. `null` (no metadata) is the only missing case here — "Coming soon"/"TBA" are
  // real (if imprecise) strings that endOfReleasePeriod resolves to an actual year, not `null`.
  { key: 'releaseDate',      label: 'Released',     type: 'date', groupable: true, format: fmt.str,
    parseDate: endOfReleasePeriod, compare: compareDateMissingLast, render: renderReleaseDate,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year', endOfReleasePeriod)),
    groupFormat: formatMissingGroup(formatDatePart('year')) },

  // ── Classification ──────────────────────────────────────────────────────────
  { key: 'genres',           label: 'Genres',       groupable: true, format: fmt.arr },
  // `defaultValueSort: { by: 'count', dir: 'desc' }` (new in 0.8.0) — Developer/Publisher/Tags/
  // Categories are all higher-cardinality than Genres (a small, well-known fixed list that reads
  // fine alphabetically), so their filter checklists open "most common first" instead of A→Z;
  // still just the starting point — `cycleValueSort`'s toggle still cycles through all 4 states
  // the same as before.
  { key: 'categories',       label: 'Categories',   groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'tags',             label: 'Tags',         groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'developers',       label: 'Developer',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'publishers',       label: 'Publisher',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  // Parsed from Steam's `supported_languages` HTML string (see parseSupportedLanguages in
  // lib/steam.js) — same high-cardinality multi-value treatment as Tags/Developers/Publisher.
  { key: 'languages',        label: 'Languages',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  // Steam's own content-type for this appid (see TYPE_LABELS above and the `type` comment in
  // lib/steam.js's extractAppDetails) — the overwhelming majority of rows are 'Game', but a
  // library/wishlist can genuinely contain soundtrack ('Soundtrack'), video, or DLC entries
  // too. Hidden by default for exactly that reason (almost every row would show the same
  // value), but groupable/filterable so a search can be narrowed to just base games, or
  // audited for stray non-game entries. `null` ("Unknown") only when store metadata itself
  // failed to load or Steam's response omitted the field.
  { key: 'type',             label: 'Type',         groupable: true, format: v => v || 'Unknown' },
  // Estimated, not authoritative — see computeProductionTier's doc comment (public/utils.js)
  // and CLAUDE.md's AAA/AA/Indie section. The label spells out "(est.)" rather than relying on
  // a hover tooltip, since @vates/data-table-vanilla has no per-column header-tooltip option to
  // hang a caveat on. Hidden by default (see DEFAULT_VISIBLE) for the same reason Wilson
  // Score/Steam %/Achievements are — a secondary number, not the primary thing most searches
  // here care about, and one that's explicitly a best-effort guess on top of that.
  { key: 'productionTier',   label: 'Production Tier (est.)', groupable: true, format: fmt.str,
    compare: compareProductionTier, defaultSortDir: 'desc' },

  // ── Compatibility ───────────────────────────────────────────────────────────
  // Native OS support (`platforms` in lib/steam.js's extractAppDetails) — distinct from the
  // ProtonDB column right below, which is Linux/Deck compatibility *through Proton*, a
  // compatibility layer, not native support. Same multi-value groupable/filterable treatment as
  // Genres/Categories rather than three separate boolean columns.
  { key: 'platforms',        label: 'Platforms',    groupable: true, format: fmt.arr },
  // Linux/Steam Deck compatibility tier from ProtonDB — sorted/grouped by actual compatibility
  // quality (see compareProtonTier above), not alphabetically; public/panel.js shows the same
  // data as a colored badge in the side panel. `defaultSortDir: 'desc'` shows the best-compatibility
  // games first on a fresh click, matching compareProtonTier's worst-to-best ordering.
  { key: 'protondb',         label: 'ProtonDB',     groupable: true, format: fmt.str, render: renderProtonBadge, compare: compareProtonTier, defaultSortDir: 'desc' },

  // ── Extras ──────────────────────────────────────────────────────────────────
  // Leads the section — "can I try this first" is relevant to any prospective player, unlike
  // Achievements/DLC Count right below, which only matter to completionists. `event.demo`
  // (top-level on the SSE/game-details response, not nested under `meta`) — the free demo's
  // appid if this game has one, from the same IStoreBrowseService item tags/demo share (see
  // getGameDemo in lib/steam.js); the side panel's own "🎮 Try the Free Demo" banner
  // (public/panel.js) reads the exact same field. Only a plain has-a-demo boolean here — the
  // demo's own appid isn't useful in a cell with nowhere to link it (see the "no link" decision
  // above — outbound links stay in the panel, not the table). Rendered as a colored badge
  // (renderDemoBadge above) rather than plain text/an emoji glyph, so it reads as a quick status
  // chip at a glance, same treatment as ProtonDB right above. `format` still returns plain text
  // for non-visual consumers (filter checklist labels, CSV export) that don't go through
  // `render`. True/false is real data either way (no separate "unknown" state), same as
  // panel.js's own `!!g.details?.demo` check, so no `compare`/missing-last handling is needed —
  // plain boolean comparison already puts demo games first with `defaultSortDir: 'desc'`.
  { key: 'hasDemo',          label: 'Demo',         groupable: true,
    format: v => v === undefined ? '…' : v ? 'Demo' : '—', render: renderDemoBadge, defaultSortDir: 'desc' },
  // Steam's own achievement count for the game (`achievements.total` on the appdetails
  // response — see `achievementCount` in lib/steam.js's extractAppDetails), not this
  // player's unlock progress — that's the side panel's own Achievements section
  // (public/panel.js), which needs a per-account fetch this column doesn't. 0 is real data
  // (the game genuinely has none); `null` (missing, sorted last by compareNumMissingLast)
  // only when store metadata itself failed to load. Hidden by default — a fairly niche
  // completionist-facing number compared to the rest of DEFAULT_VISIBLE.
  { key: 'achievementCount', label: 'Achievements', type: 'number', groupable: true, format: fmt.num, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Length of `meta.dlc` (the bare DLC appid list every appdetails response already carries —
  // see the `dlc` comment in lib/steam.js's extractAppDetails) — computed here rather than in
  // a new backend field since the array itself is already on the row's `details.meta`. 0 is
  // real data (base game has no DLC); `null` only when store metadata itself failed to load.
  { key: 'dlcCount',         label: 'DLC Count',    type: 'number', groupable: true, format: fmt.num, compare: compareNumMissingLast, defaultSortDir: 'desc' },
];

const DEFAULT_VISIBLE = [
  'capsule', 'name', 'steamdbRating', 'hltbAll', 'playtime', 'releaseDate', 'genres',
];

// Auto-sorts by whatever column was just added to Group by — grouping by a column and *not*
// sorting by it leaves rows shuffled within each group in whatever order they happened to load
// in, which is rarely what someone grouping by, say, Released actually wants (games within each
// year in release order, not a random one). Only fires on a genuine live "user clicked a column
// in the Group menu" interaction, not on a restored view (URL load, back/forward, "Reset view")
// that happens to include a group — those all replace many `TableViewState` fields (sorts,
// filters, visibleCols, page, ...) in one `setViewState` call, whereas toggling one column in the
// Group menu touches only `groupBy` in isolation. `viewSignature` (below) captures every field
// *except* the two this function itself cares about, so an isolated groupBy-only change is
// exactly the case where the "rest" signature comes out unchanged.
function viewSignature(view) {
  const { groupBy, sorts, ...rest } = view;
  return JSON.stringify(rest);
}
function bindGroupBySort(table, columns) {
  let prevView = table.getViewState();
  return table.onViewChange(view => {
    const prevGroupBy = prevView.groupBy ?? [];
    const groupBy = view.groupBy ?? [];
    const added = groupBy.filter(k => !prevGroupBy.includes(k));
    const isIsolatedChange = viewSignature(view) === viewSignature(prevView);
    prevView = view;
    if (added.length !== 1 || !isIsolatedChange) return; // 0 added: removal or an unrelated change; >1 or a non-isolated change: a bulk restore, not a live click
    const [key] = added;
    if (view.sorts?.length === 1 && view.sorts[0].key === key) return; // already sorted by it
    const col = columns.find(c => c.key === key);
    table.setViewState({ ...view, sorts: [{ key, dir: col?.defaultSortDir ?? 'asc' }] });
  });
}

// Applied via setViewState() after table creation and after "Reset view" — there's no
// construction-time default-sort option, only defaultVisibleColumns (see README).
const DEFAULT_SORT = [{ key: 'steamdbRating', dir: 'desc' }];

// Inserts `newColumns` right after the column keyed `afterKey`, rather than always appending at
// the very end — used by WISHLIST_COLUMNS below so its two wishlist-only columns land in the
// section they actually belong to (identity, play time & dates) instead of trailing after
// Extras where nobody would think to look for a wishlist rank or an added date.
function insertColumnsAfter(columns, afterKey, ...newColumns) {
  const idx = columns.findIndex(c => c.key === afterKey);
  return [...columns.slice(0, idx + 1), ...newColumns, ...columns.slice(idx + 1)];
}

// No defaultSortDir — Steam's wishlist rank is already 1-at-the-top, so the plain ascending
// default a fresh click starts at is the useful direction as-is. Placed right after Name (an
// identity-adjacent "which one is this" attribute for a wishlist row) rather than off in the
// Scores/Dates sections where it doesn't fit either.
const WISHLIST_RANK_COLUMN =
  { key: 'priority',  label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num };

// Same "last modified"-style reasoning as the owned-library's Last Played/Released columns
// above — a fresh click (and the filter's date tree) should lead with what was added most
// recently, not the oldest wishlist entry. Placed right after Released, in the same Play
// time & dates section, rather than at the very end of the column list.
const WISHLIST_DATE_ADDED_COLUMN =
  { key: 'dateAdded', label: 'Added',         type: 'date',   groupable: true,  format: fmt.str, compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' } };

// Same as COLUMNS minus playtime and lastPlayed (wishlist games aren't owned, so there's no
// playtime or last-played data to show), plus the two wishlist-specific columns above, inserted
// into their matching sections rather than tacked on at the end. Unlike owned games — whose
// name is known upfront from Steam's library API — a wishlist row's name only arrives once its
// store metadata streams in, so it needs a loading state.
const WISHLIST_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(
    COLUMNS.filter(c => c.key !== 'playtime' && c.key !== 'lastPlayed').map(c => (c.key === 'name' ? { ...c, format: fmt.str } : c)),
    'name', WISHLIST_RANK_COLUMN
  ),
  'releaseDate', WISHLIST_DATE_ADDED_COLUMN
);

const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres',
];

const playerInput   = document.getElementById('player-input');
const loadBtn       = document.getElementById('load-btn');
const statusEl      = document.getElementById('status');
const accountsBarEl = document.getElementById('accounts-bar');
const recentsBarEl  = document.getElementById('recents-bar');
const recentGamesBarEl = document.getElementById('recent-games-bar');
const tableContainer = document.getElementById('table-container');
const resetViewBtn  = document.getElementById('reset-view-btn');
const tabLibraryBtn  = document.getElementById('tab-library');
const tabWishlistBtn = document.getElementById('tab-wishlist');

let table         = null;
let unsyncView    = null;
let unGroupSort   = null; // see bindGroupBySort above
let rows          = [];
let rowMap        = new Map();
let total         = 0;
let loaded        = 0;
let flushTimer    = null;
let activeColumns = COLUMNS;   // COLUMNS or WISHLIST_COLUMNS, whichever tab is active
let activeTab     = 'library'; // 'library' | 'wishlist'
let currentPlayerStr = '';     // last player string actually loaded (not just typed)
// Steam64 ids of every account currently loaded (one flat group — see accountsBar.js's
// comment on why the Library Explorer only ever has one), used to fetch per-game
// achievement progress for the side panel. Achievements aren't tied to a specific tab —
// wishlisted/standalone-looked-up games can still report progress — only to a player
// actually being loaded, so this is shared by both loadLibrary and loadWishlist.
let currentSteamIds = [];
// Persona name(s) of whoever's currently loaded (joined with " + " for a merged Family), used
// by updateTitle below. Kept separate from currentPlayerStr (which holds raw typed/URL input)
// since the title should show resolved persona names, not account handles.
let currentPlayerLabel = '';
// Full player objects ({steamid, personaname, profileurl}[]) for the side panel's "Owned by"
// section (buildLibraryOwnersHtml) — only ever populated by loadLibrary, never loadWishlist
// (wishlist items aren't owned by anyone), so the section naturally stays hidden on that tab
// without needing its own tab check. playtimeByAppid/lastPlayedByAppid are the matching
// per-account raw maps `/api/common-games` already returns (same shape as app.js's own
// `playtime`/`lastPlayed`) — loadLibrary otherwise only keeps the summed/maxed-across-accounts
// numbers it writes onto each row, which is all the table itself needs but flattens away
// exactly the per-member breakdown a merged Steam Family's owners section wants to show.
let currentPlayers = [];
let playtimeByAppid = {};
let lastPlayedByAppid = {};
// appid → the achievements API's response, cached client-side per (appid, loaded accounts)
// so reopening the same game's panel doesn't refetch. Cleared whenever the loaded
// player(s) change (resetTableState) since a stale entry there would show the wrong
// account's progress.
const achievementsCache = new Map();
const achievementsCacheKey = appid => `${appid}:${currentSteamIds.slice().sort().join(',')}`;

// Separate shuffle history per tab, so picking randomly in one doesn't affect the other.
const randomQueueKey = () => activeTab;
const viewParamName  = () => (activeTab === 'wishlist' ? 'wview' : 'view');

initPanel({
  inertSelector: '.lib-page',
  showAchievements: true,
  getOwnersHtml: buildLibraryOwnersHtml,
  onRefresh: async (row) => {
    try {
      const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      if (table) table.setData(visibleRows());
      await loadAchievements(row, { force: true }); // still meaningful with no player loaded — see loadAchievements
    } catch (err) {
      statusEl.textContent = `Refresh failed: ${err.message}`;
    }
  },
  // Runs on every close path (see the comment on `onClose` in panel.js) — not just the
  // Escape-key one, which used to be the only one that remembered to clear `?game=`/
  // `&shot=`; the backdrop click, × button, and swipe-to-close left them stale otherwise.
  // resetTableState()'s own panelClose() call (a genuine new Load/refresh/tab-switch)
  // already clears these params itself beforehand via updateUrlParams, so this just runs
  // redundantly-but-harmlessly there — see loadLibrary/loadWishlist.
  onClose: () => { setPanelParam(null); updateTitle(); },
  // Backs the DLC card's links (public/panel.js) — a real href so ctrl/cmd/shift/middle
  // click still opens it in a new tab, alongside whatever else is in the current URL.
  gameHref: appid => {
    const params = new URLSearchParams(location.search);
    params.delete('shot');
    params.set('game', appid);
    return `?${reorderUrlParams(params)}`;
  },
  // Clicking a DLC entry (or the panel's own "← Back" button) — reuses the same "open this
  // appid" mechanism as the "look up any game" search box, just keeping panel.js's own
  // DLC-navigation history stack instead of starting a fresh one.
  onNavigateGame: (appid, name) => openStandaloneLookup(appid, name, { keepHistory: true }),
});
initLightbox({ onParamChange: setLightboxParam });

initGameSearch({
  inputEl: document.getElementById('game-lookup-input'),
  resultsEl: document.getElementById('game-lookup-results'),
  onSelect: ({ appid, name }) => openStandaloneLookup(appid, name),
});

document.getElementById('shortcuts-backdrop').addEventListener('click', closeShortcuts);
document.querySelector('.shortcuts-close').addEventListener('click', closeShortcuts);

function openShortcuts() {
  document.getElementById('shortcuts-modal').classList.add('open');
  document.getElementById('shortcuts-backdrop').classList.add('open');
}

function closeShortcuts() {
  document.getElementById('shortcuts-modal').classList.remove('open');
  document.getElementById('shortcuts-backdrop').classList.remove('open');
}

function toggleShortcuts() {
  if (document.getElementById('shortcuts-modal').classList.contains('open')) closeShortcuts();
  else openShortcuts();
}

// Rows whose details have streamed in — what's actually shown in the table (see
// visibleRows() below for why unloaded rows are withheld rather than shown as '…' placeholders).
function visibleRows() {
  return rows.filter(r => !r.loading);
}

// Stable order for prev/next nav — independent of the table's own live
// sort/filter/group state, which isn't exposed by @vates/data-table-vanilla.
// The table's current search/filter/sort order — same pipeline @vates/data-table-vanilla
// applies internally (searchData then processData), minus its grouping/pagination, which are
// display-only concerns with no single well-defined linear order (a grouped multi-value column
// like Genres fans a game out into more than one group).
function getGameList() {
  const view = table.getViewState();
  const filters = Object.fromEntries(
    Object.entries(view.filters ?? {}).map(([key, values]) => [key, new Set(values)])
  );
  const searched = searchData(visibleRows(), view.searchQuery ?? '', activeColumns);
  return processData(searched, filters, view.rangeFilters ?? {}, view.sorts ?? [], activeColumns, DEFAULT_LABELS.emptyValue);
}

// Same template as the comparison page's buildOwnersHtml (app.js) — kept as a separate copy
// here rather than shared, since the two pages' underlying data shapes differ (slots/groups
// there vs. one flat currentPlayers array here) enough that sharing would need its own
// abstraction layer for what's otherwise a handful of lines. Naturally empty for a standalone
// lookup (the appid won't be a key in playtimeByAppid at all) and for the Wishlist tab
// (playtimeByAppid is only ever populated by loadLibrary — see its declaration above) without
// needing an explicit check for either case.
function buildLibraryOwnersHtml(g) {
  const gamePt = playtimeByAppid[g.appid] || {};
  const gameLp = lastPlayedByAppid[g.appid] || {};
  const owners = currentPlayers
    .filter(p => p.steamid in gamePt)
    .map(p => ({
      name: p.personaname || '?',
      minutes: gamePt[p.steamid] || 0,
      lastPlayedSec: gameLp[p.steamid] || 0,
    }));
  if (!owners.length) return '';
  // Most recently played first, same convention as the comparison page's version — someone
  // who's never launched it (lastPlayedSec 0) sorts last, alphabetically among themselves so
  // the order stays deterministic.
  owners.sort((a, b) => b.lastPlayedSec - a.lastPlayedSec || a.name.localeCompare(b.name));
  const maxMinutes = Math.max(...owners.map(o => o.minutes), 1);
  return `<div class="panel-section panel-card">
    <div class="panel-section-title">Owned by <span class="panel-section-subtitle">most recently played first</span></div>
    <div class="panel-owners">${owners.map(o => {
      const lp = fmtLastPlayed(o.lastPlayedSec);
      const pt = fmtPlaytime(o.minutes);
      return `<div class="panel-owner">
        <div class="panel-owner-top">
          <span class="panel-owner-name">${esc(o.name)}</span>
          <span class="panel-owner-lastplayed">${lp ? esc(lp) : 'never played'}</span>
        </div>
        <div class="panel-owner-meter-track"><div class="panel-owner-meter-fill" style="width:${Math.round(o.minutes / maxMinutes * 100)}%"></div></div>
        <span class="panel-owner-playtime">${pt ? `${esc(pt)} played` : 'not played'}</span>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function renderPanelNav(game) {
  const nav = document.getElementById('panel-nav');
  // A standalone lookup (see openStandaloneLookup below) isn't part of the loaded
  // library/wishlist table — with no table yet (a bare lookup with no player loaded) or no
  // natural list to page through, there's no nav to show.
  if (!table || game.standalone) { nav.innerHTML = ''; return; }
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === game.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document.getElementById('panel-prev').addEventListener('click', () => {
    openGame(list[(idx - 1 + list.length) % list.length]);
  });
  document.getElementById('panel-next').addEventListener('click', () => {
    openGame(list[(idx + 1) % list.length]);
  });
  document.getElementById('panel-reroll').addEventListener('click', pickRandomGame);
}

function openGame(game, { isRandom = false, keepHistory = false } = {}) {
  if (!isRandom) clearRandomQueue(randomQueueKey());
  panelOpen(game, { keepHistory });
  updateTitle();
  renderPanelNav(game);
  setPanelParam(game.appid);
  loadAchievements(game);
}

// Fetches this game's achievement schema + unlock state for whichever account(s) are
// currently loaded, and re-renders the panel body as it goes (loading, then loaded) if
// the panel is still open on this same game by the time each stage settles — the panel
// may have moved on to a different game mid-fetch (fast prev/next/random navigation).
// currentSteamIds is optional here — the achievement *list* (names, descriptions, icons,
// community-wide rarity) is store metadata, not tied to any account, so it's still worth
// fetching with nobody loaded (e.g. a standalone "look up any game" lookup). Only the
// achieved/unlocktime state per item needs an account; the server's `playerCount` field
// (see achievementsHtml in panel.js) tells the panel whether that part applies at all.
async function loadAchievements(game, { force = false } = {}) {
  const key = achievementsCacheKey(game.appid);
  if (!force) {
    const cached = achievementsCache.get(key);
    if (cached) {
      game.achievements = cached;
      if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
      return;
    }
  }

  game.achievementsLoading = true;
  if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);

  try {
    const qs = new URLSearchParams();
    if (currentSteamIds.length) qs.set('steamids', currentSteamIds.join(','));
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/achievements/${game.appid}?${qs}`);
    const data = await res.json();
    if (res.ok) {
      // Links out to this specific account's own Steam achievements page — the server has
      // no single "the" account to link to when a slot merges a Steam Family, so this picks
      // whichever account loaded first, same "first-seen wins" convention used elsewhere
      // (e.g. the owned-games union) rather than trying to represent every member at once.
      // Only meaningful with an account loaded at all — omitted otherwise.
      if (currentSteamIds.length) {
        data.steamUrl = `https://steamcommunity.com/profiles/${currentSteamIds[0]}/stats/${game.appid}/achievements/`;
      }
      achievementsCache.set(key, data);
    }
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  }
}

function pickRandomGame() {
  if (!table || getPanelGame()?.standalone) return; // see renderPanelNav
  const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid);
  if (pick) openGame(pick, { isRandom: true });
}

// Opens the panel for a game from the "look up any game" search box (public/gameSearch.js)
// rather than a table row — works with or without a player/library currently loaded. `name`
// is known client-side (picked from the search dropdown) and used only to avoid a title flash
// while the panel's own fetch is in flight — it's never sent to the server or the URL; the
// server always resolves the real name itself from store metadata, keyed on the appid, same
// as it does for a nameless wishlist row. If the appid turns out to already be a loaded row
// (the looked-up game is actually owned/wishlisted by the current player), open that row
// instead — full nav, playtime, etc. rather than a lesser standalone view of data already
// sitting in `rows`.
function openStandaloneLookup(appid, name, { keepHistory = false } = {}) {
  const existing = rowMap.get(appid);
  if (existing) {
    openGame(existing, { keepHistory });
    addRecentGame(existing.appid, existing.name, existing.capsule || null);
    renderRecentGamesBar(recentGamesBarEl);
    return;
  }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
  openGame(game, { keepHistory });
  fetchStandaloneDetails(game);
}

async function fetchStandaloneDetails(game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    game.details = data;
    game.loading = false;
    if (data.meta?.name) game.name = data.meta.name;
    if (getPanelGame() === game) { renderPanelBody(game); setPanelParam(game.appid); updateTitle(); }
    addRecentGame(game.appid, game.name, data.meta?.capsule || null);
    renderRecentGamesBar(recentGamesBarEl);
  } catch (err) {
    if (getPanelGame() === game) statusEl.textContent = `Lookup failed: ${err.message}`;
  }
}

// ── URL state — deep link to an open game panel (`?game=`, restored via openStandaloneLookup
// above when the appid isn't backed by any loaded row) and, within it, a specific lightbox
// screenshot/video (`?shot=`). Mirrors app.js's setPanelParam/setLightboxParam/
// restorePanelFromUrl for the comparison page; see public/urlState.js for the equivalent
// parsing there (library.js has no analogous shared parser since its only other URL params —
// `u`, `tab`, `view`/`wview` — are handled by updateUrlParams/syncViewToUrl already). The name
// deliberately never rides along in this URL (see openStandaloneLookup) — only the appid is
// trusted, and the panel just shows a placeholder title until the fetch resolves it.
function setPanelParam(appid) {
  const params = new URLSearchParams(location.search);
  params.delete('shot');
  if (appid == null) params.delete('game');
  else params.set('game', appid);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

function setLightboxParam(idx) {
  const params = new URLSearchParams(location.search);
  if (idx == null) params.delete('shot');
  else params.set('shot', idx);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

// Reopens the panel (and, if present, the lightbox) from the current `?game=`/`?shot=`
// URL params. Only called on the initial page load (see the bottom of this file) —
// a genuine new Load/refresh/tab-switch explicitly clears those params instead (see
// loadLibrary/loadWishlist) since a game left open from a previous player/tab may not
// even exist in the new list.
//
// `restoreShot` must be threaded through from the page-load URL rather than re-read from
// location.search on the second (post-stream) call: opening the panel on the first call
// calls setPanelParam(), which deletes `shot` from the live URL (a fresh panel open always
// resets to the hero) — by the time the row's details are in, `shot` would already be gone.
function restorePanelFromUrl(restoreShot = null) {
  const params = new URLSearchParams(location.search);
  const appid = Number(params.get('game'));
  if (!appid) return;
  const row = rowMap.get(appid);
  if (row) {
    if (getPanelGame()?.appid !== appid) openGame(row);
    const shotParam = restoreShot ?? params.get('shot');
    if (shotParam !== null && !row.loading) openLightbox(row, shotParam);
    return;
  }
  // Not (yet) in the loaded library/wishlist rows — e.g. a game nobody in it owns/wishlists,
  // or no player loaded at all. Fetch it directly instead of silently giving up. Its name
  // isn't known yet (see openStandaloneLookup) — the panel opens with a placeholder title
  // until the fetch resolves it.
  if (getPanelGame()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneLookup(appid);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (isLightboxOpen()) {
      if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
      closeLightbox();
      return;
    }
    if (document.getElementById('shortcuts-modal').classList.contains('open')) { closeShortcuts(); return; }
    panelClose(); // onClose (see initPanel above) handles the URL cleanup
    return;
  }
  if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === '/') {
    e.preventDefault();
    playerInput.focus();
    return;
  }
  if (!isPanelOpen()) return;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isLightboxOpen()) {
    if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && !isLightboxOpen()) {
    e.preventDefault();
    pickRandomGame();
    return;
  }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (!table || getPanelGame()?.standalone) return; // see renderPanelNav — no list to page through
  e.preventDefault();
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === getPanelGame().appid);
  const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
  openGame(list[next]);
});

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (table) table.setData(visibleRows());
    updateLastPlayedTooltip();
    updateStatus();
  }, 150);
}

// See the `lastPlayed` column comment in COLUMNS above — 0/absent `rtime_last_played` for a
// non-key-owner account is indistinguishable from "never played", so a column that's entirely
// empty for the currently loaded rows is a much stronger signal of "Steam withheld this data"
// than of "this player has never launched a single game". Only the library tab has this column
// (see WISHLIST_COLUMNS) — the selector simply finds nothing on the wishlist tab, a harmless no-op.
function updateLastPlayedTooltip() {
  const th = tableContainer.querySelector('th[data-col-key="lastPlayed"]');
  if (!th) return;
  const loadedRows = visibleRows();
  const allMissing = loadedRows.length > 0 && loadedRows.every(r => !r.lastPlayed);
  th.title = allMissing
    ? 'No Last Played data for any game here — Steam\'s API only reports this for the account whose own key is being used, so this is likely unavailable rather than "never played".'
    : '';
}

// Single source of truth for the tab title: an open game (from a table row or a standalone
// lookup) takes over the title entirely, same convention as the comparison page's app.js —
// it's what the user is looking at, and what they'll want to find again in history/tab search.
function updateTitle() {
  const game = getPanelGame();
  if (game) {
    document.title = `${game.name} — Library Explorer`;
    return;
  }
  if (currentPlayerLabel) {
    const tabLabel = activeTab === 'wishlist' ? 'Wishlist' : 'Library';
    document.title = `${currentPlayerLabel}'s ${tabLabel} — Library Explorer`;
    return;
  }
  document.title = 'Library Explorer — Steam Common Games'; // matches the static <title> in library.html
}

// The header's back-link to the comparison tool carries the currently-loaded player(s) along —
// they arrive there as a single slot (comma-joined, same as a Steam Family), showing that
// player's library rather than landing on the bare empty form.
function updateBackLink() {
  const link = document.getElementById('back-to-comparison-link');
  link.href = currentSteamIds.length ? `/?u=${currentSteamIds.join(',')}` : '/';
}

function updateStatus() {
  if (total === 0) { statusEl.textContent = ''; return; }
  if (loaded >= total) {
    statusEl.textContent = `${total} games`;
  } else {
    statusEl.textContent = `${loaded} / ${total} games loaded…`;
  }
}

// Rendering, refresh-icon delegation, and localStorage recents all live in the shared
// public/accountsBar.js (also used by the comparison page's app.js).
const RECENTS_KEY = 'library-explorer:recent-players';

function renderAccountsBar(players, countLabel) {
  renderAccountChips(accountsBarEl, players, countLabel);
}

bindAccountRefresh(accountsBarEl, steamid => {
  loadCurrentTab(currentPlayerStr, { refreshIds: [steamid] });
});

bindRecentsBar(recentsBarEl, RECENTS_KEY, playerStr => {
  playerInput.value = playerStr;
  loadCurrentTab(playerStr);
});

renderRecentsBar(recentsBarEl, RECENTS_KEY);

// Shared, un-namespaced across both pages — see gameSearch.js.
bindRecentGamesBar(recentGamesBarEl, (appid, name) => openStandaloneLookup(appid, name));
renderRecentGamesBar(recentGamesBarEl);

// Defaults to replaceState — most callers are just keeping the URL in sync with state that's
// already reflected in the page (a stream event landing, a panel closing), not a new
// back/forward-worthy navigation. Pass `push: true` for the one action per logical "search"
// that should actually be undoable — see loadLibrary/loadWishlist/setActiveTab below, which
// used to each push their own partial update (clearing game/shot, then setting `u`, then
// `tab`), piling up several near-duplicate history entries per click.
function updateUrlParams(patch, { push = false } = {}) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  url.search = `?${reorderUrlParams(url.searchParams)}`;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

// Applies one SSE details event (rating/hltb/meta/tags) to its row. `name` is only
// backfilled from store metadata when the row didn't already have one — owned-game
// rows always do (from Steam's library API); wishlist rows don't, since GetWishlist
// returns no name at all.
function applyDetailsEvent(row, event) {
  row.capsule           = event.meta?.capsule ?? null;
  if (!row.name) row.name = event.meta?.name || '';
  row.score             = event.rating?.score ?? null;
  row.positivePct       = (event.rating?.positive != null && event.rating?.total)
    ? Math.round((event.rating.positive / event.rating.total) * 100) : null;
  row.steamdbRating     = computeSteamdbRating(event.rating?.positive, event.rating?.total);
  row.reviewsTotal      = event.rating?.total ?? null;
  row.hltbMain          = event.hltb?.main           ?? null;
  row.hltbExtra         = event.hltb?.extra          ?? null;
  row.hltbCompletionist = event.hltb?.completionist  ?? null;
  row.hltbAll           = event.hltb?.all            ?? null;
  row.metacritic        = event.meta?.metacritic?.score ?? null;
  row.releaseDate       = event.meta?.releaseDate    ?? null;
  row.comingSoon        = event.meta?.comingSoon     ?? false;
  row.genres            = event.meta?.genres     ?? [];
  row.developers        = event.meta?.developers ?? [];
  row.publishers        = event.meta?.publishers ?? [];
  row.categories        = event.meta?.categories ?? [];
  row.tags              = event.tags ?? [];
  row.protondb          = protonDbValue(event.protondb?.tier);
  row.achievementCount  = event.meta?.achievementCount ?? null;
  row.dlcCount          = event.meta?.dlc?.length ?? null;
  row.platforms         = event.meta?.platforms ?? [];
  row.languages         = event.meta?.languages ?? [];
  row.hasDemo           = event.demo != null;
  // Steam's own content-type enum (`game`/`dlc`/`music`/`video`/`series`/`episode`/`mod`/
  // `hardware`/`advertising`, or `null` if the store response omitted it — see the `type`
  // comment in lib/steam.js's extractAppDetails). Mapped to a friendly label rather than
  // shown as Steam's raw enum string; `TYPE_LABELS` below has the full mapping. `null` is its
  // own bucket ("Unknown") rather than defaulting to "Game" — most rows really are games, but
  // silently assuming that for the rare metadata-fetch failure would hide the difference
  // between "we don't know" and "confirmed a game".
  row.type              = TYPE_LABELS[event.meta?.type] ?? (event.meta?.type ? event.meta.type : null);
  // Heuristic, not fact — see computeProductionTier's own doc comment (public/utils.js) and
  // CLAUDE.md's AAA/AA/Indie section for what it's derived from and where it's known to be
  // wrong (cheap AAA remasters, prestige-priced small-studio sims, veteran-founded small
  // studios). Recomputed client-side from fields already delivered rather than added as its
  // own backend field, same pattern as steamdbRating above.
  row.productionTier    = computeProductionTier({
    isFree:       event.meta?.isFree ?? false,
    priceInitial: event.meta?.priceInitial ?? null,
    reviewsTotal: event.rating?.total ?? null,
    hasMetacritic: event.meta?.metacritic != null,
    isDlc:        event.meta?.fullgame != null,
    type:         event.meta?.type ?? null,
  });
  row.loading           = false;
  row.details           = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags, demo: event.demo, protondb: event.protondb };
}

// Streams rating/hltb/meta/tags for `games` ({appid, name}[]) over SSE and applies each
// event to its row in `rowMap` as it arrives. Shared by loadLibrary and loadWishlist. Only
// `appid` is actually sent — the server always resolves the game's name itself rather than
// trusting a client-supplied one (see CLAUDE.md's "Looking up an arbitrary game" section).
async function streamGameDetails(games) {
  let detailsResp;
  try {
    detailsResp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
    });
  } catch (err) {
    statusEl.textContent = `Details stream failed: ${err.message}`;
    return;
  }

  const reader  = detailsResp.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.done) continue;

      const row = rowMap.get(event.appid);
      if (!row) continue;

      applyDetailsEvent(row, event);
      if (isPanelOpen() && getPanelGame().appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }

      loaded++;
      scheduleFlush();
    }
  }

  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (table) table.setData(visibleRows());
  updateLastPlayedTooltip();
  updateStatus();
}

// preserveGameParam: skip clearing `?game=`/`&shot=` when closing a leftover panel — for a
// caller (loadLibrary/loadWishlist restoring a deep link, or loadFromUrl below on back/forward)
// that's about to reopen a game from those very params once the new data's in. See panel.js's
// own `preserveUrl` option, which this maps straight onto.
function resetTableState({ preserveGameParam = false } = {}) {
  if (isPanelOpen()) panelClose({ preserveUrl: preserveGameParam });
  clearRandomQueue(randomQueueKey());
  if (unsyncView) { unsyncView(); unsyncView = null; }
  if (unGroupSort) { unGroupSort(); unGroupSort = null; }
  if (table) { table.destroy(); table = null; }
  rows = []; rowMap = new Map(); total = 0; loaded = 0;
  tableContainer.innerHTML = '';
  resetViewBtn.hidden = true;
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
  currentSteamIds = [];
  currentPlayerLabel = '';
  currentPlayers = [];
  playtimeByAppid = {};
  lastPlayedByAppid = {};
  updateBackLink();
  achievementsCache.clear();
}

async function loadLibrary(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null, push = true } = {}) {
  // A genuine new load drops any `game`/`shot` left in the URL from a previous player/tab —
  // it may not even exist in the new list. The initial page-load path (bottom of this file)
  // passes preserveGameParam so it can restore the deep link once the new data is in. This
  // doesn't need to wait on the fetch below — unlike the `u` param (see further down), it's
  // not derived from anything the server resolves.
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching library…';
  resetTableState({ preserveGameParam });

  let result;
  try {
    const resp = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [members], refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      statusEl.textContent = `Error: ${error}`;
      return;
    }
    result = await resp.json();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    return;
  }

  const allGames = result.groups.flatMap(g => g.games);
  const slotSteamIds = result.slots[0].map(p => p.steamid);
  // Written from the server-resolved `steamid`s, not the raw typed input — a vanity name (or
  // an account whose vanity name changes later) always canonicalizes to the same shareable
  // URL and recent-search entry. `u` is deliberately not written until here, once the fetch
  // above has actually resolved it — see the comment on the `game`/`shot` clearing above.
  const idStr = slotSteamIds.join(',');
  // A single push per genuine new load (never for a same-search account refresh, never when
  // just restoring whatever the URL already says on initial load/back-forward — see `push`
  // above) — this used to be a separate pushState from the game/shot clear above, piling up
  // two history entries per click.
  updateUrlParams({ u: idStr }, { push: push && !refreshIds });
  currentSteamIds = slotSteamIds;
  currentPlayerLabel = result.slots[0].map(p => p.personaname || '?').join(' + ');
  currentPlayers = result.slots[0];
  playtimeByAppid = result.playtime || {};
  lastPlayedByAppid = result.lastPlayed || {};
  updateTitle();
  updateBackLink();
  renderAccountsBar(result.slots[0], 'games');
  addRecent(RECENTS_KEY, idStr, [result.slots[0]], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  rows = allGames.map(game => {
    const ptByAccount = (result.playtime && result.playtime[game.appid]) || {};
    const totalMin = slotSteamIds.reduce((s, id) => s + (ptByAccount[id] || 0), 0);
    const lpByAccount = (result.lastPlayed && result.lastPlayed[game.appid]) || {};
    const lastPlayedMax = Math.max(0, ...slotSteamIds.map(id => lpByAccount[id] || 0));
    return {
      appid:              game.appid,
      name:               game.name,
      playtime:           totalMin / 60,
      lastPlayed:         fmtLastPlayed(lastPlayedMax),
      capsule:            undefined,
      score:              undefined,
      positivePct:        undefined,
      steamdbRating:      undefined,
      reviewsTotal:       undefined,
      hltbMain:           undefined,
      hltbExtra:          undefined,
      hltbCompletionist:  undefined,
      hltbAll:            undefined,
      metacritic:         undefined,
      releaseDate:        undefined,
      genres:             undefined,
      developers:         undefined,
      publishers:         undefined,
      tags:               undefined,
      categories:         undefined,
      protondb:           undefined,
      achievementCount:   undefined,
      dlcCount:           undefined,
      platforms:          undefined,
      languages:          undefined,
      hasDemo:            undefined,
      loading:            true,
      details:            null, // { rating, hltb, meta, tags, demo, protondb } — same shape the side panel expects
    };
  });

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = COLUMNS;

  table = createDataTable(tableContainer, {
    data: visibleRows(), // empty at this point — every row starts out loading:true, see below
    columns: COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table);
  // Bound after syncViewToUrl's own initial load (not before) so bindGroupBySort's starting
  // snapshot already reflects a `?view=`-restored groupBy, if any — otherwise that restore
  // would itself look like a live "just grouped by this" click and get its sort overridden.
  unGroupSort = bindGroupBySort(table, COLUMNS);
  resetViewBtn.hidden = false;

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(allGames);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

async function loadWishlist(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null, push = true } = {}) {
  // See the matching comment in loadLibrary above — game/shot clearing doesn't need the
  // fetch below, but the `u` param does (it's written further down from resolved steamids).
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching wishlist…';
  resetTableState({ preserveGameParam });

  let result;
  try {
    const resp = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members, refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      statusEl.textContent = `Error: ${error}`;
      return;
    }
    result = await resp.json();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    return;
  }

  // Written from the server-resolved `steamid`s, not the raw typed input — see the matching
  // comment in loadLibrary above.
  const idStr = result.players.map(p => p.steamid).join(',');
  // See the matching comment in loadLibrary above.
  updateUrlParams({ u: idStr }, { push: push && !refreshIds });
  currentSteamIds = result.players.map(p => p.steamid);
  currentPlayerLabel = result.players.map(p => p.personaname || '?').join(' + ');
  updateTitle();
  updateBackLink();
  renderAccountsBar(result.players, 'wishlisted');
  addRecent(RECENTS_KEY, idStr, [result.players], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  rows = result.items.map(item => ({
    appid:              item.appid,
    name:               undefined, // unknown until store metadata streams in
    priority:           item.priority,
    dateAdded:          item.dateAdded,
    capsule:            undefined,
    score:              undefined,
    positivePct:        undefined,
    steamdbRating:      undefined,
    reviewsTotal:       undefined,
    hltbMain:           undefined,
    hltbExtra:          undefined,
    hltbCompletionist:  undefined,
    hltbAll:            undefined,
    metacritic:         undefined,
    releaseDate:        undefined,
    genres:             undefined,
    developers:         undefined,
    publishers:         undefined,
    tags:               undefined,
    categories:         undefined,
    protondb:           undefined,
    achievementCount:   undefined,
    dlcCount:           undefined,
    platforms:          undefined,
    languages:          undefined,
    hasDemo:            undefined,
    loading:            true,
    details:            null,
  }));

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = WISHLIST_COLUMNS;

  table = createDataTable(tableContainer, {
    data: visibleRows(), // empty at this point — every row starts out loading:true, see below
    columns: WISHLIST_COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: WISHLIST_DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table, { paramName: 'wview' });
  // See the matching comment in loadLibrary above.
  unGroupSort = bindGroupBySort(table, WISHLIST_COLUMNS);
  resetViewBtn.hidden = false;

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(result.items);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

function loadCurrentTab(playerStr, opts) {
  return activeTab === 'wishlist' ? loadWishlist(playerStr, opts) : loadLibrary(playerStr, opts);
}

function setActiveTab(tab, { fetch: shouldFetch = true } = {}) {
  if (tab === activeTab) return;
  activeTab = tab;
  tabLibraryBtn.setAttribute('aria-selected', String(tab === 'library'));
  tabWishlistBtn.setAttribute('aria-selected', String(tab === 'wishlist'));
  loadBtn.textContent = tab === 'wishlist' ? 'Load Wishlist' : 'Load Library';
  // Never pushes on its own — when a load follows right below, that load's own `u` update
  // (see loadLibrary/loadWishlist) pushes the single history entry for "switched to this tab
  // for this player", already carrying the `tab` value set here. With nothing to fetch (no
  // player loaded yet) there's nothing worth a history entry for either.
  updateUrlParams({ tab: tab === 'wishlist' ? 'wishlist' : null });
  updateTitle();
  if (shouldFetch && currentPlayerStr) loadCurrentTab(currentPlayerStr);
}

tabLibraryBtn.addEventListener('click', () => setActiveTab('library'));
tabWishlistBtn.addEventListener('click', () => setActiveTab('wishlist'));

loadBtn.addEventListener('click', () => {
  const val = playerInput.value.trim();
  if (val) loadCurrentTab(val);
});

resetViewBtn.addEventListener('click', () => {
  resetView(table, { paramName: viewParamName() });
  // resetView() clears sorts to none along with everything else — reapply our own default
  // sort on top, since there's no construction-time option for it (see DEFAULT_SORT above).
  table.setViewState({ sorts: DEFAULT_SORT });
});

playerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = playerInput.value.trim();
    if (val) loadCurrentTab(val);
  }
});

// Shared by the initial page load and browser back/forward — now that loadLibrary/loadWishlist
// push one real history entry per load/tab-switch (see `push` there), back/forward need an
// actual handler to act on those entries rather than just changing the address bar.
function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const player = params.get('u');
  const tab = params.get('tab') === 'wishlist' ? 'wishlist' : 'library';
  if (tab !== activeTab) setActiveTab(tab, { fetch: false }); // the load below does the fetching, in the right order
  if (player) {
    playerInput.value = player;
    currentPlayerStr = player;
    // preserveGameParam: a `?game=<appid>` (and `&shot=<idx>`) present in the URL on page
    // load should reopen that game/media once its row is in — see restorePanelFromUrl().
    // `shot` is captured here (not re-read later) since opening the panel deletes it from
    // the live URL — see the comment on restorePanelFromUrl(). `push: false` since this is
    // restoring state the URL already has, not a new navigable action.
    loadCurrentTab(player, { preserveGameParam: true, restoreShot: params.get('shot'), push: false });
  } else {
    if (currentPlayerStr) {
      currentPlayerStr = '';
      resetTableState({ preserveGameParam: true }); // a `?game=` in the new URL is restored below
      updateStatus();
      updateTitle();
    }
    // No player loaded at all — still honor a bare `?game=` standalone-lookup deep link
    // (loadLibrary/loadWishlist would otherwise be the only callers of restorePanelFromUrl).
    restorePanelFromUrl(params.get('shot'));
  }
}

window.addEventListener('popstate', loadFromUrl);
loadFromUrl();
