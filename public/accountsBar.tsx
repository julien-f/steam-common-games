// Shared by the comparison page (app.tsx) and the Library Explorer (library.tsx): the actual
// rendering of the "accounts bar" of resolved-account chips under a search form, plus a locally
// remembered "recent searches" row above it — the pure derived-data logic (`accountsBar.ts`) is
// imported from here rather than duplicated. Real Solid components now, replacing the old
// `innerHTML`-rebuild-per-call functions — but every exported function below keeps its exact
// original name/signature (same call sites in app.tsx/library.tsx, unchanged by this conversion)
// except `bindAccountRefresh`'s callback, which drops the second `btnEl` parameter neither host
// page ever actually used (there's no longer a raw clicked `<button>` element to hand back —
// see AccountChip's own `refreshing` prop below for how that state moved to a signal instead).
//
// Each exported render/bind function mounts a persistent Solid root into its `containerEl` the
// first time it's called for that element (`ensureBarMount`/`ensureRecentsMount`, keyed by a
// `WeakMap`) rather than rebuilding `innerHTML` from scratch every call — later calls for the
// same element just push new values into that root's own signals. `bindAccountRefresh`/
// `bindRecentsBar` always run once at page init, before the first `render*` call for the same
// element (confirmed against both host pages) — but `ensureBarMount`/`ensureRecentsMount` don't
// depend on that order either way, so whichever of bind/render happens to run first just creates
// the mount for the other to find already there.

import { createSignal, createEffect, createMemo, For, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  computeAccountChipView, computeRecentChipView,
  loadRecents, saveRecents, removeRecent,
} from './accountsBar.ts';
import type { AccountChipPlayer, AccountChipView, RecentEntry } from './accountsBar.ts';

// The identity (avatar + name, linking out to the profile) is its own <a>/<span> nested inside
// the chip <div> rather than the whole chip being one big link — the chip also holds a <button>
// (per-account refresh), and interactive content nested inside an <a> is invalid HTML / fights
// click-target handling.
function AccountIdentityInner(props: { view: AccountChipView }): JSX.Element {
  return (
    <>
      <span class="account-avatar-wrap">
        <Show when={props.view.safeAvatar}>
          <img class="account-avatar" src={props.view.safeAvatar} alt="" width="28" height="28" />
        </Show>
        <span class={`account-status account-status-${props.view.statusClass}`} title={props.view.statusTitle} />
      </span>
      <span class="account-meta">
        <span class="account-name">{props.view.name}</span>
        <Show when={typeof props.view.count === 'number'}>
          <span class="account-count">{props.view.count!.toLocaleString()} {props.view.countLabel}</span>
        </Show>
      </span>
    </>
  );
}

// `refreshing`: whether this specific account's own "↻" refresh is in flight — previously the
// clicked `<button>` element was mutated directly (`disabled = true; textContent = '⋯'`) by
// whoever called `bindAccountRefresh`'s `onRefresh`; now it's a per-steamid membership check
// against the bar's own `refreshing` signal (see `makeRefreshState` below) instead, since a real
// Solid component can't reach back into a specific past button element the way delegated-click
// imperative code could.
function AccountChip(props: { player: AccountChipPlayer; countLabel: () => string; refreshing: () => boolean; onRefresh: (steamid: string) => void }): JSX.Element {
  const v = createMemo(() => computeAccountChipView(props.player, props.countLabel()));
  return (
    <div class="account-chip">
      <Show when={v().safeUrl} fallback={<span class="account-identity"><AccountIdentityInner view={v()} /></span>}>
        <a class="account-identity" href={v().safeUrl} target="_blank" rel="noopener"><AccountIdentityInner view={v()} /></a>
      </Show>
      <Show when={v().isPrivate}>
        <span class="account-private" title="Profile is private — results for this account may be empty or incomplete">🔒 Private</span>
      </Show>
      <button type="button" class="account-refresh-btn" title="Refresh just this account" disabled={props.refreshing()} onClick={() => props.onRefresh(v().steamid)}>
        {props.refreshing() ? '⋯' : '↻'}
      </button>
    </div>
  );
}

// The refresh-button state shared by every chip a bar renders — `markRefreshing` both flips a
// chip's own button into its disabled/spinner state *and* forwards the click to whatever
// `bindAccountRefresh` registered (`onRefreshRef`, a plain mutable ref rather than a signal,
// since it's only ever read at click time, never rendered reactively). `clear()` is called by
// `renderAccountChips`/`renderAccountChipsGrouped` on every fresh render — same as the old
// `innerHTML` rebuild implicitly "resetting" every button back to its default state on the next
// render regardless of whether the in-flight refresh actually succeeded or failed.
interface RefreshState {
  refreshing: () => Set<string>;
  markRefreshing: (steamid: string) => void;
  clear: () => void;
  onRefreshRef: { current: (steamid: string) => void };
}
function makeRefreshState(): RefreshState {
  const [refreshing, setRefreshing] = createSignal<Set<string>>(new Set());
  const onRefreshRef = { current: (_steamid: string) => {} };
  return {
    refreshing,
    markRefreshing: steamid => {
      setRefreshing(prev => new Set(prev).add(steamid));
      onRefreshRef.current(steamid);
    },
    clear: () => setRefreshing(new Set()),
    onRefreshRef,
  };
}

type AccountGroup = { label?: string; players: AccountChipPlayer[] };

interface BarMount {
  setPlayers: (v: AccountChipPlayer[] | null | undefined) => void;
  setGroups: (v: AccountGroup[] | null | undefined) => void;
  setCountLabel: (v: string) => void;
  refresh: RefreshState;
}
const barMounts = new WeakMap<HTMLElement, BarMount>();

// A given `containerEl` is only ever driven by one of `renderAccountChips` (flat — the Library
// Explorer's single Family group) or `renderAccountChipsGrouped` (the comparison page's
// per-slot groups) in practice, never both — so `groups()` (grouped mode) takes priority in the
// `<Show>` below purely as an arbitrary tie-break, and whichever of the two setters this
// container's host page never calls simply stays at its initial `null` forever.
function ensureBarMount(containerEl: HTMLElement): BarMount {
  const existing = barMounts.get(containerEl);
  if (existing) return existing;

  const [players, setPlayers] = createSignal<AccountChipPlayer[] | null | undefined>(null);
  const [groups, setGroups] = createSignal<AccountGroup[] | null | undefined>(null);
  const [countLabel, setCountLabel] = createSignal('');
  const refresh = makeRefreshState();
  const mount: BarMount = { setPlayers, setGroups, setCountLabel, refresh };
  barMounts.set(containerEl, mount);

  render(() => {
    // `createMemo`/`createEffect` deliberately live inside this `render()` callback, not above
    // it — `ensureBarMount` itself runs outside any reactive root (it may be called from
    // `bindAccountRefresh`, well before `render()` establishes one), and a memo/effect created
    // there would log Solid's "computations created outside a createRoot or render will never
    // be disposed" warning (confirmed live) despite working today, since this mount is never
    // torn down for the life of the page anyway.
    const nonEmptyGroups = createMemo(() => (groups() || []).filter(g => g.players && g.players.length > 0));
    createEffect(() => {
      containerEl.hidden = groups() != null ? nonEmptyGroups().length === 0 : !(players() && players()!.length);
    });
    return (
      <Show when={groups()} fallback={
        <For each={players() || []}>{p => (
          <AccountChip player={p} countLabel={countLabel} refreshing={() => refresh.refreshing().has(p.steamid)} onRefresh={refresh.markRefreshing} />
        )}</For>
      }>
        <For each={nonEmptyGroups()}>{g => (
          <div class="slot-accounts">
            <Show when={g.label}><span class="slot-label">{g.label}</span></Show>
            <For each={g.players}>{p => (
              <AccountChip player={p} countLabel={countLabel} refreshing={() => refresh.refreshing().has(p.steamid)} onRefresh={refresh.markRefreshing} />
            )}</For>
          </div>
        )}</For>
      </Show>
    );
  }, containerEl);

  return mount;
}

// Flat row of chips — one group's worth of accounts (the Library Explorer's single
// Family group, or the comparison page when there's only one slot).
export function renderAccountChips(containerEl: HTMLElement, players: AccountChipPlayer[] | null | undefined, countLabel: string) {
  const mount = ensureBarMount(containerEl);
  mount.refresh.clear();
  mount.setCountLabel(countLabel);
  mount.setPlayers(players);
}

// Chips clustered into labelled groups — the comparison page's per-slot view, since a
// search there can compare several separate slots (each possibly itself a multi-account
// Family). `groups`: [{ label, players }]. `label` is omitted (no heading rendered) for
// a single-group search, where per-slot labeling would just be noise.
export function renderAccountChipsGrouped(containerEl: HTMLElement, groups: AccountGroup[] | null | undefined, countLabel: string) {
  const mount = ensureBarMount(containerEl);
  mount.refresh.clear();
  mount.setCountLabel(countLabel);
  mount.setGroups(groups);
}

// `onRefresh(steamid)` is responsible for re-running the search with that one account
// force-refreshed and re-rendering the bar (which naturally resets every chip's refresh state
// via `renderAccountChips`/`renderAccountChipsGrouped`'s own `refresh.clear()` above).
export function bindAccountRefresh(containerEl: HTMLElement, onRefresh: (steamid: string) => void) {
  ensureBarMount(containerEl).refresh.onRefreshRef.current = onRefresh;
}

// ── Recent searches ──────────────────────────────────────────────────────────

function RecentChip(props: { entry: RecentEntry; onLoad: (data: unknown) => void; onRemove: (id: string) => void }): JSX.Element {
  const v = createMemo(() => computeRecentChipView(props.entry));
  return (
    <span class="recent-chip">
      <button type="button" class="recent-chip-btn" title={`Load ${v().label}`} onClick={() => props.onLoad(props.entry.data)}>
        <Show when={v().safeAvatar}><img class="recent-chip-avatar" src={v().safeAvatar} alt="" /></Show>
        {v().label}
      </button>
      <button type="button" class="recent-chip-remove" title="Remove from recent" onClick={() => props.onRemove(props.entry.id)}>×</button>
    </span>
  );
}

interface RecentsMount {
  refreshEntries: () => void;
  onLoadRef: { current: (data: unknown) => void };
}
const recentsMounts = new WeakMap<HTMLElement, RecentsMount>();

function ensureRecentsMount(containerEl: HTMLElement, storageKey: string): RecentsMount {
  const existing = recentsMounts.get(containerEl);
  if (existing) return existing;

  const [entries, setEntries] = createSignal<RecentEntry[]>(loadRecents(storageKey));
  const onLoadRef = { current: (_data: unknown) => {} };
  const refreshEntries = () => setEntries(loadRecents(storageKey));
  const mount: RecentsMount = { refreshEntries, onLoadRef };
  recentsMounts.set(containerEl, mount);

  render(() => {
    createEffect(() => { containerEl.hidden = entries().length === 0; });
    return (
      <Show when={entries().length > 0}>
        <>
          <span class="recents-label">Recent:</span>
          <For each={entries()}>{entry => (
            <RecentChip
              entry={entry}
              onLoad={data => onLoadRef.current(data)}
              onRemove={id => { removeRecent(storageKey, id); refreshEntries(); }}
            />
          )}</For>
          <button type="button" class="recents-clear" onClick={() => { saveRecents(storageKey, []); refreshEntries(); }}>Clear</button>
        </>
      </Show>
    );
  }, containerEl);

  return mount;
}

export function renderRecentsBar(containerEl: HTMLElement, storageKey: string) {
  ensureRecentsMount(containerEl, storageKey).refreshEntries();
}

// `onLoad(data)` replays a remembered search; re-rendering the bar after removal/clear is
// handled internally (see `ensureRecentsMount` above) regardless of the host page.
export function bindRecentsBar(containerEl: HTMLElement, storageKey: string, onLoad: (data: unknown) => void) {
  ensureRecentsMount(containerEl, storageKey).onLoadRef.current = onLoad;
}
