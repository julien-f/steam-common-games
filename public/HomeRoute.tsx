// Home — account picker/header and the folder/list tree (see docs/list-centric-redesign.md and
// the implementation plan's Phase 5 step 8), the last of the core routes. `accountsStore.ts`/
// `listsStore.ts` are both plain modules with no Solid reactivity of their own — every mutation
// here goes through their exported functions and then explicitly re-reads them into a local
// signal (`refreshAccounts`/`refreshTree`), the same "mutate, then explicitly notify" pattern
// panel.tsx's own `revision` signal uses for plain-object mutation it can't observe directly.
//
// **Current scope, deliberately trimmed for a first pass**: folder/list reorganizing (rename/
// move/delete) uses plain `window.prompt`/`window.confirm` dialogs rather than a polished drag-
// and-drop tree UI — real functionality (backed by the fully-built `listsStore.ts`), minimal
// chrome. No trash/restore UI for soft-deleted lists yet (`listsStore.ts`'s `restoreList`/
// `getLists({ includeDeleted: true })` are ready for it, just not surfaced here). The combine
// form below can pick any recent account's Owned/Wishlist, Recently Looked Up, or any existing
// user list as a source — bundles are deliberately not offered as a source yet (would need its
// own bundle-picker UI, not just a checkbox).
import { createSignal, createEffect, createMemo, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  getMyAccount, setMyAccount, getCurrentAccount, setCurrentAccount,
  getRecentAccounts, removeRecentAccount, clearRecentAccounts,
} from './accountsStore.ts';
import { resolveAccountSummary, fetchAccountOwnedGames, fetchAccountWishlistItems } from './accountData.ts';
import {
  getFolders, getLists, createFolder, createList, renameFolder, renameList,
  deleteFolder, deleteList,
} from './listsStore.ts';
import type { AccountSlot, Folder, GameList, ListRef, CombineOp } from './types.ts';

interface SourceOption {
  key: string;
  label: string;
  ref: ListRef;
}

const COMBINE_OPS: { value: CombineOp; label: string }[] = [
  { value: 'union', label: 'Union (games in any source)' },
  { value: 'intersect', label: 'Intersect (games in every source)' },
  { value: 'subtract', label: 'Subtract (first source minus the rest)' },
  { value: 'group-by-membership', label: 'Group by membership (one table per combination)' },
];

interface TreeRow {
  type: 'folder' | 'list';
  item: Folder | GameList;
  depth: number;
}

export default function HomeRoute() {
  const [myAccount, setMyAccountSig] = createSignal<AccountSlot | null>(getMyAccount());
  const [currentAccount, setCurrentAccountSig] = createSignal<AccountSlot | null>(getCurrentAccount());
  const [recents, setRecentsSig] = createSignal<AccountSlot[]>(getRecentAccounts());
  const [resolveInputs, setResolveInputs] = createSignal<string[]>(['']);
  const [resolveError, setResolveError] = createSignal('');
  const [resolving, setResolving] = createSignal(false);
  const [counts, setCounts] = createSignal<{ owned: number | null; wishlist: number | null }>({ owned: null, wishlist: null });

  const [folders, setFoldersSig] = createSignal<Folder[]>(getFolders());
  const [lists, setListsSig] = createSignal<GameList[]>(getLists());

  function refreshAccounts(): void {
    setMyAccountSig(getMyAccount());
    setCurrentAccountSig(getCurrentAccount());
    setRecentsSig(getRecentAccounts());
  }
  function refreshTree(): void {
    setFoldersSig(getFolders());
    setListsSig(getLists());
  }

  // Counts aren't stored on AccountSlot itself (they'd go stale) — refetched live whenever
  // currentAccount changes, including on initial mount for whatever was already stored.
  createEffect(() => {
    const account = currentAccount();
    if (!account) { setCounts({ owned: null, wishlist: null }); return; }
    setCounts({ owned: null, wishlist: null });
    const members = account.members;
    fetchAccountOwnedGames(members).then(g => setCounts(c => ({ ...c, owned: g.length })), () => setCounts(c => ({ ...c, owned: 0 })));
    fetchAccountWishlistItems(members).then(items => setCounts(c => ({ ...c, wishlist: items.length })), () => setCounts(c => ({ ...c, wishlist: 0 })));
  });

  async function resolveAndSetCurrent(): Promise<void> {
    const trimmed = resolveInputs().map(s => s.trim()).filter(Boolean);
    if (trimmed.length === 0) return;
    setResolving(true);
    setResolveError('');
    try {
      const summary = await resolveAccountSummary(trimmed);
      const account: AccountSlot = {
        id: [...summary.members].sort().join('+'),
        members: summary.members,
        rawInputs: trimmed,
        label: summary.label,
        avatarUrl: summary.avatarUrl ?? undefined,
        lastUsedAt: Date.now(),
      };
      setCurrentAccount(account);
      refreshAccounts();
      setResolveInputs(['']);
    } catch (err) {
      setResolveError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  function selectAccount(account: AccountSlot): void {
    setCurrentAccount(account);
    refreshAccounts();
  }

  function toggleMyAccount(account: AccountSlot, e: MouseEvent): void {
    e.stopPropagation();
    setMyAccount(myAccount()?.id === account.id ? null : account);
    refreshAccounts();
  }

  function handleRemoveRecent(id: string, e: MouseEvent): void {
    e.stopPropagation();
    removeRecentAccount(id);
    refreshAccounts();
  }

  function handleNewFolder(): void {
    const name = window.prompt('Folder name?');
    if (!name) return;
    createFolder(name);
    refreshTree();
  }

  function handleNewList(): void {
    const name = window.prompt('List name?');
    if (!name) return;
    createList({ name, kind: 'manual' });
    refreshTree();
  }

  // ── Combine setup (creating a dynamic list) ───────────────────────────────────────────────
  const [combineOpen, setCombineOpen] = createSignal(false);
  const [combineName, setCombineName] = createSignal('');
  const [combineOp, setCombineOp] = createSignal<CombineOp>('union');
  const [combineSelected, setCombineSelected] = createSignal<Set<string>>(new Set());
  const [combineError, setCombineError] = createSignal('');

  // Every source a combine can currently be built from — any recent account's Owned/Wishlist,
  // Recently Looked Up, or any existing user list. Not a bundle (would need its own bundle-
  // picker UI, not just a checkbox) — see this file's own header comment.
  function sourceOptions(): SourceOption[] {
    const opts: SourceOption[] = [];
    for (const acc of recents()) {
      const label = acc.label || acc.rawInputs.join(' + ');
      opts.push({ key: `account-owned:${acc.id}`, label: `${label} — Owned`, ref: { kind: 'account-owned', accountId: acc.id } });
      opts.push({ key: `account-wishlist:${acc.id}`, label: `${label} — Wishlist`, ref: { kind: 'account-wishlist', accountId: acc.id } });
    }
    opts.push({ key: 'recent-games', label: 'Recently Looked Up', ref: { kind: 'recent-games' } });
    for (const list of lists()) {
      opts.push({ key: `user:${list.id}`, label: list.name, ref: { kind: 'user', listId: list.id } });
    }
    return opts;
  }

  function toggleCombineSource(key: string): void {
    setCombineSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleCreateCombine(e: Event): void {
    e.preventDefault();
    setCombineError('');
    const name = combineName().trim();
    if (!name) { setCombineError('Name is required.'); return; }
    const selected = combineSelected();
    const sources = sourceOptions().filter(o => selected.has(o.key)).map(o => o.ref);
    if (sources.length < 2) { setCombineError('Pick at least 2 sources.'); return; }
    try {
      createList({ name, kind: 'dynamic', op: combineOp(), sources });
      refreshTree();
      setCombineOpen(false);
      setCombineName('');
      setCombineSelected(new Set<string>());
    } catch (err) {
      setCombineError((err as Error).message);
    }
  }

  function handleRenameFolder(folder: Folder): void {
    const name = window.prompt('Rename folder', folder.name);
    if (!name) return;
    renameFolder(folder.id, name);
    refreshTree();
  }

  function handleRenameList(list: GameList): void {
    const name = window.prompt('Rename list', list.name);
    if (!name) return;
    renameList(list.id, name);
    refreshTree();
  }

  function handleDeleteFolder(folder: Folder): void {
    const hasChildren = folders().some(f => f.parentId === folder.id) || lists().some(l => l.parentId === folder.id);
    const mode = hasChildren
      ? (window.confirm(`"${folder.name}" isn't empty. Delete it and everything inside? Cancel to move its contents up instead.`) ? 'delete' : 'promote')
      : 'delete';
    deleteFolder(folder.id, mode);
    refreshTree();
  }

  function handleDeleteList(list: GameList): void {
    if (!window.confirm(`Delete "${list.name}"?`)) return;
    const result = deleteList(list.id);
    if (result.softDeleted) window.alert(`"${list.name}" is still referenced by another list, so it was hidden instead of deleted.`);
    refreshTree();
  }

  function childrenOf(parentId: string | null): { type: 'folder' | 'list'; item: Folder | GameList; order: number }[] {
    const childFolders = folders().filter(f => f.parentId === parentId).map(f => ({ type: 'folder' as const, item: f, order: f.order }));
    const childLists = lists().filter(l => l.parentId === parentId).map(l => ({ type: 'list' as const, item: l, order: l.order }));
    return [...childFolders, ...childLists].sort((a, b) => a.order - b.order);
  }

  function collectRows(parentId: string | null, depth: number, out: TreeRow[]): void {
    for (const child of childrenOf(parentId)) {
      out.push({ type: child.type, item: child.item, depth });
      if (child.type === 'folder') collectRows(child.item.id, depth + 1, out);
    }
  }

  const treeRows = createMemo(() => {
    const out: TreeRow[] = [];
    collectRows(null, 0, out);
    return out;
  });

  return (
    <div class="home-route">
      <section class="home-account">
        <h2>Account</h2>
        <Show when={currentAccount()} fallback={<p>No account selected yet.</p>}>
          {account => (
            <div class="account-header">
              <Show when={account().avatarUrl}>{url => <img src={url()} alt="" width="48" height="48" />}</Show>
              <div>
                <div class="account-label">{account().label || account().rawInputs.join(' + ')}</div>
                <div class="account-counts">
                  Owned: {counts().owned ?? '…'} · Wishlisted: {counts().wishlist ?? '…'}
                </div>
              </div>
            </div>
          )}
        </Show>

        <form onSubmit={e => { e.preventDefault(); resolveAndSetCurrent(); }}>
          <For each={resolveInputs()}>
            {(value, i) => (
              <input
                type="text"
                value={value}
                placeholder="Steam name, profile URL, or 64-bit ID…"
                onInput={e => setResolveInputs(prev => prev.map((v, idx) => idx === i() ? e.currentTarget.value : v))}
              />
            )}
          </For>
          <button type="button" onClick={() => setResolveInputs(prev => [...prev, ''])}>+ Add Steam Family account</button>
          <button type="submit" disabled={resolving()}>{resolving() ? 'Resolving…' : 'Set as current account'}</button>
        </form>
        {resolveError() && <p class="error">{resolveError()}</p>}

        <h3>Recent accounts</h3>
        <Show when={recents().length > 0} fallback={<p>No recent accounts yet.</p>}>
          <ul class="recent-accounts">
            <For each={recents()}>
              {account => (
                <li>
                  <button type="button" onClick={() => selectAccount(account)}>
                    {myAccount()?.id === account.id ? '★ ' : ''}{account.label || account.rawInputs.join(' + ')}
                  </button>
                  <button type="button" title="Set as my account" onClick={[toggleMyAccount, account]}>
                    {myAccount()?.id === account.id ? '☆ unstar' : '★ star as mine'}
                  </button>
                  <button type="button" title="Remove" onClick={[handleRemoveRecent, account.id]}>×</button>
                </li>
              )}
            </For>
          </ul>
          <button type="button" class="recents-clear" onClick={() => { clearRecentAccounts(); refreshAccounts(); }}>Clear all</button>
        </Show>
      </section>

      <section class="home-fixed-links">
        <A href="/lists/owned">Owned</A>
        <A href="/lists/wishlist">Wishlist</A>
        <A href="/bundles">Bundles</A>
        <A href="/lists/recent">Recently Looked Up</A>
      </section>

      <section class="home-tree">
        <h2>Your lists</h2>
        <div class="tree-actions">
          <button type="button" onClick={handleNewFolder}>+ New folder</button>
          <button type="button" onClick={handleNewList}>+ New list</button>
          <button type="button" onClick={() => setCombineOpen(v => !v)}>
            {combineOpen() ? 'Cancel combine' : '+ New combined list'}
          </button>
        </div>

        <Show when={combineOpen()}>
          <form class="combine-form" onSubmit={handleCreateCombine}>
            <input
              type="text"
              placeholder="Combined list name…"
              value={combineName()}
              onInput={e => setCombineName(e.currentTarget.value)}
            />
            <select value={combineOp()} onChange={e => setCombineOp(e.currentTarget.value as CombineOp)}>
              <For each={COMBINE_OPS}>{op => <option value={op.value}>{op.label}</option>}</For>
            </select>
            <p>Pick at least 2 sources:</p>
            <ul class="combine-sources">
              <For each={sourceOptions()}>
                {opt => (
                  <li>
                    <label>
                      <input
                        type="checkbox"
                        checked={combineSelected().has(opt.key)}
                        onChange={() => toggleCombineSource(opt.key)}
                      />
                      {opt.label}
                    </label>
                  </li>
                )}
              </For>
            </ul>
            {combineError() && <p class="error">{combineError()}</p>}
            <button type="submit">Create combined list</button>
          </form>
        </Show>
        <Show when={treeRows().length > 0} fallback={<p>No lists yet — create one above.</p>}>
          <ul class="list-tree">
            <For each={treeRows()}>
              {row => (
                <li style={{ 'padding-left': `${row.depth * 20}px` }}>
                  {row.type === 'folder' ? (
                    <>
                      <span>📁 {(row.item as Folder).name}</span>
                      <button type="button" onClick={() => handleRenameFolder(row.item as Folder)}>Rename</button>
                      <button type="button" onClick={() => handleDeleteFolder(row.item as Folder)}>Delete</button>
                    </>
                  ) : (
                    <>
                      <A href={`/lists/${row.item.id}`}>
                        {(row.item as GameList).kind === 'dynamic' ? '⚡ ' : '📄 '}{row.item.name}
                      </A>
                      <button type="button" onClick={() => handleRenameList(row.item as GameList)}>Rename</button>
                      <button type="button" onClick={() => handleDeleteList(row.item as GameList)}>Delete</button>
                    </>
                  )}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
