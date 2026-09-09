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
  const folders = readFolders().filter(f => f.parentId === parentId);
  const lists = readLists().filter(l => l.parentId === parentId && !l.deletedAt);
  const orders = [...folders.map(f => f.order), ...lists.map(l => l.order)];
  return orders.length ? Math.max(...orders) + 1 : 0;
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

export function getFolders(): Folder[] {
  return readFolders();
}

// Excludes soft-deleted lists by default — pass includeDeleted for a "Trash" view.
export function getLists({ includeDeleted = false }: { includeDeleted?: boolean } = {}): GameList[] {
  const lists = readLists();
  return includeDeleted ? lists : lists.filter(l => !l.deletedAt);
}

export function getFolder(id: string): Folder | undefined {
  return readFolders().find(f => f.id === id);
}

export function getList(id: string): GameList | undefined {
  return readLists().find(l => l.id === id);
}

// ── Cycle detection ──────────────────────────────────────────────────────────────────────────

function userListDeps(sources: ListRef[]): string[] {
  return sources.filter(s => s.kind === 'user' && s.listId).map(s => s.listId as string);
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
    const dep = lists.find(l => l.id === id);
    if (!dep || dep.kind !== 'dynamic' || !dep.sources) continue;
    stack.push(...userListDeps(dep.sources));
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
export function isDescendantFolder(candidateId: string, potentialAncestorId: string, folders: Folder[] = readFolders()): boolean {
  let current: Folder | undefined = folders.find(f => f.id === candidateId);
  while (current) {
    if (current.id === potentialAncestorId) return true;
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }
  return false;
}

// ── Referenced-by checks (soft-delete/restore) ──────────────────────────────────────────────

export function isListReferenced(listId: string, lists: GameList[] = readLists()): boolean {
  return lists.some(l => l.kind === 'dynamic' && !l.deletedAt
    && (l.sources ?? []).some(s => s.kind === 'user' && s.listId === listId));
}

export function isAccountReferenced(accountId: string, lists: GameList[] = readLists()): boolean {
  return lists.some(l => l.kind === 'dynamic' && !l.deletedAt
    && (l.sources ?? []).some(s => (s.kind === 'account-owned' || s.kind === 'account-wishlist') && s.accountId === accountId));
}

// ── Folder CRUD ──────────────────────────────────────────────────────────────────────────────

export function createFolder(name: string, parentId: string | null = null): Folder {
  const folder: Folder = { id: genId(), name, parentId, order: nextOrder(parentId), createdAt: Date.now() };
  writeFolders([...readFolders(), folder]);
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const folders = readFolders();
  const folder = folders.find(f => f.id === id);
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
  const folder = folders.find(f => f.id === id);
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
  const folder = folders.find(f => f.id === id);
  if (!folder) return;

  if (mode === 'promote') {
    const childFolders = folders.filter(f => f.parentId === id);
    childFolders.forEach(f => { f.parentId = folder.parentId; });
    writeFolders(folders.filter(f => f.id !== id));

    const lists = readLists();
    const childLists = lists.filter(l => l.parentId === id && !l.deletedAt);
    childLists.forEach(l => { l.parentId = folder.parentId; });
    writeLists(lists);
    return;
  }

  const childFolders = folders.filter(f => f.parentId === id);
  childFolders.forEach(f => deleteFolder(f.id, 'delete'));

  const childLists = readLists().filter(l => l.parentId === id && !l.deletedAt);
  childLists.forEach(l => deleteList(l.id));

  writeFolders(readFolders().filter(f => f.id !== id));
}

// Applies a new sibling order (folders and lists interleaved, sharing one numbering space per
// parentId — see the module comment) after a drag-and-drop or "Move to…" reorder. Every ref
// must already belong to `parentId`; this only rewrites `order`, not `parentId` itself.
export function reorderSiblings(parentId: string | null, orderedRefs: { kind: 'folder' | 'list'; id: string }[]): void {
  const folders = readFolders();
  const lists = readLists();
  orderedRefs.forEach((ref, index) => {
    if (ref.kind === 'folder') {
      const f = folders.find(x => x.id === ref.id && x.parentId === parentId);
      if (f) f.order = index;
    } else {
      const l = lists.find(x => x.id === ref.id && x.parentId === parentId);
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
  kind: 'manual' | 'dynamic';
  appids?: number[];
  op?: CombineOp;
  sources?: ListRef[];
}

export function createList(input: CreateListInput): GameList {
  const id = genId();
  const parentId = input.parentId ?? null;
  const lists = readLists();

  if (input.kind === 'dynamic' && wouldCreateCycle(id, input.sources ?? [], lists)) {
    throw new CycleError();
  }

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
  const list = lists.find(l => l.id === id);
  if (!list) return;
  if (name == null) delete list.name; else list.name = name;
  list.updatedAt = Date.now();
  writeLists(lists);
}

export function moveList(id: string, parentId: string | null): void {
  const lists = readLists();
  const list = lists.find(l => l.id === id);
  if (!list) return;
  list.parentId = parentId;
  list.order = nextOrder(parentId);
  list.updatedAt = Date.now();
  writeLists(lists);
}

// A manual list's own appids — no cycle concern, nothing to validate beyond existence.
export function setListAppids(id: string, appids: number[]): void {
  const lists = readLists();
  const list = lists.find(l => l.id === id);
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
  const list = readLists().find(l => l.id === id);
  if (!list || list.kind !== 'manual') return;
  setListAppids(id, [...union([new Set(list.appids), new Set(appids)])]);
}

export function removeAppidsFromList(id: string, appids: number[]): void {
  const list = readLists().find(l => l.id === id);
  if (!list || list.kind !== 'manual') return;
  setListAppids(id, [...subtract([new Set(list.appids), new Set(appids)])]);
}

// Edits a dynamic list's formula in place (same id/folder position) — the "Edit sources"
// action reopens the same setup dialog used at creation, pre-filled, and calls this to save.
export function updateDynamicList(id: string, op: CombineOp, sources: ListRef[]): GameList {
  const lists = readLists();
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1 || lists[idx].kind !== 'dynamic') throw new Error('Dynamic list not found');
  if (wouldCreateCycle(id, sources, lists)) throw new CycleError();
  const updated: GameList = { ...lists[idx], op, sources, updatedAt: Date.now() };
  lists[idx] = updated;
  writeLists(lists);
  return updated;
}

// One-way: converts a dynamic list to manual, given its currently-resolved appids (the caller
// resolves those via listResolve.ts before calling this — this module has no fetch/resolve
// logic of its own). Drops op/sources entirely.
//
// A caller freezing an *unnamed* dynamic list should stamp its derived name in (renameList with
// listDisplayName's result) as part of the same action: a manual list has no formula left to be
// labeled from, so it would otherwise read as "Untitled list".
export function freezeToSnapshot(id: string, appids: number[]): GameList {
  const lists = readLists();
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1) throw new Error('List not found');
  const { op: _op, sources: _sources, ...rest } = lists[idx];
  const updated: GameList = { ...rest, kind: 'manual', appids, updatedAt: Date.now() };
  lists[idx] = updated;
  writeLists(lists);
  return updated;
}

export function setListTableView(id: string, tableView: object): void {
  const lists = readLists();
  const list = lists.find(l => l.id === id);
  if (!list) return;
  list.tableView = tableView;
  writeLists(lists);
}

// Soft-deletes when something still references this list (a dynamic list's sources), hard-
// removes otherwise. Returns which happened so a caller can tell the user.
export function deleteList(id: string): { softDeleted: boolean } {
  const lists = readLists();
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1) return { softDeleted: false };
  if (isListReferenced(id, lists)) {
    lists[idx] = { ...lists[idx], deletedAt: Date.now() };
    writeLists(lists);
    return { softDeleted: true };
  }
  lists.splice(idx, 1);
  writeLists(lists);
  return { softDeleted: false };
}

export function restoreList(id: string): void {
  const lists = readLists();
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1 || !lists[idx].deletedAt) return;
  const { deletedAt: _deletedAt, ...rest } = lists[idx];
  lists[idx] = rest as GameList;
  writeLists(lists);
}

// Permanently purges any soft-deleted list no longer referenced by anything — call after any
// change that could have removed the last reference to a soft-deleted list (e.g. a dynamic
// list's sources being edited, or another soft-deleted list itself finally being purged).
export function sweepDeletedLists(): number {
  const lists = readLists();
  const kept = lists.filter(l => !l.deletedAt || isListReferenced(l.id, lists));
  if (kept.length !== lists.length) writeLists(kept);
  return lists.length - kept.length;
}
