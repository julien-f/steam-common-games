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
import { createSignal, createEffect, createMemo, onCleanup, For, Index, Show } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import {
  getMyAccount, setMyAccount, getEffectiveCurrentAccount, setCurrentAccount,
  getRecentAccounts, removeRecentAccount, clearRecentAccounts,
  getAccountOverride, ACCOUNT_CHANGED_EVENT,
} from './accountsStore.ts';
import { getAccountOverrideState, clearAccountOverride, accountOverrideStatusText } from './accountOverride.ts';
import { withAccountParam, urlWithoutAccountParam } from './urlState.ts';
import { resolveAccountSummary, fetchAccountOverview, fetchAccountWishlistItems } from './accountData.ts';
import type { AccountPlayer } from './accountData.ts';
import { normalizeInput, fmtAge } from './utils.ts';
import {
  getFolders, getLists, createFolder, createList, renameFolder, renameList,
  deleteFolder, deleteList,
} from './listsStore.ts';
import { setBaseTitle } from './pageTitle.ts';
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

// `personastate`/`gameextrainfo` ride on the same 6h library cache tier as the rest of an
// account's data (see toAccountPlayer in accountData.ts) — real data, just not live — so the
// tooltip says "as of the last refresh" rather than implying real-time presence.

interface TreeRow {
  type: 'folder' | 'list';
  item: Folder | GameList;
  depth: number;
}

export default function HomeRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const [myAccount, setMyAccountSig] = createSignal<AccountSlot | null>(getMyAccount());
  // The *effective* current account — a `?u=` link's override when one is being explored,
  // the stored preference otherwise (see accountsStore.ts's own `?u=` section). Everything
  // below (the account card, the counts/players fetch, the document title) reads this, so a
  // shared link renders exactly as a picked account does; only the picker itself (recents,
  // ★ starring) still deals in stored accounts.
  const [currentAccount, setCurrentAccountSig] = createSignal<AccountSlot | null>(getEffectiveCurrentAccount());
  const [overrideState, setOverrideState] = createSignal(getAccountOverrideState());
  const [recents, setRecentsSig] = createSignal<AccountSlot[]>(getRecentAccounts());
  const [resolveInputs, setResolveInputs] = createSignal<string[]>(['']);
  const [resolveError, setResolveError] = createSignal('');
  const [resolving, setResolving] = createSignal(false);
  const [counts, setCounts] = createSignal<{ owned: number | null; wishlist: number | null }>({ owned: null, wishlist: null });
  // The current account's member accounts as Steam itself describes them (persona name, profile
  // URL, presence, profile visibility, per-member game count) — see the counts effect below for
  // why this rides along on the same fetch rather than being stored on AccountSlot.
  const [players, setPlayers] = createSignal<AccountPlayer[]>([]);
  // How old the server's cached copy of the current account's data is (epoch ms, null = fetched
  // fresh), and whether a forced re-fetch is in flight — see the Account card's "Updated <when>"
  // line below.
  const [fetchedAt, setFetchedAt] = createSignal<number | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);

  const [folders, setFoldersSig] = createSignal<Folder[]>(getFolders());
  const [lists, setListsSig] = createSignal<GameList[]>(getLists());

  function refreshAccounts(): void {
    setMyAccountSig(getMyAccount());
    setCurrentAccountSig(getEffectiveCurrentAccount());
    setOverrideState(getAccountOverrideState());
    setRecentsSig(getRecentAccounts());
  }
  function refreshTree(): void {
    setFoldersSig(getFolders());
    setListsSig(getLists());
  }

  // A `?u=` override resolves asynchronously, after this route has already mounted (AppShell.tsx
  // kicks it off), so the account card can't just read it once — accountsStore.ts broadcasts
  // every change to the effective account (and accountOverride.ts every change to how it should
  // be described), and this re-reads both. Same "plain module + window event, subscriber owns
  // the signal" shape region.ts/REGION_CHANGED_EVENT already uses elsewhere in the app.
  window.addEventListener(ACCOUNT_CHANGED_EVENT, refreshAccounts);
  onCleanup(() => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refreshAccounts));

  // Counts and per-member profile data aren't stored on AccountSlot itself (they'd go stale —
  // AccountSlot only caches a label/avatar so recents can render instantly) — refetched live
  // whenever currentAccount changes, including on initial mount for whatever was already stored.
  // fetchAccountOverview, not fetchAccountOwnedGames: the owned count and the member accounts'
  // own display data come back in the same /api/common-games response, so asking for both costs
  // one request rather than two identical POSTs.
  // Extracted from the effect below so the card's own ↻ can re-run it with `refresh: true`,
  // which forces the server past its library-tier cache for this account (owned games, wishlist
  // and profile alike) rather than waiting out a TTL now measured in weeks.
  function loadAccountData(account: AccountSlot, { refresh = false }: { refresh?: boolean } = {}): void {
    setCounts({ owned: null, wishlist: null });
    setPlayers([]);
    if (refresh) { setRefreshing(true); setFetchedAt(null); }
    const members = account.members;
    const owned = fetchAccountOverview(members, { refresh }).then(
      ({ games, players: ps, fetchedAt: at }) => { setCounts(c => ({ ...c, owned: games.length })); setPlayers(ps); setFetchedAt(at); },
      () => setCounts(c => ({ ...c, owned: 0 })),
    );
    const wishlist = fetchAccountWishlistItems(members, { refresh }).then(
      items => setCounts(c => ({ ...c, wishlist: items.length })),
      () => setCounts(c => ({ ...c, wishlist: 0 })),
    );
    void Promise.allSettled([owned, wishlist]).then(() => setRefreshing(false));
  }

  createEffect(() => {
    const account = currentAccount();
    if (!account) { setCounts({ owned: null, wishlist: null }); setPlayers([]); setFetchedAt(null); return; }
    loadAccountData(account);
  });

  // The resolved slot a `?u=` link is currently showing, or null when there's no override (or
  // it hasn't resolved yet / failed) — what the "Exploring …" note and its adopt button read.
  const overrideAccount = createMemo(() => (overrideState().state === 'ready' ? getAccountOverride() : null));

  // Only meaningful for a single-account slot — a Steam Family has no one persona/presence/
  // profile to speak for the whole slot, so its members are listed individually instead (see the
  // Account card below).
  const solePlayer = createMemo(() => (players().length === 1 ? players()[0] : null));

  // document.title's per-route "base" layer (see pageTitle.ts) — whichever account is currently
  // loaded, same fallback-to-bare-app-name-when-none convention the old comparison page's own
  // updateTitle() used. The side panel's own game-open title takes over on top of this when a
  // game is opened from here, same as every other route.
  createEffect(() => setBaseTitle(currentAccount()?.label ?? null));
  onCleanup(() => setBaseTitle(null));

  async function resolveAndSetCurrent(): Promise<void> {
    const trimmed = resolveInputs().map(s => normalizeInput(s.trim())).filter(Boolean);
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
      pickAccount(account);
      setResolveInputs(['']);
    } catch (err) {
      setResolveError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  function selectAccount(account: AccountSlot): void {
    pickAccount(account);
  }

  // The one place an *explicit* account pick lands — a fresh resolve, a recents click, or
  // adopting whatever a `?u=` link was showing. Beyond storing it, this consumes the override:
  // the param has served its purpose once the user has chosen, so it's dropped from state and
  // stripped from the URL (replaceState) rather than left there to keep overriding the very
  // preference that was just set. See docs/list-centric-redesign.md's `?u=` section.
  function pickAccount(account: AccountSlot): void {
    clearAccountOverride();
    setCurrentAccount(account);
    // Through the router (replacing, not pushing), not a bare history.replaceState — see
    // urlWithoutAccountParam's own comment: the router's location signal is what every
    // withAccountParam-built href is derived from, so stripping the param behind the router's
    // back leaves all of them pointed at an account the URL no longer names.
    navigate(urlWithoutAccountParam(location.pathname, location.search), { replace: true });
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

  // The fixed list links have to carry a `?u=` override along (`withAccountParam`) or clicking
  // "Owned" while exploring a shared link would quietly show the *stored* account's library
  // instead. Built off the router's own reactive `location.search`, so each href updates itself
  // the moment an explicit pick strips the param (pickAccount above).
  function accountLink(path: string): string {
    return withAccountParam(path, location.search);
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

        {/* A `?u=` link being explored — see accountsStore.ts's own `?u=` section. Said out loud
            rather than left implicit: the account card below is showing someone the *link*
            picked, not the visitor's own stored account, and that difference is invisible
            otherwise. The adopt button is the only way this ever becomes their stored account
            (pickAccount, which also strips the now-redundant param). */}
        <Show when={overrideState().state !== 'none'}>
          <div class="account-override">
            <Show when={accountOverrideStatusText(overrideState())}>
              {text => <p class="account-override-status">{text()}</p>}
            </Show>
            <Show when={overrideAccount()}>
              {account => (
                <p class="account-override-status">
                  Exploring <strong>{account().label || account().rawInputs.join(' + ')}</strong> from this
                  link — your own current account is unchanged.
                  <button type="button" class="account-override-adopt" onClick={() => pickAccount(account())}>
                    Set as my current account
                  </button>
                </p>
              )}
            </Show>
            {/* An old Comparison-page link (`?u=alice&u=bob`) — a shape with no single route
                anymore. urlState.ts's AccountParam.extraSlots explains why the extras are
                reported rather than silently unioned into one Family or dropped. */}
            <Show when={overrideState().extraSlots > 0}>
              <p class="account-override-status">
                This link lists {overrideState().extraSlots + 1} accounts to compare. Showing the first;
                combine each account's Owned list into a new list below to compare them.
              </p>
            </Show>
          </div>
        </Show>
        {/* The header speaks for the slot as a whole — one avatar/name/presence for a plain
            single account, or just the joined label plus a per-member list below for a Steam
            Family, where no single persona/profile/presence describes the whole thing. Everything
            beyond the label/avatar comes from `players()` (fetched live, see the effect above),
            not from the stored AccountSlot, so it can't show a stale persona or presence. */}
        <Show when={currentAccount()} fallback={<p>No account selected yet.</p>}>
          {account => (
            <div class="account-header">
              <Show when={solePlayer()?.avatarUrl || account().avatarUrl}>
                {url => (
                  <span class="account-avatar-wrap account-avatar-lg">
                    <img class="account-avatar" src={url()} alt="" width="48" height="48" />
                  </span>
                )}
              </Show>
              <div>
                <div class="account-label">
                  <Show
                    when={solePlayer()?.profileUrl}
                    fallback={solePlayer()?.name || account().label || account().rawInputs.join(' + ')}
                  >
                    {url => (
                      <a class="account-profile-link" href={url()} target="_blank" rel="noopener noreferrer" title={`Steam ID ${solePlayer()!.steamid}`}>
                        {solePlayer()!.name} <span class="account-profile-arrow">↗</span>
                      </a>
                    )}
                  </Show>
                  <Show when={solePlayer()?.isPrivate}>
                    <span class="account-private" title="This Steam profile isn't public — some data may be missing or empty">🔒 Private</span>
                  </Show>
                </div>
                <div class="account-counts">
                  Owned: {counts().owned ?? '…'} · Wishlisted: {counts().wishlist ?? '…'}
                  <Show when={players().length > 1}>{` · ${players().length} accounts merged`}</Show>
                </div>
                {/* Steam data is cached server-side for a long time (see default.env's
                    LIBRARY_CACHE_TTL_MINUTES), so the age of what's on screen is stated outright
                    rather than left to be guessed at, with the ↻ that forces a re-fetch right
                    next to it. */}
                <div class="account-updated">
                  Updated {fmtAge(fetchedAt())}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={refreshing()}
                    title="Re-fetch this account's games, wishlist and profile from Steam"
                    onClick={() => loadAccountData(account(), { refresh: true })}
                  >{refreshing() ? '↻ Refreshing…' : '↻ Refresh'}</button>
                </div>
              </div>
            </div>
          )}
        </Show>

        {/* A Steam Family (several accounts unioned into one slot) — one row per member, since
            the header above can only speak for the slot as a whole. */}
        <Show when={players().length > 1}>
          <ul class="account-members">
            <For each={players()}>
              {p => (
                <li>
                  <Show when={p.avatarUrl}>
                    {url => (
                      <span class="account-avatar-wrap">
                        <img class="account-avatar" src={url()} alt="" width="28" height="28" />
                      </span>
                    )}
                  </Show>
                  <Show when={p.profileUrl} fallback={<span class="account-name">{p.name}</span>}>
                    {url => (
                      <a class="account-name account-profile-link" href={url()} target="_blank" rel="noopener noreferrer" title={`Steam ID ${p.steamid}`}>
                        {p.name} <span class="account-profile-arrow">↗</span>
                      </a>
                    )}
                  </Show>
                  <Show when={p.gameCount != null}>
                    <span class="account-count">{p.gameCount} games</span>
                  </Show>
                  <Show when={p.isPrivate}>
                    <span class="account-private" title="This Steam profile isn't public — some data may be missing or empty">🔒 Private</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <form onSubmit={e => { e.preventDefault(); resolveAndSetCurrent(); }}>
          {/* <Index>, not <For> — <For> keys each item by the value itself (`===` on the
              array element), which is exactly wrong for a list of strings the user is actively
              typing into: changing "a" to "ab" makes the old and new values two *different*
              strings, so <For> would tear down and recreate that index's whole <input> on every
              keystroke, dropping focus mid-word. <Index> keys by array position instead — typing
              updates the same DOM node in place, the same fix Solid's own docs give for this. */}
          <Index each={resolveInputs()}>
            {(value, i) => (
              <input
                type="text"
                value={value()}
                placeholder="Steam name, profile URL, or 64-bit ID…"
                onInput={e => setResolveInputs(prev => prev.map((v, idx) => idx === i ? e.currentTarget.value : v))}
              />
            )}
          </Index>
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
        <A href={accountLink('/lists/owned')}>Owned</A>
        <A href={accountLink('/lists/wishlist')}>Wishlist</A>
        <A href={accountLink('/bundles')}>Bundles</A>
        <A href={accountLink('/game')}>Recently Looked Up</A>
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
