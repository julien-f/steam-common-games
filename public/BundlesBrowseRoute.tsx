// /bundles — browse/discover current Steam bundles via IsThereAnyDeal (see
// docs/list-centric-redesign.md and the implementation plan's Phase 5 step 5). Opening a bundle
// here always navigates to /lists/bundle/:bundleId (ListRoute.tsx's `bundle` kind) rather than
// rendering the resolved game table inline the way the legacy bundles.tsx page did — this route
// is only ever the "which bundle do you want" picker, not the bundle detail view too.
//
// The bundle list itself is a real @vates/data-table-solid table, the same viewer every list of
// games in the app already goes through — it replaced a hand-rolled row-of-flexbox-<button>s list
// ported from bundles.tsx, which had three problems this fixes wholesale: it was capped at a
// 260px scroll box (a legacy holdover from when the list sat *above* the opened bundle's own game
// table on one page — on this route the list *is* the page, with nothing below it to protect),
// its columns couldn't align across rows (each row being its own independent flex container, the
// leftover space its proportional title/shop items divided up differed per row depending on how
// wide that row's price/count/expiry text happened to be), and it had no filtering at all — only
// the server-side sort/"include expired" controls. Sorting is now the table's own, so the sort
// <select> is gone too; only "include expired" still round-trips to the server (see load()).
//
// A bundle row is not a Game, so this route has its own small column set rather than anything
// from gameColumns.ts — but it reuses that file's generic bucket/compare helpers (price tiers,
// missing-value grouping) so a price/date/count column here groups and sorts the same way its
// counterpart does in a game table.
import { createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { withAccountParam } from './urlState.ts';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef } from '@vates/data-table-solid';
import { bucketDatePart, formatDatePart, bucketNumericRange, formatNumericRange } from '@vates/data-table-core';
import {
  fmt, compareDateMissingLast, compareNumMissingLast, withMissingGroup, formatMissingGroup,
  priceTierBucket, formatPriceTier,
} from './gameColumns.ts';
import { fmtAge, formatMoney, scoreColor } from './utils.ts';
import {
  toBundleRow, fmtBundleDateTime, fmtBundleDatePart, fmtBundleTimePart, bundleUrgency, shopHue,
  type BundleListItem, type BundleRow,
} from './bundleRows.ts';
import { getStoredRegion, resolveRegion } from './region.ts';
import { setBrowsedBundles } from './bundleBrowseStore.ts';
import { restoreTableView, shareTableView, resetTableView } from './tableViewPrefs.ts';
import { createStaleGuard } from './staleGuard.ts';
import { setPref } from './prefs.ts';
import { setBaseTitle } from './pageTitle.ts';

const PAGE_SIZE = 50;      // ITAD's own max per page (lib/itad.js's getBundles `limit`)
// How many pages load() fetches back-to-back before handing over to the "Load more" button. The
// active list is ~30-40 bundles in practice (one page, so it always loads in full — which is what
// makes client-side filtering/sorting over the *whole* set meaningful rather than over an
// arbitrary first page); only "Include expired" reaches ITAD's much larger archive, which is what
// this cap and the button exist for.
const MAX_AUTO_PAGES = 4;
// Fixed — the table owns user-facing ordering now, so this only needs to be a stable order for
// paging through. Newest-first also means a capped expired load keeps the most recent archive.
const FETCH_SORT = '-publish';

const VIEW_PREF_KEY = 'bundlesBrowseView';
// Same param name every other table in the app shares (see ListRoute.tsx's viewParamName) — only
// one table is ever on screen per route, so there's nothing for it to collide with.
const VIEW_PARAM = 'tv';

// ── Cell rendering ────────────────────────────────────────────────────────────────────────────

// A 2×2 block of the bundle's first four game banners, standing in for the bundle cover ITAD
// doesn't have (see bundleCovers). Same shape as the game tables' own capsule column — an
// unlabelled, unsortable/unfilterable/ungroupable leading identity column whose images hide
// themselves rather than showing a broken-image icon if a URL 404s. A bundle with fewer than four
// games carrying artwork simply fills fewer cells; the grid's own tracks keep every row's block
// the same size regardless, so the column stays aligned.
function renderCovers(_value: unknown, row: BundleRow): Node {
  const wrap = document.createElement('div');
  wrap.className = 'bundle-covers';
  for (const src of row.covers) {
    const img = document.createElement('img');
    img.className = 'bundle-cover';
    img.alt = '';
    img.loading = 'lazy';
    img.width = 80;
    img.height = 30;
    img.src = src;
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    wrap.appendChild(img);
  }
  return wrap;
}

// Also the marker CSS uses to dim a whole expired row (`.dt-tr:has(.bundle-expired)` in
// style.css): the table library exposes no per-row class hook, so the row's own expired-ness has
// to reach CSS through one of its cells. The Bundle column is the one to hang it on — it's the
// identity column nobody hides, and `:has()` stops matching if its carrier column is hidden.
function renderBundleTitle(value: unknown, row: BundleRow): Node {
  const span = document.createElement('span');
  span.className = row.status === 'Expired' ? 'bundle-title bundle-expired' : 'bundle-title';
  span.textContent = value == null || value === '' ? '—' : String(value);
  return span;
}

// Hue from the shop name itself (shopHue), so a shop ITAD adds tomorrow gets its own consistent
// color with no code change; saturation/lightness live in `.shop-chip`'s own CSS so no hash can
// produce an unreadable chip. Doubles as the group header when grouping by Shop — the table falls
// back to a column's own `render` for a group with no `groupFormat`, which is what's wanted here.
function renderShop(value: unknown): Node {
  const span = document.createElement('span');
  if (value == null || value === '') { span.textContent = '—'; return span; }
  const name = String(value);
  span.className = 'shop-chip';
  span.style.setProperty('--shop-hue', String(shopHue(name)));
  span.textContent = name;
  return span;
}

// Date on the first line, its time on a second, smaller and dimmed (see fmtBundleDatePart's own
// comment for why the time is shown at all and why it isn't rounded to the hour). `extra`, when
// given, joins that second line after the time — the Ends column's countdown, below. Keeping it
// off the first line is what actually sets the column's width: "06:00 ⏳ in 2d" is narrower than
// "2026-09-24 ⏳ in 2d" would be, and the first line stays a bare date.
function renderDateTime(value: unknown, extra?: Node): Node {
  const wrap = document.createElement('div');
  wrap.className = 'bundle-datetime';
  const first = document.createElement('span');
  first.textContent = fmtBundleDatePart(value as string | null);
  wrap.appendChild(first);
  const time = fmtBundleTimePart(value as string | null);
  // No second line at all for a missing date, rather than an em dash under an em dash — unless
  // there's an `extra` to carry, which can't happen today (a date bundleUrgency can't parse yields
  // no countdown either) but would otherwise silently drop it.
  if (time || extra) {
    const timeEl = document.createElement('span');
    timeEl.className = 'bundle-datetime-time';
    timeEl.textContent = time;
    if (extra) timeEl.appendChild(extra);
    wrap.appendChild(timeEl);
  }
  return wrap;
}

// The above, plus — for a bundle actually about to go — a colored relative countdown, the one
// column on a bundle *browse* page where "act now" is real information rather than trivia. Colors
// are scoreColor's own tiers, the same scale every other urgency/quality signal in the app uses
// (Best Deal's record badges, Price Status), rather than a second palette meaning the same thing.
function renderEnds(value: unknown, row: BundleRow): Node {
  const urgency = bundleUrgency(value as string | null);
  // `later`'s empty label deliberately renders nothing at all — see bundleUrgency.
  let rel: HTMLSpanElement | undefined;
  if (urgency && urgency.label) {
    rel = document.createElement('span');
    rel.className = 'bundle-ends-rel';
    rel.textContent = urgency.tier === 'ended' ? urgency.label : `⏳ ${urgency.label}`;
    rel.style.color = urgency.tier === 'urgent' ? scoreColor(20)
      : urgency.tier === 'soon' ? scoreColor(55)
      : 'var(--text1)';
  }
  // An expired row is dimmed as a whole (see renderBundleTitle), so nothing further here.
  void row;
  return renderDateTime(value, rel);
}

const COLUMNS: ColumnDef<BundleRow>[] = [
  { key: 'covers', label: '', width: 188, sortable: false, filterable: false, groupable: false,
    value: () => null, render: renderCovers },
  { key: 'title', label: 'Bundle', type: 'string', groupable: false, format: fmt.str, render: renderBundleTitle },
  { key: 'shop', label: 'Shop', type: 'string', groupable: true, format: fmt.str, render: renderShop },
  {
    key: 'games', label: 'Games', type: 'number', groupable: true, format: fmt.num,
    defaultSortDir: 'desc', compare: compareNumMissingLast,
    groupValue: withMissingGroup(bucketNumericRange(10)),
    groupFormat: formatMissingGroup(formatNumericRange(10)),
  },
  {
    // Bucketed against the same PRICE_TIERS staircase every game-table price column uses, and
    // "Varies" (not "—") for a null price, matching the bundle detail table's own Tier Price
    // column — a pick-and-mix bundle genuinely has no single tier price, which is not the same as
    // missing data. compareNumMissingLast for the same reason it carries one there: under the
    // default numeric comparator `null` coerces to 0 and sorts as the cheapest thing in the table.
    key: 'price', label: 'Cheapest Tier', type: 'number', groupable: true,
    format: (v, row) => v == null ? 'Varies' : formatMoney(Number(v), row.currency),
    compare: compareNumMissingLast,
    // withMissingGroup, not a bare priceTierBucket: `Number(null)` is 0, so a null price would
    // otherwise land in its "Free" bucket rather than in the missing/"Varies" one.
    groupValue: withMissingGroup(priceTierBucket), groupFormat: formatMissingGroup(formatPriceTier, 'Varies'),
  },
  { key: 'tierCount', label: 'Tiers', type: 'number', groupable: true, format: fmt.num },
  // Published before Ends — a bundle's own life order, and the default sort's column sits next to
  // the ones it's read against rather than at the far end of the row.
  {
    key: 'publish', label: 'Published', type: 'date', groupable: true,
    format: v => fmtBundleDateTime(v as string | null), render: v => renderDateTime(v),
    compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('month'), v => v == null || v === ''),
    groupFormat: formatMissingGroup(formatDatePart('month')),
  },
  {
    key: 'expiry', label: 'Ends', type: 'date', groupable: true,
    format: v => fmtBundleDateTime(v as string | null), render: renderEnds, compare: compareDateMissingLast,
    defaultValueSort: { by: 'alpha', dir: 'asc' },
    groupValue: withMissingGroup(bucketDatePart('month'), v => v == null || v === ''),
    groupFormat: formatMissingGroup(formatDatePart('month')),
  },
  // Hidden by default: every row is Active unless "Include expired" is on, in which case this is
  // the column to filter/group on to tell the two apart.
  { key: 'status', label: 'Status', type: 'string', groupable: true, format: fmt.str },
];

const DEFAULT_VISIBLE = ['covers', 'title', 'shop', 'games', 'price', 'publish', 'expiry'];
// Newest first. This is a discovery page — "what's new since I last looked" is the browsing
// question — and a publish date never changes, so the order is stable between visits rather than
// reshuffling daily the way an ending-soonest sort does as deadlines approach and rows drop off.
// "What's about to go" is covered without the sort: renderEnds colors anything inside a week, so
// an expiring bundle catches the eye wherever it happens to sit.
const DEFAULT_SORT = [{ key: 'publish', dir: 'desc' as const }];

export default function BundlesBrowseRoute() {
  const navigate = useNavigate();
  const [rows, setRows] = createSignal<BundleRow[]>([]);
  const [statusText, setStatusText] = createSignal('');
  const [includeExpired, setIncludeExpired] = createSignal(false);
  const [moreAvailable, setMoreAvailable] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  // Toggling "Include expired" mid-load would otherwise let the old request's pages append
  // themselves onto the new list — the whole point of this route reloading from offset 0.
  const loadGuard = createStaleGuard();
  let offset = 0;

  const table = createTableState<BundleRow>(rows, COLUMNS, {
    initialViewState: { pageSize: 50, visibleCols: DEFAULT_VISIBLE, sorts: DEFAULT_SORT },
  });
  restoreTableView(table, VIEW_PREF_KEY, VIEW_PARAM);
  // tableViewPrefs.ts's own bindViewPersistence needs `table.onViewChange`, which the Solid table
  // doesn't have — a createEffect re-reading getViewState() (tracking every signal it touches)
  // reconstructs it. Unlike ListRoute.tsx's own copy this needs no createRoot of its own: the
  // table is built in this component's body, so the effect is owned by the component and disposed
  // with it.
  createEffect(() => setPref(VIEW_PREF_KEY, table.getViewState()));
  // Feeds /lists/bundle/:bundleId's prev/next nav (see bundleBrowseStore.ts) — off processedData,
  // not the raw row list, so ‹/› steps through exactly what's on screen in the order it's shown,
  // including whatever filter/sort/search the user has applied here.
  createEffect(() => setBrowsedBundles(table.processedData().map(b => ({ id: b.id, title: b.title }))));

  // Oldest page write time across this load (a load pulls several pages), null once any page was
  // fetched fresh; undefined = nothing loaded yet, which renders no readout rather than a
  // premature "just now".
  const [fetchedAt, setFetchedAt] = createSignal<number | null | undefined>(undefined);
  function noteFetchedAt(at: number | null): void {
    setFetchedAt(prev => (prev === undefined || at === null || prev === null ? at : Math.min(prev, at)));
  }

  async function fetchPage(force = false): Promise<BundleListItem[]> {
    const qs = new URLSearchParams({
      country: resolveRegion(getStoredRegion()),
      sort: FETCH_SORT,
      expired: String(includeExpired()),
      offset: String(offset),
      limit: String(PAGE_SIZE),
    });
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/bundles?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load bundles');
    noteFetchedAt(data.fetchedAt ?? null);
    return data.bundles as BundleListItem[];
  }

  async function load({ append = false, refresh = false }: { append?: boolean; refresh?: boolean } = {}): Promise<void> {
    const gen = loadGuard.next();
    if (!append) { offset = 0; setRows([]); setFetchedAt(undefined); }
    setLoading(true);
    setStatusText(append ? 'Loading more bundles…' : 'Loading bundles…');
    try {
      const collected: BundleRow[] = [];
      let reachedEnd = false;
      for (let page = 0; page < (append ? 1 : MAX_AUTO_PAGES); page++) {
        const bundles = await fetchPage(refresh);
        if (loadGuard.isStale(gen)) return;
        collected.push(...bundles.map(b => toBundleRow(b)));
        offset += bundles.length;
        if (bundles.length < PAGE_SIZE) { reachedEnd = true; break; }
      }
      setRows(append ? [...rows(), ...collected] : collected);
      setMoreAvailable(!reachedEnd);
      // The table renders its own row count, so there's nothing left to say once rows exist.
      setStatusText(rows().length ? '' : 'No current bundles');
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Error: ${(err as Error).message}`);
    } finally {
      if (!loadGuard.isStale(gen)) setLoading(false);
    }
  }

  onMount(() => load());
  onMount(() => setBaseTitle('Bundles'));
  onCleanup(() => setBaseTitle(null));

  return (
    <div class="bundles-browse-route">
      <div class="bundles-controls">
        <label>
          <input type="checkbox" checked={includeExpired()} onChange={e => { setIncludeExpired(e.currentTarget.checked); load(); }} />
          Include expired
        </label>
        {/* Bundle listings are cached server-side (BUNDLES_CACHE_TTL_MINUTES), and a bundle can go
            live or expire at any time — so "this list is out of date" gets a control rather than a
            wait. */}
        <Show when={fetchedAt() !== undefined}>
          <span class="bundles-updated">Updated {fmtAge(fetchedAt())}</span>
        </Show>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={loading()}
          title="Re-fetch the bundle list from IsThereAnyDeal, bypassing the server's cache"
          onClick={() => load({ refresh: true })}
        >↻ Refresh</button>
      </div>
      <div class="list-view-actions">
        <button type="button" class="btn btn-ghost btn-sm" onClick={e => shareTableView(table, VIEW_PARAM, e.currentTarget)}>🔗 Share view</button>
        <button type="button" class="btn btn-ghost btn-sm" onClick={() => resetTableView(table, VIEW_PREF_KEY, VIEW_PARAM)}>Reset view</button>
      </div>
      <Show when={statusText()}><div class="bundles-status">{statusText()}</div></Show>
      <div class="table-container">
        <DataTableView<BundleRow>
          table={table}
          rowKey="id"
          onRowClick={row => navigate(withAccountParam(`/lists/bundle/${row.id}`))}
        />
      </div>
      <Show when={moreAvailable()}>
        <button type="button" class="btn btn-ghost" disabled={loading()} onClick={() => load({ append: true })}>Load more</button>
      </Show>
    </div>
  );
}
