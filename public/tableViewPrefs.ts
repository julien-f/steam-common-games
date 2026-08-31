// Shared "share/persist/reset a @vates/data-table-vanilla view via prefs.js + a one-shot URL
// param" logic — extracted verbatim from library.js's and bundles.js's own near-identical
// copies (see CLAUDE.md's Library Explorer / Bundles sections for the "share on demand, not
// live-synced" reasoning). Both pages call these the same way: a `table` instance, the prefs.js
// key that page's view is stored under, and the URL param name that page's "🔗 Share view"
// button writes to (`lv`/`wv` for library.js, `bv` for bundles.js).
import { getPref, setPref } from './prefs.ts';
import { reorderUrlParams } from './urlState.ts';

// The @vates/data-table-vanilla instance these operate on — only the view-state surface the
// page code actually uses, rather than importing the package's own (internal) types.
interface DataTableLike {
  setViewState(view: object): void;
  getViewState(): object;
  onViewChange(cb: (view: object) => void): () => void;
}

// An incoming param (from a shared/bookmarked link) always wins over the stored default, but
// only once: applies it, seeds it as the new stored default, then strips it from the live URL —
// otherwise a shared link would keep clobbering later edits on every table rebuild (a fresh
// search, an account refresh, a tab switch), not just the one it was meant to seed.
export function restoreTableView(table: DataTableLike, prefKey: string, paramName: string): void {
  const params = new URLSearchParams(location.search);
  const raw = params.get(paramName);
  if (raw) {
    try {
      const view = JSON.parse(raw);
      table.setViewState(view);
      setPref(prefKey, view);
      params.delete(paramName);
      history.replaceState(null, '', `?${reorderUrlParams(params)}`);
      return;
    } catch { /* malformed param — fall through to the stored default */ }
  }
  table.setViewState(getPref(prefKey, {}));
}

// Wires the table to auto-persist every future change under prefKey — the only ongoing side
// effect table interaction has; the URL stays untouched until explicitly shared. Returns the
// unsubscribe function (same shape onViewChange itself returns).
export function bindViewPersistence(table: DataTableLike, prefKey: string): () => void {
  return table.onViewChange(view => setPref(prefKey, view));
}

// Snapshots the table's current view into `paramName` and copies the resulting link to the
// clipboard — deliberately does NOT write it to the page's own address bar (no
// `history.replaceState`): a param left sitting in the visible URL goes stale the moment the
// user makes one more change to the table, silently showing a snapshot that no longer matches
// what's on screen. The stored pref (bindViewPersistence above) already captures live state on
// every change; this link is only for handing the *current* view to someone else.
export function shareTableView(table: DataTableLike, paramName: string, btn: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  params.set(paramName, JSON.stringify(table.getViewState()));
  const qs = reorderUrlParams(params).toString();
  const url = `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}`;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => flashShareViewBtn(btn), () => {});
}

function flashShareViewBtn(btn: HTMLElement): void {
  const prevText = btn.textContent;
  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.textContent = prevText; }, 1500);
}

// Clears both the stored default and whatever's currently in `paramName`, then blanks the
// table's view state — which resolves back to the table's own `initialViewState` (including
// its default sort) rather than to nothing, same as `restoreTableView`'s own fallback above.
export function resetTableView(table: DataTableLike, prefKey: string, paramName: string): void {
  table.setViewState({});
  setPref(prefKey, {});
  const params = new URLSearchParams(location.search);
  params.delete(paramName);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}
