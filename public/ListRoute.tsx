// The generic list viewer — table + docked panel for a list, per docs/list-centric-redesign.md
// and the implementation plan's Phase 4/5. Registered for /lists/owned, /lists/wishlist,
// /lists/bundle/:bundleId, /lists/recent, and the generic /lists/:listId (see AppRoot.tsx).
//
// **Current scope**: only the 'owned' and 'wishlist' kinds are wired up for real (Phase 5 steps
// 1-2) — bundle/recent/user kinds render a "not yet available" placeholder until their own
// Phase 5 steps land. This is deliberately narrower than the full plan on one more axis too:
// ownership cross-referencing (in-library/on-wishlist badges) and achievements are not ported
// yet (both need a second background fetch this first pass omits); `currentAccount` is read
// once per mount, not live-reactive to being changed elsewhere while this route stays open —
// accountsStore.ts is a plain module with no Solid signal of its own yet, so there's nothing to
// subscribe to reactively here until one exists (a real follow-up, not an oversight).
//
// Ported from library.tsx's loadLibrary/loadWishlist/streamGameDetails/buildTable et al., but
// NOT a copy-paste: every mutable variable that used to be module-level there (table, rowsStore,
// loadGuard, total/loaded, …) is now local to this component's own closure, created fresh on
// each mount and torn down on unmount via onCleanup — library.tsx's page loads exactly once, but
// a router-driven route mounts/unmounts every time its path is navigated to/away from.
import { onMount, onCleanup, createSignal, createRoot, createEffect, batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { useParams, useLocation } from '@solidjs/router';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef, SortEntry, TableState } from '@vates/data-table-solid';
import { bucketDatePart, formatDatePart } from '@vates/data-table-core';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareDateMissingLast,
  withMissingGroup, formatMissingGroup, halfDecadeBucket, formatHalfDecadeBucket,
  protonDbValue, TYPE_LABELS,
} from './gameColumns.ts';
import { computeSteamdbRating, computeProductionTier, discountPct, fmtLastPlayed } from './utils.ts';
import { restoreTableView } from './tableViewPrefs.ts';
import { renderPanelNav as renderPanelNavShared, stepGameList } from './panelNav.ts';
import { createRowStore } from './rowStore.ts';
import { createStaleGuard } from './staleGuard.ts';
import { createStreamBatcher } from './streamBatcher.ts';
import {
  panelOpen, isPanelOpen, getPanelGame, pickRandomFrom, clearRandomQueue, renderPanelBody,
} from './panel.tsx';
import { setPanelParam } from './urlState.ts';
import { setPref } from './prefs.ts';
import { getCurrentAccount } from './accountsStore.ts';
import { fetchAccountOwnedGames, fetchAccountWishlistItems } from './accountData.ts';
import { postPrices, applyPriceInfo, nullMissingPriceFields, nullAllPriceFields } from './priceLoading.ts';
import { getStoredRegion, resolveRegion } from './region.ts';
import { registerRouteKeyboardHandlers } from './AppShell.tsx';
import type { Game, Rating, Hltb, GameMeta, ProtonDb } from './types.ts';

type ListKind = 'owned' | 'wishlist' | 'bundle' | 'recent' | 'user';

function kindFromPath(pathname: string, params: { bundleId?: string; listId?: string }): ListKind {
  if (pathname === '/lists/owned') return 'owned';
  if (pathname === '/lists/wishlist') return 'wishlist';
  if (params.bundleId) return 'bundle';
  if (pathname === '/lists/recent') return 'recent';
  return 'user';
}

// ── Columns — ported verbatim from library.tsx's own (see its comments for the full reasoning
// behind each column's grouping/format/category choices) ──────────────────────────────────────

const PLAYTIME_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'playtime', label: 'Played (h)', type: 'number', groupable: true,
  format: v => (v as number) > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc',
  groupValue: halfDecadeBucket, groupFormat: formatHalfDecadeBucket('h', 'Not played'),
  keepVisibleWhenGrouped: true, category: 'Play Time & Dates',
};

const LAST_PLAYED_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'lastPlayed', label: 'Last Played', type: 'date', groupable: true, format: fmt.str,
  compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
  groupValue: withMissingGroup(bucketDatePart('year'), (v: unknown) => v == null || v === ''),
  groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
  category: 'Play Time & Dates',
};

const WISHLIST_RANK_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'priority', label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num };

const WISHLIST_DATE_ADDED_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'dateAdded', label: 'Added', type: 'date', groupable: true, format: fmt.str, compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year')),
    groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
    category: 'Play Time & Dates' };

const OWNED_COLUMNS = insertColumnsAfter(CORE_COLUMNS, 'hltbCompletionist', PLAYTIME_COLUMN, LAST_PLAYED_COLUMN);
const OWNED_DEFAULT_VISIBLE = ['capsule', 'name', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres', 'playtime'];

const WISHLIST_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(
    insertColumnsAfter(CORE_COLUMNS, 'name', WISHLIST_RANK_COLUMN),
    'priority', ...PRICE_COLUMNS,
  ),
  'releaseDate', WISHLIST_DATE_ADDED_COLUMN,
);
const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres', 'hasDemo',
  'bestDealPrice', 'bestDealCut',
];

const DEFAULT_SORT: SortEntry[] = [{ key: 'steamdbRating', dir: 'desc' }];
const MAX_PRICE_LOOKUP_GAMES = 500; // mirrors the server's own cap — see loadWishlistPrices below

// The shape of one `data:` line in /api/game-details/stream's SSE response.
interface DetailsEvent {
  appid: number; done?: boolean;
  rating: Rating | null; hltb: Hltb | null; meta: GameMeta | null; tags: string[] | null;
  demo: { appid: number } | null; protondb: ProtonDb | null;
}

function applyDetailsEvent(row: Game, event: DetailsEvent) {
  row.capsule           = event.meta?.capsule ?? null;
  if (!row.name) row.name = event.meta?.name || '';
  row.score             = event.rating?.score ?? null;
  row.positivePct       = (event.rating?.positive != null && event.rating?.total)
    ? Math.round((event.rating.positive / event.rating.total) * 100) : null;
  row.steamdbRating     = computeSteamdbRating(event.rating?.positive ?? 0, event.rating?.total ?? 0);
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
  row.protondbPending   = event.protondb?.pending ?? false;
  row.achievementCount  = event.meta?.achievementCount ?? null;
  row.dlcCount          = event.meta?.dlc?.length ?? null;
  row.platforms         = event.meta?.platforms ?? [];
  row.languages         = event.meta?.languages ?? [];
  row.hasDemo           = event.demo != null;
  row.type              = (TYPE_LABELS as Record<string, string>)[event.meta?.type ?? ''] ?? (event.meta?.type ? event.meta.type : null);
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

// tableViewPrefs.ts's own bindViewPersistence needs `table.onViewChange`, which the Solid table
// doesn't have — reconstructed via a createEffect that re-reads getViewState() (tracking every
// signal it touches) instead, same as library.tsx's/bundles.tsx's own identical helper.
function bindSolidViewPersistence(ts: TableState<Game>, prefKey: string): () => void {
  let dispose: (() => void) | null = null;
  createRoot(d => {
    dispose = d;
    createEffect(() => setPref(prefKey, ts.getViewState()));
  });
  return () => dispose?.();
}

export default function ListRoute() {
  const params = useParams();
  const location = useLocation();
  const kind = kindFromPath(location.pathname, params);

  let tableContainer!: HTMLDivElement;
  const [statusText, setStatusText] = createSignal('');
  const [priceStatusText, setPriceStatusText] = createSignal('');

  const [rowsStore, setRowsStore] = createStore<Game[]>([]);
  const rowStore = createRowStore<Game>((idx, updater) => setRowsStore(idx, updater));
  const loadGuard = createStaleGuard();
  let table: TableState<Game> | null = null;
  let disposeTable: (() => void) | null = null;
  let unsyncView: (() => void) | null = null;
  let total = 0;
  let loaded = 0;

  function tableData(): Game[] { return rowsStore.filter(r => !r.loading); }
  function getGameList(): Game[] { return table ? table.processedData() : []; }
  function randomQueueKey(): string { return `list-route:${kind}`; }

  function updateStatus(): void {
    if (total === 0) { setStatusText(''); return; }
    setStatusText(loaded >= total ? `${total} games` : `${loaded} / ${total} games loaded…`);
  }

  function renderPanelNav(game: Game): void {
    renderPanelNavShared({ table, game, getGameList, onOpen: openGame, onReroll: pickRandomGame });
  }

  function openGame(game: Game, { isRandom = false, keepHistory = false }: { isRandom?: boolean; keepHistory?: boolean } = {}): void {
    if (!isRandom) clearRandomQueue(randomQueueKey());
    const resolved = rowStore.getRow(game.appid) ?? game;
    panelOpen(resolved, { keepHistory });
    renderPanelNav(resolved);
    setPanelParam(resolved.appid);
  }

  function pickRandomGame(): void {
    if (!table || getPanelGame()?.standalone) return;
    const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid ?? 0);
    if (pick) openGame(pick as Game, { isRandom: true });
  }

  function stepGame(dir: 1 | -1): boolean {
    if (!table) return false;
    const next = stepGameList(table, getGameList, getPanelGame(), dir);
    if (!next) return false;
    openGame(next);
    return true;
  }

  const detailBatcher = createStreamBatcher<DetailsEvent>({
    apply: event => {
      const row = rowStore.mutateRow(event.appid, draft => applyDetailsEvent(draft, event));
      if (!row) return;
      if (isPanelOpen() && getPanelGame()?.appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }
    },
    isStale: gen => loadGuard.isStale(gen),
    onFlush: () => updateStatus(),
  });

  async function streamGameDetails(games: { appid: number }[], gen: number): Promise<void> {
    let resp: Response;
    try {
      resp = await fetch('/api/game-details/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
      });
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Details stream failed: ${(err as Error).message}`);
      return;
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      if (loadGuard.isStale(gen)) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let event: DetailsEvent;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.done) continue;
        detailBatcher.push(event, gen);
        loaded++;
      }
    }
    if (loadGuard.isStale(gen)) return;
    detailBatcher.flushNow();
  }

  const itadConfiguredPromise = fetch('/api/health')
    .then(res => res.json())
    .then(data => !!data.itadConfigured)
    .catch(() => false);

  async function loadWishlistPrices(items: { appid: number }[], gen: number): Promise<void> {
    setPriceStatusText('');
    const configured = await itadConfiguredPromise;
    if (loadGuard.isStale(gen)) return;
    if (!configured) {
      batch(() => {
        for (const item of items) {
          const row = rowStore.mutateRow(item.appid, draft => nullAllPriceFields(draft));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
      return;
    }

    const country = resolveRegion(getStoredRegion());
    const appids = items.map(i => i.appid);
    for (let i = 0; i < appids.length; i += MAX_PRICE_LOOKUP_GAMES) {
      if (loadGuard.isStale(gen)) return;
      const chunk = appids.slice(i, i + MAX_PRICE_LOOKUP_GAMES);
      try {
        const prices = await postPrices({ appids: chunk, country });
        if (loadGuard.isStale(gen)) return;
        batch(() => {
          for (const appid of chunk) {
            const info = prices[appid];
            if (!info) continue;
            const row = rowStore.mutateRow(appid, draft => applyPriceInfo(draft, info, discountPct));
            if (!row) continue;
            if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
          }
        });
      } catch (err) {
        if (loadGuard.isStale(gen)) return;
        batch(() => {
          for (const appid of chunk) {
            const row = rowStore.mutateRow(appid, draft => nullMissingPriceFields(draft));
            if (!row) continue;
            if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
          }
        });
        setPriceStatusText(`Couldn't load Steam pricing (${(err as Error).message}) — other columns are unaffected.`);
      }
    }
  }

  function viewPrefKey(): string { return kind === 'wishlist' ? 'wishlistListView' : 'ownedListView'; }
  function viewParamName(): string { return kind === 'wishlist' ? 'wv' : 'lv'; }

  async function load(): Promise<void> {
    if (kind !== 'owned' && kind !== 'wishlist') return; // bundle/recent/user land in later Phase 5 steps
    const account = getCurrentAccount();
    if (!account) { setStatusText('No account selected — pick one from Home once it exists.'); return; }

    const gen = loadGuard.next();
    setStatusText(kind === 'wishlist' ? 'Fetching wishlist…' : 'Fetching library…');

    if (disposeTable) { disposeTable(); disposeTable = null; }
    table = null;
    setRowsStore([]);
    rowStore.reset();
    total = 0;
    loaded = 0;
    tableContainer.innerHTML = '';

    let initialRows: Game[];
    let streamTargets: { appid: number }[];
    try {
      if (kind === 'owned') {
        const games = await fetchAccountOwnedGames(account.members);
        if (loadGuard.isStale(gen)) return;
        initialRows = games.map(g => ({
          appid: g.appid, name: g.name,
          playtime: g.playtimeMinutes / 60, lastPlayed: fmtLastPlayed(g.lastPlayedUnix),
          loading: true, details: null,
        })) as unknown as Game[];
        streamTargets = games;
      } else {
        const items = await fetchAccountWishlistItems(account.members);
        if (loadGuard.isStale(gen)) return;
        initialRows = items.map(item => ({
          appid: item.appid, name: '', priority: item.priority, dateAdded: item.dateAdded,
          steamRegular: undefined, bestDealPrice: undefined, bestDealShop: undefined, bestDealUrl: undefined,
          bestDealCut: undefined, lowAll: undefined, lowY1: undefined, lowM3: undefined, priceCurrency: undefined,
          loading: true, details: null,
        })) as unknown as Game[];
        streamTargets = items;
      }
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Error: ${(err as Error).message}`);
      return;
    }

    setRowsStore(initialRows);
    rowStore.load(initialRows);
    total = initialRows.length;

    const columns = (kind === 'wishlist' ? WISHLIST_COLUMNS : OWNED_COLUMNS) as unknown as ColumnDef<Game>[];
    const defaultVisible = kind === 'wishlist' ? WISHLIST_DEFAULT_VISIBLE : OWNED_DEFAULT_VISIBLE;

    let disposeTableState!: () => void;
    const ts = createRoot(dispose => {
      disposeTableState = dispose;
      return createTableState<Game>(tableData, columns, {
        initialViewState: { pageSize: 50, visibleCols: defaultVisible, sorts: DEFAULT_SORT },
      });
    });
    table = ts;
    const disposeView = render(() => DataTableView<Game>({
      table: ts,
      rowKey: 'appid',
      onRowClick: row => openGame(rowStore.getRow(row.appid) ?? row),
    }), tableContainer);
    disposeTable = () => { disposeView(); disposeTableState(); };
    restoreTableView(table, viewPrefKey(), viewParamName());
    unsyncView = bindSolidViewPersistence(table, viewPrefKey());

    updateStatus();

    if (kind === 'wishlist') loadWishlistPrices(streamTargets, gen); // runs concurrently, not awaited
    await streamGameDetails(streamTargets, gen);
  }

  onMount(() => {
    const unregister = registerRouteKeyboardHandlers({ pickRandom: pickRandomGame, stepGame });
    load();
    onCleanup(unregister);
  });

  onCleanup(() => {
    loadGuard.next(); // invalidate any still-in-flight fetch/stream from this mount
    if (disposeTable) disposeTable();
    if (unsyncView) unsyncView();
  });

  return (
    <div class="list-route">
      {kind !== 'owned' && kind !== 'wishlist' && (
        <div class="route-placeholder">
          <h2>List route (stub)</h2>
          <p>kind: {kind}, path: {location.pathname}</p>
          <p>This list kind lands in a later Phase 5 step.</p>
        </div>
      )}
      {(kind === 'owned' || kind === 'wishlist') && (
        <>
          <div class="list-status">{statusText()}</div>
          {kind === 'wishlist' && <div class="price-status">{priceStatusText()}</div>}
          <div ref={tableContainer} class="table-container"></div>
        </>
      )}
    </div>
  );
}
