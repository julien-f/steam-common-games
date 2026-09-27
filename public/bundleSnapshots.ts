// Last-known title and games of each bundle a saved list uses as a source. ITAD stops listing a
// bundle some time after it ends (GET /api/bundles/:id then 404s); this copy is what such a list
// keeps — listsStore.ts's orphanBundle turns it into a hidden manual list — and what names the
// source on screen without a fetch (listLabels.ts). Entries no list refers to are pruned by
// listsStore.ts's sweep. See docs/dev/lists-and-accounts.md.
import { getPref, setPref } from './prefs.ts';

const SNAPSHOTS_KEY = 'bundleSnapshots';

export interface BundleSnapshot {
  title: string;
  appids: number[];
  seenAt: number; // when this content was last seen changed — not every fetch, to avoid a write per resolve
}

function read(): Record<string, BundleSnapshot> {
  return getPref<Record<string, BundleSnapshot>>(SNAPSHOTS_KEY, {});
}

export function getBundleSnapshot(bundleId: string): BundleSnapshot | undefined {
  return read()[bundleId];
}

export function rememberBundle(bundleId: string, title: string, appids: Iterable<number>): void {
  const all = read();
  const sorted = [...new Set(appids)].sort((a, b) => a - b);
  const prev = all[bundleId];
  if (prev && prev.title === title && prev.appids.join() === sorted.join()) return;
  setPref(SNAPSHOTS_KEY, { ...all, [bundleId]: { title, appids: sorted, seenAt: Date.now() } });
}

// Drops every snapshot whose bundle isn't in `keep`; returns how many were dropped.
export function pruneBundleSnapshots(keep: Set<string>): number {
  const all = read();
  const kept = Object.fromEntries(Object.entries(all).filter(([id]) => keep.has(id)));
  const dropped = Object.keys(all).length - Object.keys(kept).length;
  if (dropped) setPref(SNAPSHOTS_KEY, kept);
  return dropped;
}
