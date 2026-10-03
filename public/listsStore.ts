// Folder/GameList CRUD — the user's organizable list tree (see docs/dev/lists-and-accounts.md).
// Flat arrays keyed by parentId, not a nested structure, so rename/move/reorder is a single-item
// mutation rather than a tree walk. Backed by prefs.ts's 'folders'/'lists' keys, same one-blob
// convention every other preference here uses.
//
// This module also owns the two structural-cycle guards the design doc calls for:
//   - a dynamic list's sources[] can't (even transitively) depend back on itself, checked at
//     save/edit time rather than left to break at resolve time (see wouldCreateCycle below);
//   - a folder can't be moved into its own descendant, the same class of bug in the parentId
//     tree instead of the list-reference graph (see isDescendantFolder below) — not called out
//     explicitly in the doc, but the same "never let a structural cycle get saved" principle.
//
// accountsStore.ts calls isAccountReferenced() from here (rather than duplicating this file's
// source-scanning logic) to decide whether removing a recent account must soft-remove instead.
import { getPref, setPref } from './prefs.ts';
import { union, subtract } from './combine.ts';
import { EMPTY_RANKING, type RankingState } from './ranking.ts';
import { getBundleSnapshot, pruneBundleSnapshots } from './bundleSnapshots.ts';
import type { Folder, GameList, ListRef, CombineOp } from './types.ts';

const LISTS_KEY = 'lists';
const FOLDERS_KEY = 'folders';

function genId(): string {
  return crypto.randomUUID();
}

function readLists(): GameList[] {
  return getPref<GameList[]>(LISTS_KEY, []);
}
function writeLists(lists: GameList[]): void {
  setPref(LISTS_KEY, lists);
}
function readFolders(): Folder[] {
  return getPref<Folder[]>(FOLDERS_KEY, []);
}
function writeFolders(folders: Folder[]): void {
  setPref(FOLDERS_KEY, folders);
}

function nextOrder(parentId: string | null): number {
  const folders = readFolders().filter((f) => f.parentId === parentId);
  const lists = readLists().filter((l) => l.parentId === parentId && !l.deletedAt);
  const orders = [...folders.map((f) => f.order), ...lists.map((l) => l.order)];
  return orders.length ? Math.max(...orders) + 1 : 0;
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

export function getFolders(): Folder[] {
  return readFolders();
}

// Every folder with its full path ("Weekend / Friday"), in tree order — for pickers like Home's
// "Move to…".
export function folderPaths(folders: Folder[] = readFolders()): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    for (const f of folders.filter((x) => x.parentId === parentId).sort((a, b) => a.order - b.order)) {
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ id: f.id, path });
      walk(f.id, path);
    }
  };
  walk(null, '');
  return out;
}

// Excludes soft-deleted lists by default — pass includeDeleted for a "Trash" view.
export function getLists({ includeDeleted = false }: { includeDeleted?: boolean } = {}): GameList[] {
  const lists = readLists();
  return includeDeleted ? lists : lists.filter((l) => !l.deletedAt);
}

export function getFolder(id: string): Folder | undefined {
  return readFolders().find((f) => f.id === id);
}

export function getList(id: string): GameList | undefined {
  return readLists().find((l) => l.id === id);
}

// What a list is computed from — a dynamic list's sources, a ranked list's one source.
export function listDeps(list: GameList): ListRef[] {
  if (list.kind === 'dynamic') return list.sources ?? [];
  if (list.kind === 'ranked') return list.source ? [list.source] : [];
  return [];
}

const sameRef = (a: ListRef, b: ListRef): boolean =>
  a.kind === b.kind && a.accountId === b.accountId && a.bundleId === b.bundleId && a.listId === b.listId;

// The ranked lists ordering this source — several can, each by its own criterion.
export function rankingsOf(source: ListRef): GameList[] {
  return getLists().filter((l) => l.kind === 'ranked' && !!l.source && sameRef(l.source, source));
}

// Whether a list is built, at any depth, from a source that has prices (a wishlist or a bundle).
export function listHasPriceSource(list: GameList, seen = new Set<string>()): boolean {
  if (seen.has(list.id)) return false;
  seen.add(list.id);
  return listDeps(list).some((ref) => {
    if (ref.kind === 'account-wishlist' || ref.kind === 'bundle') return true;
    const dep = ref.kind === 'user' && ref.listId ? getList(ref.listId) : undefined;
    return !!dep && listHasPriceSource(dep, seen);
  });
}

// ── Cycle detection ──────────────────────────────────────────────────────────────────────────

function userListDeps(sources: ListRef[]): string[] {
  return sources.filter((s) => s.kind === 'user' && s.listId).map((s) => s.listId as string);
}

// Would giving `listId` these `sources` create a cycle (direct or transitive) in the
// user-list dependency graph? Walks the *proposed* sources for `listId` itself, then each
// other list's *currently stored* sources — so this also catches a cycle introduced by
// editing some other list further down the chain, not just a fresh self-reference.
export function wouldCreateCycle(listId: string, sources: ListRef[], lists: GameList[] = readLists()): boolean {
  const visited = new Set<string>();
  const stack = [...userListDeps(sources)];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === listId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const dep = lists.find((l) => l.id === id);
    if (!dep) continue;
    stack.push(...userListDeps(listDeps(dep)));
  }
  return false;
}

export class CycleError extends Error {
  constructor() {
    super('This would create a cycle between lists');
    this.name = 'CycleError';
  }
}

// Is a folder `candidateId` at or below `potentialAncestorId` in the parentId tree?
export function isDescendantFolder(
  candidateId: string,
  potentialAncestorId: string,
  folders: Folder[] = readFolders(),
): boolean {
  let current: Folder | undefined = folders.find((f) => f.id === candidateId);
  while (current) {
    if (current.id === potentialAncestorId) return true;
    current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined;
  }
  return false;
}

// ── Referenced-by checks (soft-delete/restore) ──────────────────────────────────────────────

export function isListReferenced(listId: string, lists: GameList[] = readLists()): boolean {
  return lists.some((l) => !l.deletedAt && listDeps(l).some((s) => s.kind === 'user' && s.listId === listId));
}

// Any list, soft-deleted ones included: they're kept only while resolvable, so they resolve too.
export function isBundleReferenced(bundleId: string, lists: GameList[] = readLists()): boolean {
  return lists.some((l) => listDeps(l).some((s) => s.kind === 'bundle' && s.bundleId === bundleId));
}

export function isAccountReferenced(accountId: string, lists: GameList[] = readLists()): boolean {
  return lists.some(
    (l) =>
      !l.deletedAt &&
      listDeps(l).some(
        (s) => (s.kind === 'account-owned' || s.kind === 'account-wishlist') && s.accountId === accountId,
      ),
  );
}

// ── Folder CRUD ──────────────────────────────────────────────────────────────────────────────

export function createFolder(name: string, parentId: string | null = null): Folder {
  const folder: Folder = { id: genId(), name, parentId, order: nextOrder(parentId), createdAt: Date.now() };
  writeFolders([...readFolders(), folder]);
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const folders = readFolders();
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  folder.name = name;
  writeFolders(folders);
}

export function moveFolder(id: string, parentId: string | null): void {
  if (parentId === id) throw new Error('Cannot move a folder into itself');
  const folders = readFolders();
  if (parentId != null && isDescendantFolder(parentId, id, folders)) {
    throw new Error('Cannot move a folder into its own descendant');
  }
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  folder.parentId = parentId;
  folder.order = nextOrder(parentId);
  writeFolders(folders);
}

// Deletes a folder, resolving its contents per `mode`: 'promote' moves every direct child
// (folders and lists alike) up to the deleted folder's own parent; 'delete' recursively
// deletes child folders and applies deleteList's own soft-delete rule to child lists — never
// an unconditional wipe of something still referenced elsewhere.
export function deleteFolder(id: string, mode: 'promote' | 'delete'): void {
  const folders = readFolders();
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;

  if (mode === 'promote') {
    const childFolders = folders.filter((f) => f.parentId === id);
    childFolders.forEach((f) => {
      f.parentId = folder.parentId;
    });
    writeFolders(folders.filter((f) => f.id !== id));

    const lists = readLists();
    const childLists = lists.filter((l) => l.parentId === id && !l.deletedAt);
    childLists.forEach((l) => {
      l.parentId = folder.parentId;
    });
    writeLists(lists);
    return;
  }

  const childFolders = folders.filter((f) => f.parentId === id);
  childFolders.forEach((f) => deleteFolder(f.id, 'delete'));

  const childLists = readLists().filter((l) => l.parentId === id && !l.deletedAt);
  childLists.forEach((l) => deleteList(l.id));

  writeFolders(readFolders().filter((f) => f.id !== id));
}

// Applies a new sibling order (folders and lists interleaved, sharing one numbering space per
// parentId — see the module comment) after a drag-and-drop or "Move to…" reorder. Every ref
// must already belong to `parentId`; this only rewrites `order`, not `parentId` itself.
export function reorderSiblings(parentId: string | null, orderedRefs: { kind: 'folder' | 'list'; id: string }[]): void {
  const folders = readFolders();
  const lists = readLists();
  orderedRefs.forEach((ref, index) => {
    if (ref.kind === 'folder') {
      const f = folders.find((x) => x.id === ref.id && x.parentId === parentId);
      if (f) f.order = index;
    } else {
      const l = lists.find((x) => x.id === ref.id && x.parentId === parentId);
      if (l) l.order = index;
    }
  });
  writeFolders(folders);
  writeLists(lists);
}

// ── List CRUD ────────────────────────────────────────────────────────────────────────────────

export interface CreateListInput {
  name?: string; // omitted on a dynamic list = unnamed, labeled from its formula (listLabels.ts)
  parentId?: string | null;
  kind: 'manual' | 'dynamic' | 'ranked';
  appids?: number[];
  op?: CombineOp;
  sources?: ListRef[];
  source?: ListRef;
}

export function createList(input: CreateListInput): GameList {
  const id = genId();
  const parentId = input.parentId ?? null;
  const lists = readLists();

  const deps =
    input.kind === 'dynamic' ? (input.sources ?? []) : input.kind === 'ranked' && input.source ? [input.source] : [];
  if (wouldCreateCycle(id, deps, lists)) throw new CycleError();

  const now = Date.now();
  const list: GameList = {
    id,
    name: input.name,
    parentId,
    order: nextOrder(parentId),
    createdAt: now,
    updatedAt: now,
    kind: input.kind,
    ...(input.kind === 'manual'
      ? { appids: input.appids ?? [] }
      : input.kind === 'ranked'
        ? { source: input.source }
        : { op: input.op ?? 'union', sources: input.sources ?? [] }),
  };
  writeLists([...lists, list]);
  return list;
}

// `undefined` clears the name — a dynamic list falls back to being labeled by its own formula
// (listLabels.ts's listDisplayName). Stored as a deleted key rather than an explicit undefined,
// which JSON wouldn't keep anyway.
export function renameList(id: string, name: string | undefined): void {
  const lists = readLists();
  const list = lists.find((l) => l.id === id);
  if (!list) return;
  if (name == null) delete list.name;
  else list.name = name;
  list.updatedAt = Date.now();
  writeLists(lists);
}

export function moveList(id: string, parentId: string | null): void {
  const lists = readLists();
  const list = lists.find((l) => l.id === id);
  if (!list) return;
  list.parentId = parentId;
  list.order = nextOrder(parentId);
  list.updatedAt = Date.now();
  writeLists(lists);
}

// A manual list's own appids — no cycle concern, nothing to validate beyond existence.
export function setListAppids(id: string, appids: number[]): void {
  const lists = readLists();
  const list = lists.find((l) => l.id === id);
  if (!list || list.kind !== 'manual') return;
  list.appids = appids;
  list.updatedAt = Date.now();
  writeLists(lists);
}

// Row-selection-based add/remove (ListRoute.tsx) — thin wrappers over setListAppids built on
// the same set arithmetic (combine.ts's union/subtract) a dynamic list's own resolve uses, just
// applied to a manual list's stored array instead of a live combine. Same no-op-if-missing-or-
// not-manual guard as setListAppids (redundant with its own check, but avoids reading `.appids`
// off a dynamic list, which doesn't have one).
export function addAppidsToList(id: string, appids: number[]): void {
  const list = readLists().find((l) => l.id === id);
  if (!list || list.kind !== 'manual') return;
  setListAppids(id, [...union([new Set(list.appids), new Set(appids)])]);
}

export function removeAppidsFromList(id: string, appids: number[]): void {
  const list = readLists().find((l) => l.id === id);
  if (!list || list.kind !== 'manual') return;
  setListAppids(id, [...subtract([new Set(list.appids), new Set(appids)])]);
}

// Edits a dynamic list's formula in place (same id/folder position) — the "Edit sources"
// action reopens the same setup dialog used at creation, pre-filled, and calls this to save.
export function updateDynamicList(id: string, op: CombineOp, sources: ListRef[]): GameList {
  const lists = readLists();
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1 || lists[idx].kind !== 'dynamic') throw new Error('Dynamic list not found');
  if (wouldCreateCycle(id, sources, lists)) throw new CycleError();
  const updated: GameList = { ...lists[idx], op, sources, updatedAt: Date.now() };
  lists[idx] = updated;
  writeLists(lists);
  sweepDeletedLists();
  return updated;
}

// Changes a ranked list's source in place; its ranking is kept, filtered to the new source at
// read time (ranking.ts), so switching back restores it.
export function updateRankedSource(id: string, source: ListRef): GameList {
  const lists = readLists();
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1 || lists[idx].kind !== 'ranked') throw new Error('Ranked list not found');
  if (wouldCreateCycle(id, [source], lists)) throw new CycleError();
  const updated: GameList = { ...lists[idx], source, updatedAt: Date.now() };
  lists[idx] = updated;
  writeLists(lists);
  sweepDeletedLists();
  return updated;
}

// A ranked list's progress, in its own pref key rather than on the list: it's written once per
// answer, and keeping it out of `lists` means neither those writes nor their (debounced, see
// prefs.ts) server pushes touch any other list.
function rankingKey(listId: string): string {
  return `ranking:${listId}`;
}

export function getRanking(listId: string): RankingState {
  return getPref<RankingState | null>(rankingKey(listId), null) ?? EMPTY_RANKING;
}

export function setRanking(listId: string, state: RankingState): void {
  setPref(rankingKey(listId), state);
}

// null rather than a delete: prefs has no key removal, and null syncs to other devices too.
function dropRanking(listId: string): void {
  if (getPref(rankingKey(listId)) != null) setPref(rankingKey(listId), null);
}

export function setListTableView(id: string, tableView: object): void {
  const lists = readLists();
  const list = lists.find((l) => l.id === id);
  if (!list) return;
  list.tableView = tableView;
  writeLists(lists);
}

// Soft-deletes when something still references this list (a dynamic list's sources), hard-
// removes otherwise. Returns which happened so a caller can tell the user.
export function deleteList(id: string): { softDeleted: boolean } {
  const lists = readLists();
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1) return { softDeleted: false };
  if (isListReferenced(id, lists)) {
    lists[idx] = { ...lists[idx], deletedAt: Date.now() };
    writeLists(lists);
    return { softDeleted: true };
  }
  const [removed] = lists.splice(idx, 1);
  writeLists(lists);
  if (removed.kind === 'ranked') dropRanking(id);
  sweepDeletedLists(); // it may have been the last reference to a soft-deleted list
  return { softDeleted: false };
}

export function restoreList(id: string): void {
  const lists = readLists();
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1 || !lists[idx].deletedAt) return;
  const { deletedAt: _deletedAt, ...rest } = lists[idx];
  lists[idx] = rest as GameList;
  writeLists(lists);
}

// Permanently purges any soft-deleted list no longer referenced by anything — call after any
// change that could have removed the last reference to a soft-deleted list (e.g. a dynamic
// list's sources being edited, or another soft-deleted list itself finally being purged).
// Repeats until stable (a purged list may have been the last reference to another), then drops
// the bundle snapshots nothing refers to any more.
export function sweepDeletedLists(): number {
  const lists = readLists();
  let kept = lists;
  for (;;) {
    const next = kept.filter((l) => !l.deletedAt || isListReferenced(l.id, kept));
    if (next.length === kept.length) break;
    kept = next;
  }
  if (kept.length !== lists.length) writeLists(kept);
  for (const l of lists) if (l.kind === 'ranked' && !kept.includes(l)) dropRanking(l.id);
  const bundles = new Set(
    kept.flatMap((l) => listDeps(l).flatMap((s) => (s.kind === 'bundle' && s.bundleId ? [s.bundleId] : []))),
  );
  pruneBundleSnapshots(bundles);
  return lists.length - kept.length;
}

// For when ITAD no longer lists a bundle some saved list uses (GET /api/bundles/:id 404s): its
// last-known games become a hidden (soft-deleted) manual list that every such source is re-pointed
// at, so those lists keep their contents; the sweep purges it once nothing refers to it. Returns
// it, or nothing when there's no snapshot to keep or no list using the bundle.
export function orphanBundle(bundleId: string): GameList | undefined {
  const snapshot = getBundleSnapshot(bundleId);
  const lists = readLists();
  if (!snapshot || !isBundleReferenced(bundleId, lists)) return undefined;
  const now = Date.now();
  const orphan: GameList = {
    id: genId(),
    name: `${snapshot.title} (no longer listed)`,
    parentId: null,
    order: nextOrder(null),
    createdAt: now,
    updatedAt: now,
    kind: 'manual',
    appids: snapshot.appids,
    orphanOf: { bundleId },
    deletedAt: now,
  };
  const repoint = (ref: ListRef): ListRef =>
    ref.kind === 'bundle' && ref.bundleId === bundleId ? { kind: 'user', listId: orphan.id } : ref;
  // updatedAt left alone: the list's contents didn't change, only where they're read from.
  const rewritten = lists.map((l) =>
    l.kind === 'dynamic'
      ? { ...l, sources: (l.sources ?? []).map(repoint) }
      : l.kind === 'ranked' && l.source
        ? { ...l, source: repoint(l.source) }
        : l,
  );
  writeLists([...rewritten, orphan]);
  sweepDeletedLists();
  return orphan;
}
