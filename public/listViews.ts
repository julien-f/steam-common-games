// Named table views of Owned/Wishlist, opened as `?view=<id>`; written only by explicit actions
// (create, Save, rename, delete), never a table edit, so it syncs like any pref.
import type { TableViewState } from '@vates/data-table-solid';
import { getPref, setPref } from './prefs.ts';
import { stripTransientViewFields } from './tableViewSync.ts';
import type { SavedView } from './types.ts';
import { DEAL_RECORD_TIERS } from './utils.ts';
import { STATUS_LABELS } from './gameStatuses.ts';

export type ViewKind = 'owned' | 'wishlist';
type ListViews = Partial<Record<ViewKind, SavedView[]>>;

export const LIST_VIEWS_KEY = 'listViews';

function read(): ListViews {
  const views = getPref<ListViews>(LIST_VIEWS_KEY, {});
  return { ...views, owned: views.owned?.map(withStatusExclusion) };
}
function write(kind: ViewKind, views: SavedView[]): void {
  setPref(LIST_VIEWS_KEY, { ...read(), [kind]: views });
}

export function getListViews(kind: ViewKind): SavedView[] {
  return read()[kind] ?? [];
}

export function getListView(kind: ViewKind, id: string): SavedView | undefined {
  return getListViews(kind).find((v) => v.id === id);
}

export function createListView(kind: ViewKind, name: string, tableView: TableViewState, template?: string): SavedView {
  const view: SavedView = {
    id: crypto.randomUUID(),
    name,
    tableView: stripTransientViewFields(tableView),
    ...(template ? { template } : {}),
  };
  write(kind, [...getListViews(kind), view]);
  return view;
}

function update(kind: ViewKind, id: string, patch: Partial<SavedView>): void {
  write(
    kind,
    getListViews(kind).map((v) => (v.id === id ? { ...v, ...patch } : v)),
  );
}

export function renameListView(kind: ViewKind, id: string, name: string): void {
  update(kind, id, { name });
}

export function saveListViewTable(kind: ViewKind, id: string, tableView: TableViewState): void {
  update(kind, id, { tableView: stripTransientViewFields(tableView) });
}

export function deleteListView(kind: ViewKind, id: string): void {
  write(
    kind,
    getListViews(kind).filter((v) => v.id !== id),
  );
}

// Play next's bound, shared with Owned's profile-line count that opens it.
export const PLAY_NEXT_MAX_HOURS = 2;

// Suggested views, stamped into a SavedView at creation; `cols` are its visible columns in display order. No price
// column without `needsPrices`, nor a sort or column set equal to the list's default: either reads back as unsaved.
export interface ViewTemplate {
  id: string;
  kind: ViewKind;
  name: string;
  view: TableViewState;
  cols: string[];
  needsPrices?: boolean;
}

// Barely played isn't unplayed: a game finished elsewhere or dropped early isn't one to play next.
const NOT_DONE = { status: [STATUS_LABELS.finished, STATUS_LABELS.abandoned] };

// Price Status at a 1-year low or better.
const BARGAIN_STATUSES = DEAL_RECORD_TIERS.filter((t) => t.tier !== '3mo').map((t) => t.statusLabel);

export const VIEW_TEMPLATES: readonly ViewTemplate[] = [
  {
    id: 'recently-played',
    kind: 'owned',
    name: 'Recently played',
    // No filter: Last Played sorts never-played games last.
    view: { sorts: [{ key: 'lastPlayed', dir: 'desc' }] },
    cols: ['capsule', 'name', 'lastPlayed', 'playtime', 'hltbAll', 'steamdbRating'],
  },
  {
    id: 'play-next',
    kind: 'owned',
    name: 'Play next',
    view: {
      rangeFilters: { playtime: { min: '', max: String(PLAY_NEXT_MAX_HOURS) } },
      excludeFilters: NOT_DONE,
      sorts: [{ key: 'tasteFit', dir: 'desc' }],
    },
    cols: ['capsule', 'name', 'tasteFit', 'steamdbRating', 'hltbAll', 'playtime', 'genres', 'status'],
  },
  {
    id: 'short-games',
    kind: 'owned',
    name: 'Short games',
    view: {
      rangeFilters: {
        playtime: { min: '', max: String(PLAY_NEXT_MAX_HOURS) },
        // Keeps out games with no HLTB entry, which the range filter reads as 0 until
        // https://github.com/vatesfr/data-table/issues/47 is fixed.
        hltbMain: { min: '0.1', max: '5' },
      },
      excludeFilters: NOT_DONE,
      // No sort: Owned's default, best rated first.
    },
    cols: ['capsule', 'name', 'hltbMain', 'steamdbRating', 'tasteFit', 'playtime', 'genres', 'status'],
  },
  {
    id: 'bargains',
    kind: 'wishlist',
    name: 'Bargains',
    view: { filters: { priceStatus: BARGAIN_STATUSES }, sorts: [{ key: 'bestDealCut', dir: 'desc' }] },
    cols: [
      'capsule',
      'name',
      'priceStatus',
      'bestDealCut',
      'bestDealPrice',
      'tasteFit',
      'steamdbRating',
      'hltbAll',
      'hasDemo',
    ],
    needsPrices: true,
  },
];

// The templates offered on `kind`: those not already created (a renamed one still counts).
export function suggestedTemplates(kind: ViewKind, pricesShown: boolean): ViewTemplate[] {
  const created = new Set(getListViews(kind).map((v) => v.template));
  return VIEW_TEMPLATES.filter((t) => t.kind === kind && !created.has(t.id) && (pricesShown || !t.needsPrices));
}

// The view created from `templateId`, renamed or edited since or not.
export function templateView(kind: ViewKind, templateId: string): SavedView | undefined {
  return getListViews(kind).find((v) => v.template === templateId);
}

// `visibleCols` is a set: the order comes from `columnOrder`.
const stamp = ({ view, cols }: Pick<ViewTemplate, 'view' | 'cols'>) =>
  stripTransientViewFields({ ...view, visibleCols: cols, columnOrder: cols });

export function createFromTemplate(template: ViewTemplate): SavedView {
  return createListView(template.kind, template.name, stamp(template), template.id);
}

// A view created before statuses existed, never edited since, gets their exclusion; an edited one is left as it is.
// Remove once no stored view predates it.
function withStatusExclusion(saved: SavedView): SavedView {
  const template = VIEW_TEMPLATES.find((t) => t.id === saved.template && t.view.excludeFilters === NOT_DONE);
  if (!template) return saved;
  const { excludeFilters: _added, ...view } = template.view;
  const before = stamp({ view, cols: template.cols.filter((c) => c !== 'status') });
  return JSON.stringify(saved.tableView) === JSON.stringify(before) ? { ...saved, tableView: stamp(template) } : saved;
}
