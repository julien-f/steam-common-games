// The nav bar's account chip — who the app is currently showing, and one-click access to that
// account's Owned/Wishlist lists from every route (see docs/dev/frontend.md).
//
// Two problems it exists to fix, both consequences of Home having been the only place any of
// this lived: getting to Owned/Wishlist from anywhere else meant a round trip through Home, and
// — worse — nothing outside Home said *whose* library was on screen, even while a `?u=` link was
// being explored. Both are shell concerns, not route ones, so this mounts once in AppShell.tsx's
// nav bar and survives every navigation.
//
// The two list links render inline next to the chip on a wide viewport and inside the popover on
// a narrow one (`.account-chip-links`/`.account-chip-panel-links`, style.css) — they're the two
// most-visited destinations in the app, so they're worth permanent nav space wherever there's
// room for it, and the popover has to carry them regardless for the case where there isn't.
//
// Deliberately thin next to Home's own account section: current account, switch account, and the
// `?u=` exploring state. Resolving a new identifier, ★ starring, per-account refresh, counts,
// Family member rows and removal all stay on Home — this is a nav affordance, not a second,
// half-implemented copy of that screen, so it links there instead of growing toward it.
import { createSignal, onCleanup, onMount, For, Show, type JSX } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import {
  getEffectiveCurrentAccount, getAccountOverride, getRecentAccounts, setCurrentAccount,
  accountDisplayLabel, ACCOUNT_CHANGED_EVENT,
} from './accountsStore.ts';
import { getAccountOverrideState, clearAccountOverride, accountOverrideStatusText } from './accountOverride.ts';
import { withAccountParam, urlWithoutAccountParam } from './urlState.ts';
import { bindNavPopover } from './navPopover.ts';
import type { AccountSlot } from './types.ts';

export function AccountChip(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  // The `<details>`/panel pair are always rendered, even with no account at all — the popover
  // still has recents to switch to and a way to Home, and a ref inside a <Show> wouldn't exist
  // yet at onMount time to bind anything to.
  let detailsEl!: HTMLDetailsElement;
  let panelEl!: HTMLDivElement;

  const [account, setAccount] = createSignal<AccountSlot | null>(getEffectiveCurrentAccount());
  const [overrideState, setOverrideState] = createSignal(getAccountOverrideState());
  const [override, setOverride] = createSignal<AccountSlot | null>(getAccountOverride());
  const [recents, setRecents] = createSignal<AccountSlot[]>(getRecentAccounts());

  // A `?u=` link resolves asynchronously, after the shell has mounted, and an account can be
  // picked from anywhere (Home's picker, this popover). Same "plain module + window event,
  // subscriber owns the signal" shape HomeRoute and region.ts already use.
  function refresh(): void {
    setAccount(getEffectiveCurrentAccount());
    setOverrideState(getAccountOverrideState());
    setOverride(getAccountOverride());
    setRecents(getRecentAccounts());
  }
  window.addEventListener(ACCOUNT_CHANGED_EVENT, refresh);
  onCleanup(() => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refresh));

  onMount(() => onCleanup(bindNavPopover(detailsEl, panelEl)));

  // Every link out of here carries `?u=` along (withAccountParam), or clicking "Owned" while
  // exploring a shared link would quietly show the *stored* account's library instead. Built off
  // the router's own reactive location.search, so each href updates itself the moment an explicit
  // pick strips the param (pick() below).
  function link(path: string): string {
    return withAccountParam(path, location.search);
  }

  // The same explicit-pick semantics as Home's own `pickAccount` — storing the account also
  // consumes any `?u=` override, param and all, rather than leaving the link still overriding the
  // preference just set. Kept as its own small copy rather than lifted into accountsStore.ts:
  // this half of it is routing (the router's navigate, this route's own location), which that
  // file deliberately has none of.
  function pick(acc: AccountSlot): void {
    clearAccountOverride();
    setCurrentAccount(acc);
    navigate(urlWithoutAccountParam(location.pathname, location.search), { replace: true });
    detailsEl.open = false;
    refresh();
  }

  const otherRecents = () => recents().filter(a => a.id !== account()?.id);

  // Not `<Show when={account()}>{acc => accountDisplayLabel(acc())}</Show>`: a child function
  // returning a bare string is evaluated once, when `when` first goes truthy, and Solid inserts
  // the resulting text — so switching from one account straight to another (truthy → truthy,
  // exactly what a `?u=` link resolving does) left the name stuck on the previous account while
  // the avatar next to it, a plain JSX expression, updated correctly. Confirmed live: the chip
  // read "Pixl Pixl" over spirulou's avatar on `/lists/wishlist?u=spirulou`. As a plain accessor
  // read inside JSX, this is a reactive insertion like any other.
  const chipLabel = () => {
    const acc = account();
    if (acc) return accountDisplayLabel(acc);
    return overrideState().state === 'resolving' ? 'Resolving link…' : 'No account';
  };

  return (
    <div class="site-nav-account">
      <Show when={account()}>
        <div class="account-chip-links">
          <A href={link('/lists/owned')} class="site-nav-link" activeClass="active">Owned</A>
          <A href={link('/lists/wishlist')} class="site-nav-link" activeClass="active">Wishlist</A>
        </div>
      </Show>

      <details class="site-nav-popover" ref={detailsEl}>
        <summary class="site-nav-link account-chip-btn" aria-label="Account">
          <Show when={account()?.avatarUrl}>
            {url => <img class="account-chip-avatar" src={url()} alt="" width="20" height="20" />}
          </Show>
          <span class="account-chip-name">{chipLabel()}</span>
          {/* A link's account is showing, not the stored one — the difference is invisible
              otherwise, and this chip is the one thing on screen from every route that can say so
              (Home says it at length; see its own account-override note). */}
          <Show when={override()}>
            <span class="account-chip-explore" title="Showing an account from a shared link, not your own">🔗</span>
          </Show>
        </summary>

        <div class="site-nav-popover-panel account-chip-panel" ref={panelEl}>
          <Show when={accountOverrideStatusText(overrideState())}>
            {text => <p class="account-chip-note">{text()}</p>}
          </Show>
          <Show when={override()}>
            {acc => (
              <p class="account-chip-note">
                Exploring <strong>{accountDisplayLabel(acc())}</strong> from a link — your own account is unchanged.
                <button type="button" class="account-chip-action" onClick={() => pick(acc())}>Set as my current account</button>
              </p>
            )}
          </Show>

          {/* The same two links as the inline pair above — CSS shows exactly one of the two at a
              given width (style.css's 768px breakpoint), so this isn't a visible duplicate. */}
          <Show when={account()}>
            <div class="account-chip-panel-links">
              <A href={link('/lists/owned')} class="account-chip-panel-link">Owned</A>
              <A href={link('/lists/wishlist')} class="account-chip-panel-link">Wishlist</A>
            </div>
          </Show>

          <Show when={otherRecents().length > 0}>
            <div class="account-chip-section">Switch account</div>
            <ul class="account-chip-recents">
              <For each={otherRecents()}>
                {acc => (
                  <li>
                    <button type="button" class="account-chip-recent" onClick={() => pick(acc)}>
                      <Show when={acc.avatarUrl} fallback={<span class="account-chip-avatar account-chip-avatar--empty" />}>
                        {url => <img class="account-chip-avatar" src={url()} alt="" width="20" height="20" />}
                      </Show>
                      <span class="account-chip-name">{accountDisplayLabel(acc)}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <A href={link('/')} class="account-chip-panel-link" onClick={() => { detailsEl.open = false; }}>
            {account() ? 'Manage accounts on Home' : 'Pick an account on Home'}
          </A>
        </div>
      </details>
    </div>
  );
}
