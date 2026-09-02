// Shared appid-indexed row bookkeeping behind a page's table store — extracted from
// app.tsx/bundles.tsx/library.tsx, which each carried an identical hand-copy of this (see
// CLAUDE.md's Architecture section on the Solid-store row-shape all three pages share).
//
// `rowIndex` (appid -> array index into the page's own Solid store array) is the O(1) lookup
// `mutateRow` needs; `panelRows` is a deliberately plain, never-store-linked `Map<number, T>` —
// panel.tsx's own lazy loaders (news/DLC/price) mutate whatever `Game` object they're given via
// plain `game.field = x` writes, which a Solid store blocks outright (confirmed live on all
// three pages), so the panel is only ever handed this plain copy, never the store's own proxy.
// `mutateRow` updates both from the same mutate function so they never drift; `getRow` is the
// one place every page resolves an appid back to the object the panel/lightbox are allowed to
// see.
import { produce } from 'solid-js/store';

export interface RowStore<T> {
  // How many rows are currently loaded — `rowIndex`/`panelRows` themselves aren't part of this
  // public interface (see `createRowStore` below): each is swapped out for a whole new `Map`
  // instance on every `reset()`/`load()`, so a caller that read either field once and held onto
  // that reference across a later `reset()`/`load()` would silently keep operating on a stale,
  // orphaned `Map` with no compile-time signal — this and the other methods below are the only
  // way to observe/mutate the current one.
  size(): number;
  getRow(appid: number): T | undefined;
  // Mutates the row at `appid` via `produce(fn)` against the store copy (table reactivity) and
  // a plain call against the panel copy (panel.tsx compatibility) — returns the panel copy, or
  // `undefined` if `appid` isn't part of the currently loaded rows (e.g. a DLC/base-game link or
  // a standalone "look up any game" lookup, which was never added to either map — callers fall
  // back to mutating a plain object directly in that case, same as before this was extracted).
  mutateRow(appid: number, fn: (draft: T) => void): T | undefined;
  // Clears both maps back to empty — a fresh search/tab-switch/bundle-open with nothing loaded
  // (yet).
  reset(): void;
  // Rebuilds both maps from a freshly-fetched row list — `panelRows` is populated from a
  // separate, deliberately-cloned plain object per row (not the same references handed to the
  // store setter), same reasoning `reset`'s own doc comment above gives for keeping the two maps
  // apart at all.
  load(rows: readonly T[]): void;
}

export function createRowStore<T extends { appid: number }>(
  // The page's own store setter, called exactly as each page used to call it directly:
  // `setGames(idx, produce(fn))` (app.tsx) / `setRowsStore(idx, produce(fn))`
  // (bundles.tsx/library.tsx) — `produce(fn)`'s return type is what this accepts.
  setStore: (idx: number, updater: ReturnType<typeof produce<T>>) => void,
): RowStore<T> {
  // Private to this closure, not exposed on the returned object — see `RowStore.size`'s own doc
  // comment above for why a caller reading these directly could end up holding a stale `Map`
  // across a `reset()`/`load()`.
  let rowIndex = new Map<number, number>();
  let panelRows = new Map<number, T>();
  return {
    size() {
      return rowIndex.size;
    },
    getRow(appid) {
      return panelRows.get(appid);
    },
    mutateRow(appid, fn) {
      const idx = rowIndex.get(appid);
      if (idx === undefined) return undefined;
      setStore(idx, produce(fn));
      const panelRow = panelRows.get(appid);
      if (panelRow) fn(panelRow);
      return panelRow;
    },
    reset() {
      rowIndex = new Map();
      panelRows = new Map();
    },
    load(rows) {
      // A duplicate appid isn't deduped here — that's each caller's own job (e.g. bundles.tsx's
      // own `seenAppids`, which has the context to pick which duplicate to keep, such as the
      // cheapest tier), and a `Map` built from a list with a repeated key silently keeps only
      // the *last* occurrence anyway, so a caller that got this wrong would otherwise fail
      // silently: the earlier row's array slot is never reachable via `rowIndex` again, so
      // `mutateRow` can never clear whatever `loading`/placeholder state it started in — it just
      // sits in the store forever, filtered out of most callers' own "hide still-loading rows"
      // view with no error anywhere. This warns instead, so a violation is visible rather than
      // quietly masked twice (once by whatever bug produced the duplicate, once by this module
      // silently accepting it).
      const seen = new Set<number>();
      const dupes = new Set<number>();
      for (const r of rows) {
        if (seen.has(r.appid)) dupes.add(r.appid);
        else seen.add(r.appid);
      }
      if (dupes.size > 0) {
        console.warn(`[rowStore] load() received duplicate appid(s): ${[...dupes].join(', ')} — only each one's last occurrence will be reachable; dedupe before calling load().`);
      }
      rowIndex = new Map(rows.map((r, i) => [r.appid, i]));
      panelRows = new Map(rows.map(r => [r.appid, { ...r }]));
    },
  };
}
