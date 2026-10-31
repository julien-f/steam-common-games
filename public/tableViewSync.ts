// Comparing table views: what a stored layout leaves out (page, search) and which parts of two views
// differ, for the unsaved-changes banner (tableViewPrefs.ts's layoutDraft).
import type { TableViewState } from '@vates/data-table-solid';

// Pagination and an in-progress search aren't a setting: never stored, synced or diffed.
const TRANSIENT_VIEW_FIELDS = ['page', 'searchQuery'] as const;

export function stripTransientViewFields(view: unknown): TableViewState {
  const v: TableViewState = { ...((view as TableViewState) ?? {}) };
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

// The labels (deduped, in FIELD_LABELS order) of whatever differs between a stored layout and the current one,
// e.g. "Sort, Columns". Empty when there's nothing to save.
export function diffViewLabels(savedValue: unknown, currentValue: unknown): string[] {
  const saved = stripTransientViewFields(savedValue);
  const current = stripTransientViewFields(currentValue);
  const labels: string[] = [];
  for (const [field, label] of FIELD_LABELS) {
    if (JSON.stringify(current[field]) !== JSON.stringify(saved[field]) && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}
