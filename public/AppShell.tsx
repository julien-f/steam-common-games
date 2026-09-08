// The persistent app shell — nav bar, ⚙ Preferences popover, global "look up any game" search,
// the shared side panel + lightbox (mounted once, not per-route) — passed as @solidjs/router's
// `root` (see AppRoot.tsx) so it wraps every route instead of remounting on each navigation.
// This is the app's one nav bar/shell now that the legacy pages (app.tsx/library.tsx/
// bundles.tsx) and the two modules that existed purely to bootstrap them per-page
// (pageShell.ts's `initPageShell`, and nav.tsx's own `initNav`/cross-page `<nav>`) are all
// deleted (Phase 7, see docs/list-centric-redesign.md). The ⚙ Preferences popover's own
// open/close/position mechanics used to live here as a deliberate, temporary duplicate of
// nav.tsx's identically-named pair for exactly that transition period; they're now navPopover.ts's
// `bindNavPopover`, shared with the account chip's own popover (AccountChip.tsx).
import { onMount, onCleanup, createEffect, createSignal, For, type JSX } from 'solid-js';
import { A, useNavigate, useLocation, type RouteSectionProps } from '@solidjs/router';
import { prefsPopoverPanelHtml, initPrefsPopover } from './prefsPopover.ts';
import { initLightbox, isLightboxOpen } from './lightbox.tsx';
import { initPanel, isPanelOpen, panelClose, panelStepHero } from './panel.tsx';
import { bindPanelKeyboardShortcuts } from './panelKeyboard.ts';
import { initGameSearch } from './gameSearch.ts';
import { addRecentGame } from './recentGames.ts';
import { setPanelParam, setLightboxParam, withAccountParam } from './urlState.ts';
import { syncAccountOverrideFromUrl } from './accountOverride.ts';
import type { Game } from './types.ts';
import { ShortcutsModal } from './ShortcutsModal.tsx';
import { AccountChip } from './AccountChip.tsx';
import { bindNavPopover } from './navPopover.ts';

// Route-specific behavior (keyboard shortcuts, and now "open this looked-up game") can't be
// hardcoded at the shell level — different routes have different "list" contexts, or none at all
// (Home, About, the Bundles browse screen). Each mounted route registers its own handlers here;
// the shell delegates through this indirection, defaulting to a no-op/fallback when nothing is
// registered rather than each route needing to rebind the whole document-level keydown listener
// itself, or the shell needing to know which routes are "list-shaped" at all.
//
// `openGame(appid)`: only ListRoute registers this (every one of its kinds can place a looked-up
// game somewhere sensible — its own row if it has one, otherwise a standalone panel docked to
// that same route — see ListRoute's own comment on `handleOpenGameRequest`), so it always returns
// true there. Home/BundlesBrowseRoute/AboutRoute never register it — there's no list/table for a
// game to be "in the context of" on those routes — so `openGameGlobally` below falls through to
// navigating to `/game/:appid` (the Recently Looked Up list) instead.
//
// `onGameClose()`: only ListRoute's `recent` kind registers this — closing the panel there
// should strip `:appid` back to the bare `/game` address (that kind's own address IS the
// focused game, not a `?game=` query param — see ListRoute's own comment on `handleOpenGameRequest`),
// which the shell's own generic `setPanelParam(null)` call below doesn't know how to do (it only
// ever touches the query string). Driven straight off `initPanel`'s `onClose` — the one place
// every close path (× button, Escape, swipe-to-close) already funnels through — rather than a
// route-local reactive effect watching `isPanelOpen()`: a first attempt at exactly that
// (`ListRoute.tsx`'s own `createEffect`) never actually observed the panel-closed transition live
// (confirmed via console logging — the effect re-ran for unrelated reasons but never once with
// `isPanelOpen() === false`, root cause not tracked down), so this goes through the same
// already-proven-reliable synchronous callback `setPanelParam(null)` itself relies on instead.
interface RouteHandlers {
  pickRandom?: () => void;
  stepGame?: (dir: 1 | -1) => boolean;
  onEnterOnFocusedRow?: () => boolean;
  openGame?: (appid: number) => boolean;
  onGameClose?: () => void;
  refreshGame?: (game: Game) => Promise<void>;
}
let routeHandlers: RouteHandlers = {};
export function registerRouteHandlers(handlers: RouteHandlers): () => void {
  routeHandlers = handlers;
  return () => { routeHandlers = {}; };
}

const NAV_LINKS: { href: string; label: string; end?: boolean }[] = [
  { href: '/', label: 'Home', end: true },
  { href: '/bundles', label: 'Bundles' },
  { href: '/about', label: 'About' },
];

export function AppShell(props: RouteSectionProps): JSX.Element {
  let searchInputEl!: HTMLInputElement;
  let prefsDetailsEl!: HTMLDetailsElement;
  let prefsWrapEl!: HTMLDivElement;
  // The `?` shortcuts dialog — see ShortcutsModal.tsx. State lives here because
  // bindPanelKeyboardShortcuts' own `shortcuts` option needs it (that option has been supported
  // all along; nothing has passed it since the pages that owned the old static dialog markup
  // were deleted, so `?` silently did nothing).
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  const navigate = useNavigate();
  const location = useLocation();

  // `?u=` (the account-override param — see accountOverride.ts/accountsStore.ts) is resolved
  // here, once for the whole app, rather than per route: the shell outlives every navigation, so
  // a shared link is honored identically on all of them (Home's account header, the Owned/
  // Wishlist lists, the panel's ownership badges) and stays resolved while clicking between
  // them. This effect runs on every URL change — syncFromUrl itself is keyed on the identifiers,
  // so an unrelated param write (a panel `?game=`, a lightbox `&shot=`) costs nothing.
  createEffect(() => syncAccountOverrideFromUrl(location.search));

  // The one place a game-lookup, from anywhere in the shell, gets routed to wherever it belongs
  // — the currently mounted route's own registered handler if it has one (ListRoute: opens the
  // game in place, never navigating away from whatever list/page is on screen), or `/game/:appid`
  // (the Recently Looked Up list) as the fallback for a route with no game/list context of its
  // own at all (Home, Bundles browse, About) — see registerRouteHandlers's own comment above.
  function openGameGlobally(appid: number): void {
    if (routeHandlers.openGame?.(appid)) return;
    // withAccountParam: a `?u=` link being explored has to survive this navigation, or looking
    // up a game from Home would silently drop back to the stored account (see urlState.ts).
    navigate(withAccountParam(`/game/${appid}`, location.search));
  }

  onMount(() => {
    initLightbox({
      // `&shot=<id>` deep links: the lightbox reports every open/step/close, and this writes it
      // next to the panel's own `?game=`. Wiring this back is what makes a copied link reopen the
      // exact screenshot again — `setLightboxParam` had no caller at all since the redesign, so
      // the param was parsed and ordered but never written.
      onParamChange: shot => setLightboxParam(shot),
      // ↑/↓ inside the lightbox steps to the previous/next game in whatever list is on screen,
      // same handler the panel's own ↑/↓ uses.
      onGameNav: dir => { routeHandlers.stepGame?.(dir === 1 ? 1 : -1); },
    });
    initPanel({
      onClose: () => {
        routeHandlers.onGameClose?.();
        setPanelParam(null);
      },
      onNavigateGame: openGameGlobally,
      // The panel's own "↻ Refresh" button (force-refreshes this game's details, news, price and
      // DLC). Delegated to the mounted route rather than implemented here: the refreshed details
      // have to land on that route's own store-backed row, not just on the panel's plain copy.
      // Only ListRoute registers it — which covers every case, since a game panel only ever opens
      // there (`openGameGlobally` navigates to /game/:appid, which *is* ListRoute).
      onRefresh: game => routeHandlers.refreshGame?.(game),
    });
    initGameSearch({
      inputEl: searchInputEl,
      resultsEl: document.getElementById('app-search-results') as HTMLElement,
      onSelect: game => {
        addRecentGame(game.appid, game.name, game.tinyImage);
        openGameGlobally(game.appid);
      },
    });

    bindPanelKeyboardShortcuts({
      isLightboxOpen,
      isPanelOpen,
      panelClose,
      panelStepHero,
      pickRandom: () => routeHandlers.pickRandom?.(),
      stepGame: dir => routeHandlers.stepGame?.(dir) ?? false,
      focusSearchInput: () => searchInputEl.focus(),
      onEnterOnFocusedRow: () => routeHandlers.onEnterOnFocusedRow?.() ?? false,
      shortcuts: {
        isOpen: shortcutsOpen,
        toggle: () => setShortcutsOpen(v => !v),
        close: () => setShortcutsOpen(false),
      },
    });

    initPrefsPopover();
    // The panel is inside the innerHTML prefsPopoverPanelHtml() renders, so it's looked up under
    // the wrapper rather than ref'd directly.
    onCleanup(bindNavPopover(prefsDetailsEl, prefsWrapEl.querySelector('.site-nav-prefs-panel') as HTMLElement));
  });

  return (
    <div class="app-shell">
      <nav id="site-nav" class="site-nav">
        <For each={NAV_LINKS}>
          {link => (
            <A href={withAccountParam(link.href, location.search)} end={link.end} class="site-nav-link" activeClass="active">
              {link.label}
            </A>
          )}
        </For>
        <div class="app-search-wrap">
          <input ref={searchInputEl} id="app-search-input" type="text" placeholder="Look up any game…" autocomplete="off" />
          <div id="app-search-results" class="game-search-results" hidden />
        </div>
        <AccountChip />
        <details class="site-nav-prefs site-nav-popover" ref={prefsDetailsEl}>
          <summary class="site-nav-link site-nav-prefs-btn" aria-label="Preferences">⚙</summary>
          {/* eslint-disable-next-line solid/no-innerhtml -- prefsPopoverPanelHtml() is this app's
              own static markup for the popover's contents (prefsPopover.ts, which then wires the
              region <select> up imperatively); no external input reaches it. */}
          <div ref={prefsWrapEl} innerHTML={prefsPopoverPanelHtml()} />
        </details>
      </nav>

      <div class="app-body">
        <main class="app-content">{props.children}</main>

        {/* Docked, not modal — role="complementary" rather than "dialog"/aria-modal, since the
            rest of the page stays fully interactive while this is open (see panel.tsx's own
            comment and docs/list-centric-redesign.md). */}
        <div id="game-panel" class="game-panel" role="complementary" aria-labelledby="panel-title">
          <button id="panel-close" class="panel-close" aria-label="Close">×</button>
          <div id="panel-nav" class="panel-nav" />
          <div id="panel-body" class="panel-body" />
        </div>
      </div>

      <footer class="app-footer">Press <kbd>?</kbd> for keyboard shortcuts</footer>
      <ShortcutsModal open={shortcutsOpen()} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
