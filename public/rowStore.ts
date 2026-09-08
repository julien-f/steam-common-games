// Shared appid-indexed row bookkeeping behind a route's table store — `rowIndex` (appid → array
// index into the route's own Solid store array) is the O(1) lookup `getRow`/`mutateRow` need,
// since a store array is otherwise only addressable by index.
//
// Every read and write of a row goes through here, and the store is the single source of truth
// for row data: `getRow` hands back the store's own row (a Solid store proxy, so whoever renders
// it re-renders per field, on its own), and `mutateRow` is the only way to change one. This
// replaced a shape where each route also kept a second, deliberately plain `panelRows` map — one
// shallow clone per row — purely because panel.tsx's own loaders mutated whatever `Game` object
// they were handed via plain `game.field = x` writes, which a store proxy rejects outright. Those
// loaders are `createResource`s now (see panelData.ts) and write to no row at all, so the panel
// takes the real store row, the two-copies-kept-in-sync bookkeeping is gone, and a field written
// here reaches the panel with no "please re-render" bump in between. See CLAUDE.md's "Frontend
// reactivity" section.
import { produce } from 'solid-js/store';

export interface RowStore<T> {
  // How many rows are currently loaded — `rowIndex` itself isn't part of this public interface
  // (see `createRowStore` below): it's swapped out for a whole new `Map` instance on every
  // `reset()`/`load()`, so a caller that read the field once and held onto that reference would
  // silently keep operating on a stale, orphaned `Map` with no compile-time signal — this and the
  // other methods below are the only way to observe/mutate the current one.
  size(): number;
  // The store's own row for `appid`, or `undefined` if it isn't one of the currently loaded rows.
  // A store proxy: reading a field of it inside a tracked scope subscribes to that one field.
  // Handed out as `Readonly<T>` — a store row can only be written through `mutateRow` below
  // (Solid rejects a direct write outright, so an unguarded `row.field = x` would otherwise be a
  // runtime error at best and a silent no-op at worst).
  getRow(appid: number): Readonly<T> | undefined;
  // Mutates the row at `appid` via `produce(fn)` and returns it — `undefined` (mutating nothing)
  // if `appid` isn't one of the currently loaded rows, e.g. a DLC/base-game link or a standalone
  // "look up any game" lookup, which was never added to this store at all. Callers that can be
  // handed such a game check for that and write to wherever it does live instead.
  mutateRow(appid: number, fn: (draft: T) => void): Readonly<T> | undefined;
  // Clears the index back to empty — a fresh search/tab-switch/bundle-open with nothing loaded
  // (yet).
  reset(): void;
  // Rebuilds the index from a freshly-fetched row list, which must be the same list just handed
  // to the store itself.
  load(rows: readonly T[]): void;
}

export function createRowStore<T extends { appid: number }>(
  // The route's own store array and its setter, as returned by `createStore<T[]>` — the array is
  // read for `getRow`/`mutateRow`'s return value, the setter is called exactly as each route used
  // to call it directly: `setRows(idx, produce(fn))`.
  store: readonly T[],
  setStore: (idx: number, updater: ReturnType<typeof produce<T>>) => void,
): RowStore<T> {
  // Private to this closure, not exposed on the returned object — see `RowStore.size`'s own doc
  // comment above for why a caller reading this directly could end up holding a stale `Map`
  // across a `reset()`/`load()`.
  let rowIndex = new Map<number, number>();
  return {
    size() {
      return rowIndex.size;
    },
    getRow(appid) {
      const idx = rowIndex.get(appid);
      return idx === undefined ? undefined : store[idx];
    },
    mutateRow(appid, fn) {
      const idx = rowIndex.get(appid);
      if (idx === undefined) return undefined;
      setStore(idx, produce(fn));
      return store[idx];
    },
    reset() {
      rowIndex = new Map();
    },
    load(rows) {
      // A duplicate appid isn't deduped here — that's each caller's own job (e.g. bundleRows.ts's
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
    },
  };
}
