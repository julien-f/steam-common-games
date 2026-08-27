'use strict';

import { createDataTable, persistViewToLocalStorage, resetView } from '@vates/data-table-vanilla';
import {
  processData, searchData, DEFAULT_LABELS, compareMissingLast,
  bucketNumericRange, bucketDatePart, formatNumericRange, formatDatePart,
  bucketLogRange, formatLogRange,
} from '@vates/data-table-core';

// ── Column building blocks — deliberately a separate copy from public/library.js's own
// COLUMNS, not a shared import. The two pages' row shapes differ enough (no playtime/
// ownership here, plus bundle-specific tierPrice/addon) that sharing would need its own
// abstraction layer for what's otherwise a few dozen lines; same "kept as a separate copy"
// precedent as library.js's own PROTON_TIER_COLORS/buildLibraryOwnersHtml relative to panel.js.

const fmt = {
  num:  v => v === undefined ? '…' : v === null ? '—' : String(v),
  numRound: v => v === undefined ? '…' : v === null ? '—' : String(Math.round(v)),
  dec1: v => v === undefined ? '…' : v === null ? '—' : Number(v).toFixed(1),
  str:  v => v === undefined ? '…' : v || '—',
  ct:   v => v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString(),
  arr:  v => v === undefined ? '…' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—'),
};

function renderScoreNum(v) {
  if (v === undefined) return document.createTextNode('…');
  if (v === null) return document.createTextNode('—');
  const rounded = Math.round(v);
  const span = document.createElement('span');
  span.style.color = scoreColor(rounded);
  span.textContent = String(rounded);
  return span;
}

const PROTON_TIER_ORDER = ['borked', 'bronze', 'silver', 'gold', 'platinum', 'native'];
const PROTON_TIER_COLORS = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};
function protonDbValue(tier) {
  if (PROTON_TIER_ORDER.indexOf(tier) === -1) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
function renderProtonBadge(v) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = PROTON_TIER_COLORS[v.toLowerCase()] || '#52525b';
  span.textContent = v;
  return span;
}
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
// Same pill shape, distinguishing a tier that only adds bonus content (soundtrack, extra
// DLC-ish items) on top of an already-unlocked base game, from a tier that unlocks a base
// game outright — an ITAD-specific fact this app's own library/wishlist tables have no
// equivalent of.
function renderAddonBadge(v) {
  if (v === undefined) return document.createTextNode('…');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = v ? '#8b4513' : 'var(--accent)';
  span.style.color = v ? '#fff' : '#0b1620';
  span.textContent = v ? 'Add-on' : 'Base';
  return span;
}

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

const TYPE_LABELS = {
  game: 'Game', dlc: 'DLC', music: 'Soundtrack', video: 'Video',
  series: 'Series', episode: 'Episode', mod: 'Mod', hardware: 'Hardware', demo: 'Demo',
  advertising: 'Advertising',
};

const PRODUCTION_TIER_ORDER = ['Indie', 'AA', 'AAA'];
const compareProductionTier = compareMissingLast((a, b) =>
  PRODUCTION_TIER_ORDER.indexOf(a) - PRODUCTION_TIER_ORDER.indexOf(b));
const compareProtonTier = compareMissingLast((a, b) =>
  PROTON_TIER_ORDER.indexOf(a.toLowerCase()) - PROTON_TIER_ORDER.indexOf(b.toLowerCase()));
const compareNumMissingLast = compareMissingLast((a, b) => a - b);

// Same coarse-release-date handling as library.js — see its own extensive comment on why
// "2026"/"Fall 2026"/"Q4 2026"/"Coming soon"/"TBA" all need special-cased anchoring rather
// than plain `new Date()` parsing.
const SEASON_END = { spring: [5, 20], summer: [8, 21], fall: [11, 20], autumn: [11, 20], winter: [2, 19] };
function endOfReleasePeriod(str) {
  const s = String(str).trim();
  let m;
  if ((m = /^(spring|summer|fall|autumn|winter)\s+(\d{4})$/i.exec(s))) {
    const [month, day] = SEASON_END[m[1].toLowerCase()];
    const year = m[1].toLowerCase() === 'winter' ? Number(m[2]) + 1 : Number(m[2]);
    return new Date(year, month, day).getTime();
  }
  if ((m = /^Q([1-4])\s+(\d{4})$/i.exec(s))) return new Date(Number(m[2]), Number(m[1]) * 3, 0).getTime();
  if ((m = /^(\d{4})(?:\s+or\s+later)?$/i.exec(s))) return new Date(Number(m[1]), 11, 31).getTime() + 1;
  if (/^[A-Za-z]+\s+\d{4}$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
  }
  return new Date(s).getTime();
}
const COMING_SOON_SENTINEL = new Date(9999, 0, 1).getTime();
const TBA_SENTINEL         = new Date(9999, 0, 2).getTime();
function releaseSortTimestamp(str) {
  const s = String(str).trim();
  if (/^coming soon$/i.test(s)) return COMING_SOON_SENTINEL;
  if (/^(to be announced|tba)$/i.test(s)) return TBA_SENTINEL;
  return endOfReleasePeriod(s);
}
const compareDateMissingLast = compareMissingLast(
  (a, b) => releaseSortTimestamp(a) - releaseSortTimestamp(b),
  v => v == null || v === '' || isNaN(releaseSortTimestamp(v)),
);
function renderReleaseDate(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  if (row.comingSoon) span.style.color = '#e4a82e';
  span.textContent = v;
  return span;
}

// Same half-decade log bucketing as library.js's Review Count column — see its own comment
// for why a fixed linear step is wrong for a value that spans orders of magnitude.
const LOG_BUCKET_OPTS = { divisions: [1, 3] };
const logBucketValue = bucketLogRange(LOG_BUCKET_OPTS);
function halfDecadeBucket(value) {
  const n = Number(value);
  if (n <= 0) return 0;
  const bucket = logBucketValue(value);
  return bucket === -Infinity ? 0.5 : bucket;
}
function formatHalfDecadeBucket(unit, zeroLabel) {
  const formatBucket = formatLogRange(LOG_BUCKET_OPTS, unit);
  return keyPart => {
    const n = Number(keyPart);
    if (n === 0) return zeroLabel;
    if (n === 0.5) return formatBucket(-Infinity);
    return formatBucket(keyPart);
  };
}
function withMissingGroup(bucketFn, isMissing = v => v == null) {
  return value => isMissing(value) ? null : bucketFn(value);
}
function formatMissingGroup(formatFn, missingLabel = '—') {
  return keyPart => keyPart === '' ? missingLabel : formatFn(keyPart);
}

// Every price-ish column is shown in the region currently selected (see COUNTRY_OPTIONS/
// detectCountry in public/region.js) — but NOT necessarily all in the *same* currency as each other, which is
// why there are two separate currency fields on a row rather than one shared `row.currency` (an
// earlier version of this file had exactly that single shared field, and it was a real bug:
// confirmed live, a bundle's own tier price can come back from ITAD in USD only — same
// "this shop just doesn't offer this country's currency" situation documented elsewhere for
// bundle prices — while that SAME bundle's games' Steam/other-shop prices, a separate upstream
// call, correctly come back in the requested EUR. A single shared field meant whichever request
// finished first "won" and silently mislabeled the other's amounts with the wrong currency
// symbol — right number, wrong currency, easy to miss since only the symbol was wrong).
// `tierCurrency` (bundle tier data) backs only the Tier Price column; `priceCurrency`
// (/games/prices/v3 data, set in loadPrices) backs every other price column. `null` means
// "free"/"no data" throughout, never rendered as $0 or blank.
function formatMoney(v, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(v); }
  catch { return `${v.toFixed(2)} ${currency || ''}`; }
}
function renderPrice(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('—');
  return document.createTextNode(formatMoney(v, row.priceCurrency));
}
// A `null` tier price does NOT mean free — ITAD only ever sends an explicit `{amount: 0}` for
// that (observed nowhere in practice, but the correct thing to special-case if it appears); a
// `null` `tiers[].price` means "no single fixed price at all", which in practice is Fanatical's
// "Build Your Own ⟨N⟩ Bundle" pick-and-mix format — one tier, a pool of 15-30 games, price
// scales with however many you pick rather than being a property of the bundle itself. Showing
// "Free" for that (the previous behavior) was flatly wrong — these bundles are never free.
// "Varies" is shown instead; only a real `amount === 0` renders as "Free".
function renderTierPrice(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('Varies');
  if (v === 0) return document.createTextNode('Free');
  return document.createTextNode(formatMoney(v, row.tierCurrency));
}

// Bare price only — no shop name in the cell itself (see the bestDealShop column below for
// that, kept separate/hidden for anyone who wants to group/filter by it). Colored, with a small
// icon suffix, when the current best deal is at or below a historical low: bright teal + 🔥 for
// an all-time low, green + ★ for a 1-year low that isn't (yet) an all-time one — reusing
// scoreColor's own "excellent"/"good" tier colors (see the side panel/table score columns)
// rather than inventing a new palette just for this. `<=` rather than `<` since the current
// deal genuinely can BE the historical low itself (it's what set it), not only ever beat it.
function renderBestDeal(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('—');
  const isAllTimeLow = row.lowAll != null && v <= row.lowAll;
  const isYearLow    = row.lowY1  != null && v <= row.lowY1;
  const span = document.createElement('span');
  if (isAllTimeLow) {
    span.style.color = scoreColor(90); // '#57cbde', the ≥80 "excellent" tier
    span.style.fontWeight = '700';
  } else if (isYearLow) {
    span.style.color = scoreColor(70); // '#a3cf4e', the ≥65 "good" tier
  }
  span.append(renderPrice(v, row));
  if (isAllTimeLow) span.append(' 🔥');
  else if (isYearLow) span.append(' ★');
  // Native `title` tooltip — the shop name was deliberately dropped from the cell's own text
  // (see the column's doc comment above) but is still worth surfacing on hover rather than
  // losing entirely. No "cheapest current price" restatement — that's already what the Best
  // Deal column itself means, so the tooltip is just the shop, plus a short dash-separated
  // record note when it's also a low — one consistent shape rather than a different sentence
  // per case, so the 🔥/★ badges have a plain-language explanation right there for anyone who
  // hasn't already puzzled them out from color alone.
  if (row.bestDealShop) {
    const record = isAllTimeLow ? ' — all-time low' : isYearLow ? ' — 1-year low' : '';
    span.title = `${row.bestDealShop}${record}`;
  }
  return span;
}

// How much cheaper the best deal is than Steam Full Price, as a whole percentage — computed
// here (in loadPrices, from the same response's steamRegular/bestDeal.price) rather than taken
// from ITAD's own per-deal `cut` field, deliberately: `cut` is that shop's own discount off
// *its own* regular price, which shops set independently and isn't consistent from row to row,
// whereas Steam Full Price is one stable, Valve-set anchor this app already treats as the
// reference price throughout — every row's Discount ends up answering the same "vs. buying it
// on Steam" question. Best Deal is defined as the cheapest price across *every* shop including
// Steam, so `bestDealAmt <= steamRegularAmt` always holds — this can't go negative in practice.
function discountPct(bestDealAmt, steamRegularAmt) {
  if (!(steamRegularAmt > 0) || bestDealAmt == null) return null;
  return Math.round((1 - bestDealAmt / steamRegularAmt) * 100);
}
// `0` (the best deal genuinely isn't any cheaper than Steam Full Price — distinct from
// `null`/`undefined`, which mean "no data"/"still loading") renders the same as missing data: a
// flat "0%" reads as noise next to every other row's real discount, and nothing else in this
// column set treats a confirmed zero differently from "nothing to show" either.
function renderCut(v) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null || v === 0) return document.createTextNode('—');
  return document.createTextNode(`-${v}%`);
}

const BUNDLE_COLUMNS = [
  // ── Identity ────────────────────────────────────────────────────────────────
  { key: 'capsule', label: '', width: 128, sortable: false, filterable: false, groupable: false,
    value: () => null, render: renderThumb },
  { key: 'name',       label: 'Name',       filterable: false, groupable: false, format: fmt.str },

  // ── Bundle-specific ─────────────────────────────────────────────────────────
  // `compare: compareNumMissingLast` — without it, a `null` ("Varies", no fixed price — see
  // renderTierPrice above) coerces to 0 under the column's default numeric comparator, which
  // would sort every "Build Your Own" bundle's games as if they were the single cheapest thing
  // in the table under the default ascending Tier Price sort. Pinned last instead, same as
  // every other "missing data" numeric column in this file.
  { key: 'tierPrice',  label: 'Tier Price', type: 'number', groupable: false, format: v => v == null ? 'Varies' : v === 0 ? 'Free' : v.toFixed(2), render: renderTierPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },
  { key: 'addon',      label: 'Add-on',     groupable: true, format: v => v ? 'Add-on' : 'Base', render: renderAddonBadge },

  // ── Steam pricing (IsThereAnyDeal) ──────────────────────────────────────────
  // Not part of the bundle response itself — fetched separately (POST /api/prices, right after
  // the game-details stream starts — see loadPrices below) since it's a distinct
  // upstream call with its own per-(gid,country) cache tier, unlike tierPrice/addon above
  // which come straight off the bundle object already in hand. Hidden by default — Best Deal
  // and Discount (below) already answer "is this worth buying" without it, so seeing the
  // absolute Steam price too every time is rarely necessary; it's kept as its own column
  // (rather than removed) for anyone who wants the exact number, or to sort/group by it. Named
  // "Steam Full Price" rather than the shorter "Steam Price" specifically to make clear it's
  // the non-discounted list price, not whatever Steam happens to be charging today.
  { key: 'steamRegular', label: 'Steam Full Price', type: 'number', groupable: false, format: fmt.num, render: renderPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },
  // The cheapest *current* price across every shop ITAD tracks for this game (Steam included) —
  // the "where do I actually buy this for less, right now" answer, as opposed to Steam Full
  // Price (Steam's own non-discounted list price) or the historical lows below (what something
  // has sold for at some point, not necessarily today). Visible by default, alongside Tier
  // Price and Discount, precisely to answer "is this bundle actually a good deal" at a glance.
  // `renderBestDeal` colors/badges the price itself when it's at or below a historical low (🔥
  // all-time, ★ 1yr) rather than showing the shop name in the cell — the shop is still
  // available as its own column (`bestDealShop`, hidden by default) for anyone who wants to
  // group/filter by "which shop currently has the best price", but cluttering the price cell
  // itself with it wasn't worth losing the room for the low-price indicator, judged the more
  // actionable of the two at a glance. All-Time Low itself is hidden by default now that Best
  // Deal's own color/badge already answers "is this a record low" without a separate column —
  // it's kept, not removed outright, since the exact number is still sometimes worth seeing
  // (e.g. how far above the record low the deal actually is), just not something worth showing
  // by default alongside the other price-ish columns.
  { key: 'bestDealPrice', label: 'Best Deal',     type: 'number', groupable: false, format: fmt.num, render: renderBestDeal, compare: compareNumMissingLast, defaultSortDir: 'asc' },
  // How much cheaper the best deal is than Steam Full Price (`discountPct`, computed in
  // loadPrices below — see its own comment for why this is computed against Steam's price
  // rather than taken from ITAD's own per-deal "cut" field). Rendered with a leading "-"
  // (`renderCut`) and "—" for a deal that isn't actually any cheaper than Steam (`0`) — real
  // data, not a missing value, but not worth a "-0%" reading either. Visible by default
  // alongside Best Deal.
  { key: 'bestDealCut',   label: 'Discount',      type: 'number', groupable: false, format: fmt.num, render: renderCut, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'bestDealShop',   label: 'Best Deal Shop', groupable: true, format: fmt.str },
  { key: 'lowAll',        label: 'All-Time Low',  type: 'number', groupable: false, format: fmt.num, render: renderPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },
  { key: 'lowY1',          label: '1yr Low',      type: 'number', groupable: false, format: fmt.num, render: renderPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },
  { key: 'lowM3',          label: '3mo Low',      type: 'number', groupable: false, format: fmt.num, render: renderPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },

  // ── Scores & reviews ────────────────────────────────────────────────────────
  { key: 'steamdbRating',    label: 'Weighted Rating',  type: 'number', groupable: false, format: fmt.numRound, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'score',            label: 'Wilson Score',    type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'positivePct',      label: 'Steam %',         type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'metacritic',       label: 'Metacritic Score',type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'reviewsTotal',     label: 'Review Count',    type: 'number', groupable: true, format: fmt.ct, defaultSortDir: 'desc',
    groupValue: withMissingGroup(halfDecadeBucket), groupFormat: formatMissingGroup(formatHalfDecadeBucket('', '0')),
    keepVisibleWhenGrouped: true },

  // ── How Long To Beat ────────────────────────────────────────────────────────
  { key: 'hltbAll',          label: 'All (h)',         type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')), keepVisibleWhenGrouped: true },
  { key: 'hltbMain',         label: 'Main (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')), keepVisibleWhenGrouped: true },
  { key: 'hltbExtra',        label: '+Extra (h)',      type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')), keepVisibleWhenGrouped: true },
  { key: 'hltbCompletionist',label: '100% (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)), groupFormat: formatMissingGroup(formatNumericRange(10, 'h')), keepVisibleWhenGrouped: true },

  // ── Dates ───────────────────────────────────────────────────────────────────
  { key: 'releaseDate',      label: 'Released',     type: 'date', groupable: true, format: fmt.str,
    parseDate: endOfReleasePeriod, compare: compareDateMissingLast, render: renderReleaseDate,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year', endOfReleasePeriod)),
    groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true },

  // ── Classification ──────────────────────────────────────────────────────────
  { key: 'genres',           label: 'Genres',       groupable: true, format: fmt.arr, keepVisibleWhenGrouped: true },
  { key: 'categories',       label: 'Categories',   groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' }, keepVisibleWhenGrouped: true },
  { key: 'tags',             label: 'Tags',         groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' }, keepVisibleWhenGrouped: true },
  { key: 'developers',       label: 'Developer',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' }, keepVisibleWhenGrouped: true },
  { key: 'publishers',       label: 'Publisher',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' }, keepVisibleWhenGrouped: true },
  { key: 'languages',        label: 'Languages',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' }, keepVisibleWhenGrouped: true },
  { key: 'type',             label: 'Type',         groupable: true, format: v => v || 'Unknown' },
  { key: 'productionTier',   label: 'Production Tier (est.)', groupable: true, format: fmt.str, compare: compareProductionTier, defaultSortDir: 'desc' },

  // ── Compatibility ───────────────────────────────────────────────────────────
  { key: 'platforms',        label: 'Platforms',    groupable: true, format: fmt.arr, keepVisibleWhenGrouped: true },
  { key: 'protondb',         label: 'ProtonDB',     groupable: true, format: fmt.str, render: renderProtonBadge, compare: compareProtonTier, defaultSortDir: 'desc' },

  // ── Extras ──────────────────────────────────────────────────────────────────
  { key: 'hasDemo',          label: 'Demo',         groupable: true, format: v => v === undefined ? '…' : v ? 'Demo' : '—', render: renderDemoBadge, defaultSortDir: 'desc' },
  { key: 'achievementCount', label: 'Achievements', type: 'number', groupable: true, format: fmt.num, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  { key: 'dlcCount',         label: 'DLC Count',    type: 'number', groupable: true, format: fmt.num, compare: compareNumMissingLast, defaultSortDir: 'desc' },
];

// Steam Full Price stays hidden by default — Best Deal + Discount (ITAD's own "cut" on that
// deal) together already answer "is this actually worth buying" without needing a third column
// to cross-reference against.
const DEFAULT_VISIBLE = ['capsule', 'name', 'tierPrice', 'bestDealPrice', 'bestDealCut', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres'];
// Cheapest first, best-rated among ties second — a genuinely useful browsing order (unlike a
// single-column sort, which leaves same-priced games in an arbitrary relative order).
const DEFAULT_SORT = [{ key: 'tierPrice', dir: 'asc' }, { key: 'steamdbRating', dir: 'desc' }];

// ── Region picker ───────────────────────────────────────────────────────────
// COUNTRY_OPTIONS/TIMEZONE_COUNTRY/detectCountry now live in the shared public/region.js
// (loaded as a plain script before this module, same convention as esc()/reorderUrlParams from
// utils.js/urlState.js) — library.js's Wishlist price columns need the exact same curated list
// and detection heuristic, and there's no reason for the two to drift apart.

// ── DOM refs ──────────────────────────────────────────────────────────────────
const notConfiguredCard = document.getElementById('not-configured-card');
const browseCard        = document.getElementById('browse-card');
const countrySelect      = document.getElementById('country-select');
const sortSelect         = document.getElementById('sort-select');
const expiredCheckbox    = document.getElementById('expired-checkbox');
const bundlesStatusEl    = document.getElementById('bundles-status');
const bundleListWrapEl   = document.getElementById('bundle-list-wrap');
const bundleListEl       = document.getElementById('bundle-list');
const toggleListBtn      = document.getElementById('toggle-list-btn');
const loadMoreBtn        = document.getElementById('load-more-btn');
const detailCard         = document.getElementById('detail-card');
const detailTitleEl      = document.getElementById('detail-title');
const detailMetaEl       = document.getElementById('detail-meta');
const detailLinksEl      = document.getElementById('detail-links');
const prevBundleBtn      = document.getElementById('prev-bundle-btn');
const nextBundleBtn      = document.getElementById('next-bundle-btn');
const detailStatusEl     = document.getElementById('detail-status');
const priceStatusEl      = document.getElementById('price-status');
const resetViewBtn       = document.getElementById('reset-view-btn');
const tableContainer     = document.getElementById('table-container');
const unresolvedSection  = document.getElementById('unresolved-section');
const unresolvedListEl   = document.getElementById('unresolved-list');

// Collapses the bundle list (see #bundle-list-wrap.collapsed in bundles.html) once a bundle has
// actually been picked — the list itself stops being the thing to focus on at that point, and a
// full-length list otherwise pushes the real content (the opened bundle's game table) far down
// the page. `toggleListBtn` lets it be reopened (e.g. to pick a different bundle) without
// forgetting what's currently open.
function setListCollapsed(collapsed) {
  bundleListWrapEl.classList.toggle('collapsed', collapsed);
  toggleListBtn.hidden = bundles.length === 0;
  toggleListBtn.textContent = collapsed ? 'Show list' : 'Hide list';
}
toggleListBtn.addEventListener('click', () => setListCollapsed(!bundleListWrapEl.classList.contains('collapsed')));

// One shared key rather than per-bundle — this is "how I like the table set up" (which
// columns, sort, grouping), not something tied to any one bundle's own data, so it should
// carry over from whichever bundle was open last to the next one, same as it would if this
// page only ever showed a single table.
const TABLE_VIEW_STORAGE_KEY = 'bundles:table-view';

let table = null;
let unpersistView = null;
let rows = [];
let rowMap = new Map();
let bundlesOffset = 0;
const BUNDLES_PAGE_SIZE = 20;
let bundles = [];
let activeBundleId = null;

// `rows`/`rowMap` hold long-lived, mutated-in-place row objects — every other consumer
// (the panel, achievements cache, prev/next-style lookups) wants that stable identity, and
// panel.js in particular re-renders by reading fields straight off whatever object `panelOpen`
// was called with, so it MUST stay the same reference across a refresh. `@vates/data-table-
// vanilla`'s `setData`, however, only re-renders a row's cells when the object at its rowKey is
// a genuinely new reference — a mutated-but-identity-unchanged row that was already visible in
// a previous `setData` call is not detected as changed and its cells go stale (confirmed live:
// `loadPrices` correctly writes `row.steamRegular`/etc., but a row already made visible by
// `streamGameDetails` before `loadPrices` resolves — the common case once everything is
// cache-warm and both fire near-instantly — never shows it, even though the row object itself
// is provably correct).
//
// `tableRowCache` (appid → the last copy actually handed to the table) is what makes the fix
// targeted rather than blanket: `visibleRowsForTable()` reuses a row's cached copy verbatim
// unless `markRowChanged` was called for it since the last render, in which case a fresh copy
// is made. A naive "copy every visible row on every setData call" version of this fix (an
// earlier draft) technically worked but was wrong: it forced the table to re-render every
// visible row's cells on every single event during streaming, not just the one that changed.
//
// The table's own click handler only ever has a `tableRowCache` copy to hand back, never
// `rowMap`'s canonical object — a row-copy that's discarded and remade every render (the naive
// version) would mean the panel silently opens a *different* copy each time, going stale the
// next time anything about that row streams in after the panel's already open. `onRowClick`
// below looks the canonical row back up by appid before opening it specifically to avoid that —
// so `applyDetailsEvent`/`markRowChanged` in `onRefresh` mutate the same object `rowMap` does,
// not a disconnected copy. Reusing the cached copy (rather than remaking it every render) is
// what makes that lookup meaningful across renders — a copy that's stable until something
// actually changes matches `rowMap`'s own object closely enough that identity bugs like this
// only need the one `onRowClick` guard, not a guard at every call site that reads a row back
// from the table.
//
// EVERY mutation site must call `markRowChanged` right after mutating, including
// `streamGameDetails`'s own first-time reveal of a row — not just `loadPrices`/`onRefresh`,
// which touch an already-visible row. `visibleRowsForTable`'s "no cache entry yet" fallback
// below looks like it would cover a fresh reveal on its own, but `loadPrices` and
// `streamGameDetails` run concurrently (`Promise.all` in `openBundle`), and on a cache-warm
// bundle `loadPrices` (one cheap batched ITAD call) routinely resolves *before*
// `streamGameDetails` (several real per-game Steam/HLTB calls) reveals that same row — its
// `markRowChanged` call fires first and creates a cache entry from the row's still-`loading`
// state, so by the time `streamGameDetails` later flips it visible, `tableRowCache` already
// "has" an entry and the fallback never fires, permanently stuck on that premature snapshot.
// Confirmed live exactly this way. Calling `markRowChanged` unconditionally after every mutation
// removes the ordering dependency entirely — the fallback below only exists as a defensive
// backstop for a row that somehow becomes visible with no mutator having called it.
let tableRowCache = new Map();
function markRowChanged(appid) {
  const row = rowMap.get(appid);
  if (row) tableRowCache.set(appid, { ...row });
}
function visibleRowsForTable() {
  return rows.filter(r => !r.loading).map(r => {
    if (!tableRowCache.has(r.appid)) tableRowCache.set(r.appid, { ...r }); // first reveal
    return tableRowCache.get(r.appid);
  });
}

initPanel({
  inertSelector: '.bundles-page',
  showAchievements: true,
  onRefresh: async (row) => {
    try {
      const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      markRowChanged(row.appid);
      if (table) table.setData(visibleRowsForTable());
      await loadAchievements(row, { force: true });
    } catch (err) {
      detailStatusEl.textContent = `Refresh failed: ${err.message}`;
    }
  },
  // Clicking a DLC/base-game link inside the panel — the linked appid may not be one of this
  // bundle's own resolved rows (e.g. a DLC not itself included in the bundle), so it's fetched
  // standalone the same way public/library.js's "look up any game" flow does.
  onNavigateGame: (appid, name) => openStandaloneGame(appid, name, { keepHistory: true }),
  gameHref: () => '#',
});
initLightbox({ onParamChange: () => {} });

const achievementsCache = new Map();

async function loadAchievements(game, { force = false } = {}) {
  if (!force) {
    const cached = achievementsCache.get(game.appid);
    if (cached) { game.achievements = cached; if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game); return; }
  }
  game.achievementsLoading = true;
  if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  try {
    const qs = new URLSearchParams();
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/achievements/${game.appid}?${qs}`);
    const data = await res.json();
    if (res.ok) achievementsCache.set(game.appid, data);
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  }
}

function openGame(game) {
  panelOpen(game);
  loadAchievements(game);
}

// A game linked from the panel (DLC/base-game nav) that isn't one of this bundle's own
// resolved rows — fetched directly, same "standalone lookup" shape as
// public/library.js/public/gameSearch.js use for the same situation.
function openStandaloneGame(appid, name, { keepHistory = false } = {}) {
  const existing = rowMap.get(appid);
  if (existing) { panelOpen(existing, { keepHistory }); loadAchievements(existing); return; }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
  panelOpen(game, { keepHistory });
  fetch(`/api/game-details/${appid}`)
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) throw new Error(data.error || 'Lookup failed');
      applyDetailsEvent(game, data);
      if (data.meta?.name) game.name = data.meta.name;
      if (getPanelGame() === game) renderPanelBody(game);
    })
    .catch(() => {});
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !isLightboxOpen()) panelClose();
});

// ── Bundle list ───────────────────────────────────────────────────────────────

function fmtExpiry(iso) {
  if (!iso) return 'no expiry listed';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `ends ${d.toISOString().slice(0, 10)}`;
}

// Cheapest tier that actually HAS a price. `null` here means no tier had one at all — Fanatical's
// "Build Your Own ⟨N⟩ Bundle" pick-and-mix format (a pool of games with no fixed bundle price,
// price scales with how many you pick), never a free bundle — a genuinely free/$0 tier still has
// a real price object (`{amount: 0, ...}`), which is truthy and included here same as any other
// priced tier. See renderTierPrice's own comment above for the same distinction on the game table.
function cheapestTierPrice(bundle) {
  const priced = (bundle.tiers || []).filter(t => t.price);
  if (!priced.length) return null;
  return priced.reduce((min, t) => t.price.amount < min.amount ? t.price : min, priced[0].price);
}

function fmtBundleListPrice(price) {
  if (!price) return 'Price varies';
  if (price.amount === 0) return 'Free';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
}

function renderBundleList() {
  bundleListEl.innerHTML = '';
  for (const bundle of bundles) {
    const price = cheapestTierPrice(bundle);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bundle-item';
    el.setAttribute('aria-current', String(bundle.id === activeBundleId));
    el.innerHTML = `
      <span class="bundle-item-title">${esc(bundle.title)}</span>
      <span class="bundle-item-shop">${esc(bundle.page?.name || '')}</span>
      <span class="bundle-item-price">${esc(fmtBundleListPrice(price))}</span>
      <span class="bundle-item-count">${bundle.counts?.games ?? '?'} games</span>
      <span class="bundle-item-expiry">${esc(fmtExpiry(bundle.expiry))}</span>
    `;
    el.addEventListener('click', () => openBundle(bundle));
    bundleListEl.appendChild(el);
  }
}

// `expandList: false` skips the reset branch's own re-expand — for a caller that's about to
// (re)open a bundle right after this resolves (a `?bundle=` deep link on init, or re-opening
// the still-active bundle after a country change — see both call sites below). Without it, the
// list would flash open with this call's freshly (re-)fetched bundles only to be immediately
// re-collapsed once that other, independent bundle-open call lands — a visible "list pops open
// then snaps shut" flicker, worse the more cache-warm both calls are (i.e. often).
async function loadBundles({ reset = true, expandList = true } = {}) {
  if (reset) {
    bundlesOffset = 0; bundles = []; bundleListEl.innerHTML = '';
    if (expandList) setListCollapsed(false);
  }
  bundlesStatusEl.textContent = 'Loading bundles…';
  const qs = new URLSearchParams({
    country: resolveRegion(countrySelect.value),
    sort: sortSelect.value,
    expired: String(expiredCheckbox.checked),
    offset: String(bundlesOffset),
    limit: String(BUNDLES_PAGE_SIZE),
  });
  try {
    const res = await fetch(`/api/bundles?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load bundles');
    bundles = reset ? data.bundles : [...bundles, ...data.bundles];
    bundlesOffset += data.bundles.length;
    renderBundleList();
    renderBundleNav(); // the loaded list changed — e.g. "Load more" may have just made Next available
    bundlesStatusEl.textContent = bundles.length ? `${bundles.length} bundles` : 'No current bundles';
    loadMoreBtn.hidden = data.bundles.length < BUNDLES_PAGE_SIZE;
    toggleListBtn.hidden = bundles.length === 0;
  } catch (err) {
    bundlesStatusEl.textContent = `Error: ${err.message}`;
  }
}

// ── Bundle detail — resolve games to Steam appids, then stream details ────────

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
  row.languages          = event.meta?.languages ?? [];
  row.hasDemo            = event.demo != null;
  row.type                = TYPE_LABELS[event.meta?.type] ?? (event.meta?.type ? event.meta.type : null);
  row.productionTier      = computeProductionTier({
    isFree:       event.meta?.isFree ?? false,
    priceInitial: event.meta?.priceInitial ?? null,
    reviewsTotal: event.rating?.total ?? null,
    hasMetacritic: event.meta?.metacritic != null,
    isDlc:        event.meta?.fullgame != null,
    type:         event.meta?.type ?? null,
  });
  row.loading = false;
  row.details = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags, demo: event.demo, protondb: event.protondb };
}

async function streamGameDetails(appids) {
  let resp;
  try {
    resp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: appids.map(appid => ({ appid })) }),
    });
  } catch (err) {
    detailStatusEl.textContent = `Details stream failed: ${err.message}`;
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let loaded = 0;
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
      markRowChanged(row.appid);
      if (isPanelOpen() && getPanelGame()?.appid === row.appid) renderPanelBody(row);
      loaded++;
      if (table) table.setData(visibleRowsForTable());
      detailStatusEl.textContent = `${loaded} / ${appids.length} games loaded…`;
    }
  }
  if (table) table.setData(visibleRowsForTable());
  detailStatusEl.textContent = `${rows.length} games`;
}

// Flattens a bundle's tiers into one row per unique game — a game unlocked at more than one
// tier (common: a cheap tier's games are still included in every pricier tier) keeps only the
// cheapest tier it first appears at, since that's the price that actually gets you this game.
// ITAD's tiers are already price-ascending in every bundle observed, so "first occurrence" and
// "cheapest occurrence" are the same thing here.
function flattenBundleGames(bundle) {
  const seen = new Map(); // gid -> { gid, slug, title, type, assets, tierPrice, tierCurrency, addon }
  for (const tier of bundle.tiers || []) {
    for (const g of tier.games || []) {
      if (seen.has(g.id)) continue;
      seen.set(g.id, {
        gid: g.id, slug: g.slug, title: g.title, type: g.type, assets: g.assets,
        tierPrice: tier.price ? tier.price.amount : null,
        tierCurrency: tier.price ? tier.price.currency : null,
        addon: !!tier.addon,
      });
    }
  }
  return [...seen.values()];
}

function renderUnresolvedList(games) {
  unresolvedSection.hidden = games.length === 0;
  unresolvedListEl.innerHTML = games.map(g => `
    <div class="unresolved-item">
      ${g.assets?.boxart ? `<img src="${esc(g.assets.boxart)}" alt="" loading="lazy">` : ''}
      <div>
        <div class="unresolved-item-title">${esc(g.title)}</div>
        <div class="unresolved-item-type">${esc(TYPE_LABELS[g.type] || g.type || 'Game')}</div>
      </div>
    </div>
  `).join('');
}

// Bundle-level actions kept out of the (already-crowded) list rows and shown only once a
// bundle is actually open — a plain link to ITAD's own page for it, and its real purchase
// link. `bundle.url` is the shop/affiliate link exactly as ITAD returned it — never rewritten
// or stripped of tracking params (ITAD's terms require passing prices/links through
// unmodified; see CLAUDE.md).
function renderDetailLinks(bundle) {
  detailLinksEl.innerHTML = `
    ${bundle.details ? `<a class="btn btn-ghost btn-sm" href="${esc(bundle.details)}" target="_blank" rel="noopener">View on IsThereAnyDeal ↗</a>` : ''}
    ${bundle.url ? `<a class="btn btn-primary btn-sm" href="${esc(bundle.url)}" target="_blank" rel="noopener">Get this bundle ↗</a>` : ''}
  `;
}

// Prev/Next step through whatever's currently loaded in `bundles` (respecting its current
// sort/filter), not the full remote list — no auto-"Load more" and no wraparound at the ends,
// both buttons just disable there. A bundle opened via deep link that isn't part of the
// currently loaded page (or opened before any list has loaded at all) has no list position to
// navigate from, so both buttons disable rather than guessing.
function renderBundleNav() {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  prevBundleBtn.disabled = idx <= 0;
  nextBundleBtn.disabled = idx === -1 || idx >= bundles.length - 1;
}
prevBundleBtn.addEventListener('click', () => {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  if (idx > 0) openBundle(bundles[idx - 1]);
});
nextBundleBtn.addEventListener('click', () => {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  if (idx !== -1 && idx < bundles.length - 1) openBundle(bundles[idx + 1]);
});

// Fetches Steam's non-discounted price + historical lows for the bundle's resolved games (see
// the shared POST /api/prices — gid-keyed here, since Bundles already has ITAD gids; the
// Library Explorer's Wishlist price columns hit the same route with `appids` instead — see its
// own comment in server.js) and applies them once available — a single batch call, not
// streamed per-game like ratings/HLTB/tags, so it can land before or after any given row has
// finished streaming its other details. Either order is fine: rows not yet visible (still
// `loading`) simply carry the price fields already set by the time they do appear; rows
// already visible get a follow-up `table.setData` to pick the new columns up.
async function loadPrices(resolved) {
  priceStatusEl.textContent = '';
  try {
    const qs = new URLSearchParams({ country: resolveRegion(countrySelect.value) });
    const res = await fetch(`/api/prices?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gids: resolved.map(g => g.gid) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Price lookup failed');
    for (const g of resolved) {
      const row = rowMap.get(g.appid);
      const info = data.prices[g.gid];
      if (!row || !info) continue;
      row.steamRegular = info.steamRegular?.amount ?? null;
      row.bestDealPrice = info.bestDeal?.price?.amount ?? null;
      row.bestDealShop   = info.bestDeal?.shop          ?? null;
      row.bestDealCut    = discountPct(row.bestDealPrice, row.steamRegular);
      row.lowAll        = info.lowAll?.amount        ?? null;
      row.lowY1          = info.lowY1?.amount          ?? null;
      row.lowM3          = info.lowM3?.amount          ?? null;
      // Always set directly from this batch's own response — never conditionally backfilled
      // off the bundle's own tier currency (see the comment on formatMoney/renderPrice above
      // for why those two can legitimately disagree). Every figure in one /games/prices/v3
      // response is in the same currency, so any of them is an equally valid source here.
      row.priceCurrency = info.steamRegular?.currency ?? info.bestDeal?.price?.currency ?? info.lowAll?.currency ?? info.lowY1?.currency ?? info.lowM3?.currency ?? null;
      markRowChanged(g.appid);
    }
  } catch (err) {
    console.warn('[bundles] price lookup failed:', err.message);
    // Without this, a failed request (rate limited, transient upstream error) left every
    // price-ish cell stuck on its "…" loading placeholder forever — indistinguishable from
    // "still loading" and easy to mistake for a hung page rather than a failure. `null` here
    // means "we tried and it didn't work", same as the "no data" state these columns already
    // render for a genuinely missing price — and a status line makes the failure visible
    // rather than only a console warning nobody but a developer would see.
    for (const g of resolved) {
      const row = rowMap.get(g.appid);
      if (!row) continue;
      if (row.steamRegular === undefined) row.steamRegular = null;
      if (row.bestDealPrice === undefined) row.bestDealPrice = null;
      if (row.bestDealShop   === undefined) row.bestDealShop   = null;
      if (row.bestDealCut    === undefined) row.bestDealCut    = null;
      if (row.lowAll        === undefined) row.lowAll        = null;
      if (row.lowY1          === undefined) row.lowY1          = null;
      if (row.lowM3          === undefined) row.lowM3          = null;
      markRowChanged(g.appid);
    }
    priceStatusEl.textContent = `Couldn't load Steam pricing (${err.message}) — other columns are unaffected.`;
  } finally {
    if (table) table.setData(visibleRowsForTable());
  }
}

async function openBundle(bundle) {
  activeBundleId = bundle.id;
  renderBundleList();
  renderBundleNav();
  setListCollapsed(true);
  setBundleParam(bundle.id);

  detailCard.hidden = false;
  detailTitleEl.textContent = bundle.title;
  detailMetaEl.textContent = `${bundle.page?.name || 'Unknown shop'} · ${bundle.counts?.games ?? '?'} games · ${fmtExpiry(bundle.expiry)}`;
  renderDetailLinks(bundle);
  detailStatusEl.textContent = 'Resolving games to Steam…';
  priceStatusEl.textContent = '';
  unresolvedSection.hidden = true;
  unresolvedListEl.innerHTML = '';

  if (unpersistView) { unpersistView(); unpersistView = null; }
  if (table) { table.destroy(); table = null; }
  tableContainer.innerHTML = '';
  resetViewBtn.hidden = true;
  rows = [];
  rowMap = new Map();
  tableRowCache = new Map();

  const games = flattenBundleGames(bundle);

  let appidsByGid;
  try {
    const res = await fetch('/api/bundles/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gids: games.map(g => g.gid) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Resolution failed');
    appidsByGid = data.appids;
  } catch (err) {
    detailStatusEl.textContent = `Error: ${err.message}`;
    renderUnresolvedList(games);
    return;
  }

  const resolved = [];
  const unresolved = [];
  for (const g of games) {
    const appid = appidsByGid[g.gid];
    if (appid) resolved.push({ ...g, appid });
    else unresolved.push(g);
  }
  renderUnresolvedList(unresolved);

  if (resolved.length === 0) {
    detailStatusEl.textContent = 'No games in this bundle could be matched to a Steam listing.';
    return;
  }

  rows = resolved.map(g => ({
    appid: g.appid,
    name: g.title,
    tierPrice: g.tierPrice,
    tierCurrency: g.tierCurrency,
    priceCurrency: undefined, // set by loadPrices — see the comment on formatMoney/renderPrice above for why this is a separate field from tierCurrency
    addon: g.addon,
    steamRegular: undefined, bestDealPrice: undefined, bestDealShop: undefined, bestDealCut: undefined,
    lowAll: undefined, lowY1: undefined, lowM3: undefined,
    capsule: undefined, score: undefined, positivePct: undefined, steamdbRating: undefined,
    reviewsTotal: undefined, hltbMain: undefined, hltbExtra: undefined, hltbCompletionist: undefined,
    hltbAll: undefined, metacritic: undefined, releaseDate: undefined, genres: undefined,
    developers: undefined, publishers: undefined, tags: undefined, categories: undefined,
    protondb: undefined, achievementCount: undefined, dlcCount: undefined, platforms: undefined,
    languages: undefined, hasDemo: undefined,
    loading: true, details: null,
  }));
  rowMap = new Map(rows.map(r => [r.appid, r]));

  table = createDataTable(tableContainer, {
    data: [],
    columns: BUNDLE_COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
    // The table's own click handler hands back whatever object is currently in
    // `tableRowCache` for this row — a copy, not `rowMap`'s canonical one (see
    // `visibleRowsForTable`'s comment above). Looking the canonical row back up by appid
    // before opening it means the panel (and anything that mutates whatever object it opened,
    // like `onRefresh` below) always operates on the same object `rowMap` does, not a
    // disconnected copy that further updates would silently stop reaching.
    onRowClick: row => openGame(rowMap.get(row.appid) ?? row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  // Loads whatever was last persisted (if anything) on top of the default sort just applied
  // above, and saves it back on every subsequent change — same "construction-time default,
  // then let persistence override it" ordering `syncViewToUrl` uses in library.js.
  unpersistView = persistViewToLocalStorage(table, TABLE_VIEW_STORAGE_KEY);
  resetViewBtn.hidden = false;

  detailStatusEl.textContent = `0 / ${resolved.length} games loaded…`;
  // Independent calls — Steam pricing has nothing to do with the rating/HLTB/tags pipeline —
  // run concurrently rather than one after the other.
  await Promise.all([streamGameDetails(resolved.map(g => g.appid)), loadPrices(resolved)]);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

countrySelect.addEventListener('change', () => {
  setStoredRegion(countrySelect.value);
  // A bundle's tier price and its games' Steam Full Price/Best Deal/lows (loadPrices above)
  // are all region-specific, but loadBundles() only refreshes the browse list above — it
  // never touches whatever bundle is currently open in the detail view below it. Re-open it
  // the same way a `?bundle=` deep link does, so its prices actually pick up the new country
  // instead of staying stuck on whatever was loaded before.
  const reopening = activeBundleId != null;
  // Skip the list's own re-expand when we're about to reopen the still-active bundle right
  // after — it's already collapsed (a bundle is open) and openBundle() will just collapse it
  // again once the reopen resolves, so expanding it here only produces a pointless flicker.
  // When no bundle is open, this is a plain browsing action and the list expands as usual.
  loadBundles({ expandList: !reopening });
  if (reopening) openBundleById(activeBundleId);
});
sortSelect.addEventListener('change', () => loadBundles());
expiredCheckbox.addEventListener('change', () => loadBundles());
loadMoreBtn.addEventListener('click', () => loadBundles({ reset: false }));

resetViewBtn.addEventListener('click', () => {
  if (!table) return;
  resetView(table, { storageKey: TABLE_VIEW_STORAGE_KEY });
  // resetView() clears sorts to none along with everything else — reapply our own default
  // sort on top, same as library.js's own reset-view button does (there's no construction-time
  // option to make resetView itself preserve a non-empty default).
  table.setViewState({ sorts: DEFAULT_SORT });
});

// `?bundle=<id>` deep link — writes/clears the param while preserving everything else already
// in the URL. Not pushed — opening a different bundle isn't meant to be a separate back/
// forward-navigable step (this page has no popstate listener at all, unlike library.js/app.js),
// same as how `sort`/`view` elsewhere in this app are written. `country` is deliberately not
// part of this (or any) URL — it's a `localStorage` preference (see public/region.js), not
// shareable state, since it says more about the viewer than about which bundle they're looking
// at.
function setBundleParam(id) {
  const params = new URLSearchParams(location.search);
  if (id == null) params.delete('bundle');
  else params.set('bundle', id);
  history.replaceState(null, '', `?${params}`);
}

// There's no single-bundle-fetch endpoint upstream (see findBundleById's own comment in
// lib/itad.js) — a deep link always goes straight to GET /api/bundles/:id (a bounded
// server-side search) rather than trying to find the id in whatever's already loaded in
// `bundles`, which may not even include it (a different sort/page, or not loaded yet at all on
// initial page load — this runs concurrently with loadBundles(), not after it).
async function openBundleById(id) {
  try {
    const qs = new URLSearchParams({ country: resolveRegion(countrySelect.value) });
    const res = await fetch(`/api/bundles/${id}?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bundle not found');
    await openBundle(data.bundle);
  } catch (err) {
    // Same UI slot a normally-opened bundle would use — there's no other sensible place to
    // surface "the bundle this link pointed at doesn't exist (anymore)". The invalid id is
    // dropped from the URL so a refresh doesn't repeat the same failed lookup.
    detailCard.hidden = false;
    detailTitleEl.textContent = 'Bundle not found';
    detailMetaEl.textContent = '';
    detailLinksEl.innerHTML = '';
    detailStatusEl.textContent = err.message;
    priceStatusEl.textContent = '';
    unresolvedSection.hidden = true;
    if (unpersistView) { unpersistView(); unpersistView = null; }
    if (table) { table.destroy(); table = null; }
    tableContainer.innerHTML = '';
    resetViewBtn.hidden = true;
    activeBundleId = null;
    renderBundleNav();
    setBundleParam(null);
    // No bundle ended up open, so this is back to being a plain browsing state — re-expand the
    // list rather than leaving it stuck collapsed with nothing open underneath it (a caller
    // that skipped loadBundles' own expand in anticipation of this call succeeding — see
    // `expandList` above — otherwise has no other path back to an expanded list).
    setListCollapsed(false);
  }
}

async function init() {
  initNav('bundles');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (!data.itadConfigured) {
      notConfiguredCard.hidden = false;
      browseCard.hidden = true;
      return;
    }
  } catch { /* if health itself fails, fall through and let loadBundles surface the real error */ }
  initRegionSelect(countrySelect);
  // Independent of each other — the deep link's own server-side search doesn't depend on
  // whatever page of the list loadBundles happens to fetch.
  const deepLinkId = Number(new URLSearchParams(location.search).get('bundle'));
  const hasDeepLink = Number.isInteger(deepLinkId) && deepLinkId > 0;
  // Skip loadBundles' own list expand when a deep link is about to open a bundle right after —
  // otherwise the list would flash open with the freshly loaded bundles only to be immediately
  // collapsed again once the deep link resolves (see `expandList`'s own comment above).
  if (hasDeepLink) setListCollapsed(true);
  loadBundles({ expandList: !hasDeepLink });
  if (hasDeepLink) openBundleById(deepLinkId);
}

init();
