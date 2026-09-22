// A table view's "unsaved changes" state against the account: a table-view key (see
// tableViewKeys.ts) is never auto-pushed to the server the way every other pref is (prefs.ts's
// setPref skips it) — editing a table locally is local-only until the user explicitly decides to
// Save or Revert, so switching accounts/devices/experimenting with a view never risks clobbering
// what's actually saved. This module is what tells "local differs from saved" apart from "nothing
// changed": a per-key `baseline`, this session's best-known copy of the server's own value,
// refreshed from `authStore.ts`'s `syncPrefsWithServer` on every sign-in check (not persisted to
// localStorage itself — a stale in-memory copy only matters for a few seconds until the next
// sync, and re-deriving it that way is simpler than a second synced-to-localStorage blob).
import { createSignal } from 'solid-js';
import type { PrefEntry } from './prefs.ts';
import type { TableViewState } from '@vates/data-table-solid';

const [baselines, setBaselines] = createSignal<Record<string, PrefEntry | undefined>>({});

// The server's currently-known entry for `key`, or undefined when the server has never saved it
// (a brand-new account, or a view never Saved yet) — treated the same as an empty view by
// isUnsaved/summarizeViewDiff below, so a first-time local customization shows as unsaved too.
export function getBaseline(key: string): PrefEntry | undefined {
  return baselines()[key];
}

export function setBaseline(key: string, entry: PrefEntry): void {
  setBaselines(prev => ({ ...prev, [key]: entry }));
}

export function clearBaseline(key: string): void {
  setBaselines(prev => (key in prev ? { ...prev, [key]: undefined } : prev));
}

// `page`/`searchQuery` are excluded from the diff/unsaved check below, and from what Save/Revert
// (tableViewPrefs.ts) actually write — pagination and an in-progress search aren't "a setting".
// Excluding them only from the diff wouldn't be enough on its own: Save pushes whatever
// `currentValue` it's given, so without this a still-typed search term would ride along into the
// saved view the moment something else genuinely unsaved got Saved, even though the banner never
// mentioned it.
const TRANSIENT_VIEW_FIELDS = ['page', 'searchQuery'] as const;

export function stripTransientViewFields(view: unknown): TableViewState {
  const v: TableViewState = { ...(view as TableViewState ?? {}) };
  for (const f of TRANSIENT_VIEW_FIELDS) delete v[f];
  return v;
}

// Every other TableViewState field, grouped under the label its "Save/Revert" banner shows — one
// entry can map several raw fields to the same label (filters/excludeFilters/filterModes/
// rangeFilters are all just "Filters" to a person reading the banner) without losing which of
// them actually changed for the JSON-diff below.
const FIELD_LABELS: readonly (readonly [keyof TableViewState, string])[] = [
  ['visibleCols', 'Columns'],
  ['columnOrder', 'Column order'],
  ['sorts', 'Sort'],
  ['filters', 'Filters'],
  ['excludeFilters', 'Filters'],
  ['filterModes', 'Filters'],
  ['rangeFilters', 'Filters'],
  ['groupBy', 'Grouping'],
  ['collapsedGroups', 'Grouping'],
  ['pageSize', 'Page size'],
];

// The labels (deduped, in FIELD_LABELS order) of whatever differs between `currentValue` and
// `key`'s baseline — what the unsaved-changes banner names, e.g. "Sort, Columns". Empty when
// there's nothing to save.
export function summarizeViewDiff(key: string, currentValue: unknown): string[] {
  const baseline = stripTransientViewFields(baselines()[key]?.value);
  const current = stripTransientViewFields(currentValue);
  const labels: string[] = [];
  for (const [field, label] of FIELD_LABELS) {
    if (JSON.stringify(current[field]) !== JSON.stringify(baseline[field]) && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

export function isUnsaved(key: string, currentValue: unknown): boolean {
  return summarizeViewDiff(key, currentValue).length > 0;
}

// Clears every baseline — called from authStore.ts's signOut() so a lingering baseline from the
// previous account can't leak into the next (either a different signed-in account, or back to
// signed-out, where there's no account to diff against at all). Also the test-only reset (see
// test/tableViewSync.test.js), same module-level-signal reset need _resetSignedInSteamid
// documents in prefs.ts.
export function resetBaselines(): void {
  setBaselines({});
}
