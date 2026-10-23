// Shared "share/persist/reset a @vates/data-table-solid view via prefs.js + a one-shot URL
// param" logic — extracted verbatim from library.js's and bundles.js's own near-identical
// copies (see docs/dev/frontend.md's table section for the "share on demand, not
// live-synced" reasoning). Both pages call these the same way: a `table` instance and the
// ViewStore that page's view is kept in.
import { createEffect, createRoot, untrack } from 'solid-js';
import type { TableViewState, ViewStateApi } from '@vates/data-table-solid';
import { getPref, setPref, adoptPrefEntry, pushPrefToServer } from './prefs.ts';
import { getBaseline, setBaseline, stripTransientViewFields } from './tableViewSync.ts';
import { urlWithParams } from './urlState.ts';
import { copyWithFeedback } from './clipboard.ts';

// Where a table's own view is kept: a prefs.ts key, or a user list's own tableView.
export interface ViewStore {
  load(): TableViewState;
  save(view: TableViewState): void;
}

export function prefViewStore(key: string): ViewStore {
  return { load: () => getPref<TableViewState>(key, {}), save: (view) => setPref(key, view) };
}

// The URL param a "🔗 Share view" link carries the view in — one for every table, since a route
// only ever has one on screen (see urlState.ts's own comment on `tv`).
export const VIEW_PARAM = 'tv';

// An incoming param (from a shared/bookmarked link) wins over the stored default, for this visit
// only: applied but not stored, then stripped from the live URL so a later table rebuild (a fresh
// search, an account refresh) falls back to the viewer's own. Returns whether it applied one — the
// caller then pauses its view persistence until the viewer keeps or drops it (SharedViewBanner).
export function restoreTableView(table: ViewStateApi, store: ViewStore): boolean {
  const shared = takeSharedView();
  table.setViewState(shared ?? store.load());
  return shared != null;
}

// The incoming view param, parsed and stripped from the URL (malformed too); null when absent or malformed.
function takeSharedView(): TableViewState | null {
  const params = new URLSearchParams(location.search);
  const raw = params.get(VIEW_PARAM);
  if (!raw) return null;
  params.delete(VIEW_PARAM);
  history.replaceState(null, '', urlWithParams(params));
  let view: unknown;
  try {
    view = JSON.parse(raw);
  } catch {
    return null; // malformed — fall back to the stored default
  }
  // A wrongly typed field inside is data-table's to ignore; the rest of the view still applies.
  return isRecord(view) ? (view as TableViewState) : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Saves every future view change — the only ongoing side effect table interaction has; the URL
// stays untouched until explicitly shared. An effect re-reading getViewState() (tracking every
// signal it touches), in its own root since a route can bind it from an async load. `paused`:
// while a shared link's layout is on screen (SharedViewBanner); un-pausing saves it.
// `onPausedEdit`: whether that shared layout now differs from the link's (page/search aside).
// Returns the dispose function.
export function bindViewPersistence(
  table: ViewStateApi,
  store: ViewStore,
  paused: () => boolean,
  onPausedEdit: (edited: boolean) => void,
): () => void {
  return createRoot((dispose) => {
    let pausedView: string | undefined;
    createEffect(() => {
      const view = table.getViewState();
      if (!paused()) {
        pausedView = undefined;
        untrack(() => store.save(view)); // a store's save reads its own pref back
        return;
      }
      const layout = JSON.stringify(stripTransientViewFields(view));
      if (pausedView === undefined) pausedView = layout;
      else onPausedEdit(layout !== pausedView);
    });
    return dispose;
  });
}

// Snapshots the table's current view into VIEW_PARAM and copies the resulting link to the
// clipboard — deliberately does NOT write it to the page's own address bar (no
// `history.replaceState`): a param left sitting in the visible URL goes stale the moment the
// user makes one more change to the table, silently showing a snapshot that no longer matches
// what's on screen. The stored pref (bindViewPersistence above) already captures live state on
// every change; this link is only for handing the *current* view to someone else.
// `extraParams` are added only where the URL doesn't already set them.
export function shareTableView(table: ViewStateApi, btn: HTMLElement, extraParams: Record<string, string> = {}): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(extraParams)) if (!params.has(key)) params.set(key, value);
  const view = table.getViewState();
  // An unchanged view is the defaults: sending `{}` would only show the recipient a "shared layout" banner.
  if (Object.keys(view).length) params.set(VIEW_PARAM, JSON.stringify(view));
  else params.delete(VIEW_PARAM);
  const url = `${location.origin}${urlWithParams(params)}`;
  copyWithFeedback(btn, url);
}

// A blank view state resolves to the table's own `initialViewState` (default sort included), not to nothing.
export function resetTableView(table: ViewStateApi, store: ViewStore): void {
  table.setViewState({});
  store.save({});
}

// The two halves of the "unsaved changes" banner (tableViewSync.ts) — a table-view key is never
// auto-pushed (see prefs.ts's setPref), so the live/local view can sit indefinitely ahead of
// tableViewSync.ts's `baseline` (this session's best-known copy of what's actually saved) until
// the user picks one of these.
//
// "Save" pushes the current view up unconditionally (the server no longer timestamp-guards a
// write, see lib/auth.js) and advances the baseline to match, so the banner clears immediately
// rather than waiting for the next sign-in check to notice. `page`/`searchQuery` are stripped
// first (tableViewSync.ts's stripTransientViewFields) — otherwise whatever's currently typed into
// the search box would silently ride along into the saved view the moment something else genuinely
// unsaved got Saved, even though the banner never counted it as part of the diff.
export function saveTableViewToServer(prefKey: string, currentValue: TableViewState): void {
  const updatedAt = Date.now();
  const value = stripTransientViewFields(currentValue);
  pushPrefToServer(prefKey, value, updatedAt);
  setBaseline(prefKey, { value, updatedAt });
}

// "Revert" discards the local view in favor of the baseline instead: live-patches the table
// directly via setViewState (no reload needed, unlike authStore.ts's adopt-and-reload for every
// other pref kind) and writes it locally through adoptPrefEntry, bypassing setPref so the
// reverted-to value isn't immediately treated as a fresh local edit. No baseline saved yet (a
// brand-new account, or a view never Saved) reverts to an empty view, same fallback
// restoreTableView's own stored-default path uses. The baseline never carries `page`/
// `searchQuery` (Save strips them before storing it) — symmetric with Save, Revert doesn't touch
// them either, so reverting your columns/sort/filters doesn't also reset whatever you're
// currently searching for or what page you're on.
export function revertTableViewToServer(table: ViewStateApi, prefKey: string): void {
  const baseline = getBaseline(prefKey);
  const value = (baseline?.value ?? {}) as TableViewState;
  table.setViewState(value);
  adoptPrefEntry(prefKey, value, baseline?.updatedAt ?? 0);
}
