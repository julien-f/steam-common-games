'use strict';

import { createDataTable } from '@vates/data-table-vanilla';
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

// Every price-ish column (Tier Price, Steam Price, the three historical lows) is shown in the
// region currently selected (see COUNTRY_OPTIONS/detectCountry below) — `row.currency` rides
// along once per row (set from whichever price value arrives first; the bundle's own tier
// price and the /games/prices/v3 figures are always fetched with the same `country`, so they
// agree) since a column formatter has no other way to reach that value. `null` means "free"/
// "no data", never rendered as $0 or blank.
function renderPrice(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('—');
  try {
    return document.createTextNode(new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency || 'USD' }).format(v));
  } catch {
    return document.createTextNode(`${v.toFixed(2)} ${row.currency || ''}`);
  }
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
  return renderPrice(v, row);
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
  // Not part of the bundle response itself — fetched separately (POST /api/bundles/prices,
  // right after the game-details stream starts — see loadPrices below) since it's a distinct
  // upstream call with its own per-(gid,country) cache tier, unlike tierPrice/addon above
  // which come straight off the bundle object already in hand. Visible by default, alongside
  // Tier Price, precisely to answer "is this bundle actually a good deal" at a glance; the two
  // narrower-window lows (1yr/3mo) are hidden by default, same "secondary number" convention as
  // Wilson Score/Steam %/Achievements elsewhere in this column set.
  { key: 'steamRegular', label: 'Steam Price',    type: 'number', groupable: false, format: fmt.num, render: renderPrice, compare: compareNumMissingLast, defaultSortDir: 'asc' },
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

const DEFAULT_VISIBLE = ['capsule', 'name', 'tierPrice', 'steamRegular', 'lowAll', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres'];
const DEFAULT_SORT = [{ key: 'tierPrice', dir: 'asc' }];

// ── Region picker ───────────────────────────────────────────────────────────
// Curated rather than the full ISO 3166-1 list — these are the regions with meaningfully
// distinct Steam pricing/currency; ITAD's `country` param accepts any 2-letter code, but a
// bare dropdown of ~250 countries is worse UX than a short, deliberate list for a feature
// that only exists to compare bundle prices at a glance.
const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (USD)' },
  { code: 'GB', label: 'United Kingdom (GBP)' },
  { code: 'DE', label: 'Germany / EU (EUR)' },
  { code: 'CA', label: 'Canada (CAD)' },
  { code: 'AU', label: 'Australia (AUD)' },
  { code: 'JP', label: 'Japan (JPY)' },
  { code: 'BR', label: 'Brazil (BRL)' },
  { code: 'RU', label: 'Russia (RUB)' },
  { code: 'TR', label: 'Turkey (TRY)' },
  { code: 'UA', label: 'Ukraine (UAH)' },
  { code: 'AR', label: 'Argentina (ARS)' },
  { code: 'IN', label: 'India (INR)' },
  { code: 'CN', label: 'China (CNY)' },
  { code: 'KR', label: 'South Korea (KRW)' },
  { code: 'MX', label: 'Mexico (MXN)' },
];

// Best-effort browser-locale region, falling back to US when detection fails or lands
// outside the curated list above — see the "URL param, autodetect from the browser, curated
// country list" decision.
function detectCountry() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (COUNTRY_OPTIONS.some(c => c.code === region)) return region;
  } catch { /* Intl.Locale unsupported or unparseable navigator.language */ }
  return 'US';
}

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
const detailStatusEl     = document.getElementById('detail-status');
const tableContainer     = document.getElementById('table-container');
const unresolvedSection  = document.getElementById('unresolved-section');
const unresolvedListEl   = document.getElementById('unresolved-list');

for (const { code, label } of COUNTRY_OPTIONS) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = label;
  countrySelect.appendChild(opt);
}

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

let table = null;
let rows = [];
let rowMap = new Map();
let bundlesOffset = 0;
const BUNDLES_PAGE_SIZE = 20;
let bundles = [];
let activeBundleId = null;

initPanel({
  inertSelector: '.bundles-page',
  showAchievements: true,
  onRefresh: async (row) => {
    try {
      const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      if (table) table.setData(rows.filter(r => !r.loading));
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

async function loadBundles({ reset = true } = {}) {
  if (reset) { bundlesOffset = 0; bundles = []; bundleListEl.innerHTML = ''; setListCollapsed(false); }
  bundlesStatusEl.textContent = 'Loading bundles…';
  const qs = new URLSearchParams({
    country: countrySelect.value,
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
      if (isPanelOpen() && getPanelGame()?.appid === row.appid) renderPanelBody(row);
      loaded++;
      if (table) table.setData(rows.filter(r => !r.loading));
      detailStatusEl.textContent = `${loaded} / ${appids.length} games loaded…`;
    }
  }
  if (table) table.setData(rows.filter(r => !r.loading));
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

// Fetches Steam's non-discounted price + historical lows for the bundle's resolved games
// (see /api/bundles/prices) and applies them once available — a single batch call, not
// streamed per-game like ratings/HLTB/tags, so it can land before or after any given row has
// finished streaming its other details. Either order is fine: rows not yet visible (still
// `loading`) simply carry the price fields already set by the time they do appear; rows
// already visible get a follow-up `table.setData` to pick the new columns up.
async function loadPrices(resolved) {
  try {
    const qs = new URLSearchParams({ country: countrySelect.value });
    const res = await fetch(`/api/bundles/prices?${qs}`, {
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
      row.lowAll        = info.lowAll?.amount        ?? null;
      row.lowY1          = info.lowY1?.amount          ?? null;
      row.lowM3          = info.lowM3?.amount          ?? null;
      // A free/pay-what-you-want tier has no currency of its own (tierPrice/currency both
      // null) — backfill from whichever price figure actually came with one, so the render
      // functions above still know what to format the other columns in.
      if (!row.currency) row.currency = info.steamRegular?.currency ?? info.lowAll?.currency ?? null;
    }
  } catch (err) {
    console.warn('[bundles] price lookup failed:', err.message);
  } finally {
    if (table) table.setData(rows.filter(r => !r.loading));
  }
}

async function openBundle(bundle) {
  activeBundleId = bundle.id;
  renderBundleList();
  setListCollapsed(true);

  detailCard.hidden = false;
  detailTitleEl.textContent = bundle.title;
  detailMetaEl.textContent = `${bundle.page?.name || 'Unknown shop'} · ${bundle.counts?.games ?? '?'} games · ${fmtExpiry(bundle.expiry)}`;
  renderDetailLinks(bundle);
  detailStatusEl.textContent = 'Resolving games to Steam…';
  unresolvedSection.hidden = true;
  unresolvedListEl.innerHTML = '';

  if (table) { table.destroy(); table = null; }
  tableContainer.innerHTML = '';
  rows = [];
  rowMap = new Map();

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
    currency: g.tierCurrency, // backfilled by loadPrices if the tier itself was free (no currency of its own)
    addon: g.addon,
    steamRegular: undefined, lowAll: undefined, lowY1: undefined, lowM3: undefined,
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
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });

  detailStatusEl.textContent = `0 / ${resolved.length} games loaded…`;
  // Independent calls — Steam pricing has nothing to do with the rating/HLTB/tags pipeline —
  // run concurrently rather than one after the other.
  await Promise.all([streamGameDetails(resolved.map(g => g.appid)), loadPrices(resolved)]);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

countrySelect.addEventListener('change', () => { updateCountryParam(); loadBundles(); });
sortSelect.addEventListener('change', () => loadBundles());
expiredCheckbox.addEventListener('change', () => loadBundles());
loadMoreBtn.addEventListener('click', () => loadBundles({ reset: false }));

// `country` is the one durable, shareable piece of state this page writes to the URL — it
// changes what data is actually shown (prices/currency), same reasoning as `sort`/`view` on
// the other pages; see CLAUDE.md's URL / sharing section.
function updateCountryParam() {
  const params = new URLSearchParams(location.search);
  params.set('country', countrySelect.value);
  history.replaceState(null, '', `?${params}`);
}

function initCountry() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('country');
  const code = fromUrl && COUNTRY_OPTIONS.some(c => c.code === fromUrl) ? fromUrl : detectCountry();
  countrySelect.value = code;
  updateCountryParam();
}

async function init() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (!data.itadConfigured) {
      notConfiguredCard.hidden = false;
      browseCard.hidden = true;
      return;
    }
  } catch { /* if health itself fails, fall through and let loadBundles surface the real error */ }
  initCountry();
  loadBundles();
}

init();
