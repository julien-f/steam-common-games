// The persistent app shell — nav bar, ⚙ Preferences popover, global "look up any game" search,
// the shared side panel + lightbox (mounted once, not per-route) — passed as @solidjs/router's
// `root` (see AppRoot.tsx) so it wraps every route instead of remounting on each navigation.
// This is the app's one nav bar/shell now that the legacy pages (app.tsx/library.tsx/
// bundles.tsx) and the two modules that existed purely to bootstrap them per-page
// (pageShell.ts's `initPageShell`, and nav.tsx's own `initNav`/cross-page `<nav>`) are all
// deleted (Phase 7, see docs/list-centric-redesign.md) — this file's own ⚙ Preferences popover
// open/close/position bindings below (`bindPrefsPopoverClose`/`bindPrefsPopoverPosition`) used
// to be a deliberate, temporary duplicate of nav.tsx's identically-named pair for exactly that
// transition period; now that nav.tsx is gone, these are just the one real implementation.
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
    bindPrefsPopoverClose();
    const stopPositioning = bindPrefsPopoverPosition();
    onCleanup(stopPositioning);
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
          <div id="app-search-results" class="game-search-results" hidden></div>
        </div>
        <details class="site-nav-prefs">
          <summary class="site-nav-link site-nav-prefs-btn" aria-label="Preferences">⚙</summary>
          <div innerHTML={prefsPopoverPanelHtml()} />
        </details>
      </nav>

      <div class="app-body">
        <main class="app-content">{props.children}</main>

        {/* Docked, not modal — role="complementary" rather than "dialog"/aria-modal, since the
            rest of the page stays fully interactive while this is open (see panel.tsx's own
            comment and docs/list-centric-redesign.md). */}
        <div id="game-panel" class="game-panel" role="complementary" aria-labelledby="panel-title">
          <button id="panel-close" class="panel-close" aria-label="Close">×</button>
          <div id="panel-nav" class="panel-nav"></div>
          <div id="panel-body" class="panel-body"></div>
        </div>
      </div>

      <footer class="app-footer">Press <kbd>?</kbd> for keyboard shortcuts</footer>
      <ShortcutsModal open={shortcutsOpen()} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

// `<details>` has no built-in "close on outside click/Escape", so it's added by hand; the panel
// is anchored to the ⚙ button's own live position (`position: fixed`, computed here) rather
// than a CSS-only anchor, since `.site-nav`'s flex-wrap re-centers its items as a group once
// they wrap onto more than one line, which a CSS-only anchor can't reliably follow — confirmed
// live on a real Galaxy S10 (Firefox) as the panel running off-screen to the left before this
// fix, not just in an emulated-width check (this reasoning, and both functions themselves,
// used to also exist as a separate, deliberately duplicated copy in the now-deleted nav.tsx,
// back when the legacy pages still needed its own nav bar's identical popover to work the same
// way during the transition — see this file's own top-of-file comment).
function bindPrefsPopoverClose(): void {
  const details = document.querySelector('.site-nav-prefs') as HTMLDetailsElement;
  const onClick = (e: MouseEvent) => {
    if (details.open && !details.contains(e.target as Node)) details.open = false;
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && details.open) details.open = false;
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
}

const PREFS_PANEL_MARGIN = 12;
function positionPrefsPanel(details: HTMLDetailsElement, panel: HTMLElement): void {
  const btnRect = details.querySelector('summary')!.getBoundingClientRect();
  const panelWidth = panel.getBoundingClientRect().width;
  const maxLeft = window.innerWidth - panelWidth - PREFS_PANEL_MARGIN;
  const left = Math.min(Math.max(btnRect.right - panelWidth, PREFS_PANEL_MARGIN), Math.max(maxLeft, PREFS_PANEL_MARGIN));
  panel.style.left = `${left}px`;
  panel.style.top = `${btnRect.bottom + 4}px`;
}

function bindPrefsPopoverPosition(): () => void {
  const details = document.querySelector('.site-nav-prefs') as HTMLDetailsElement;
  const panel = document.querySelector('.site-nav-prefs-panel') as HTMLElement;
  const reposition = () => { if (details.open) positionPrefsPanel(details, panel); };
  details.addEventListener('toggle', reposition);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  return () => {
    details.removeEventListener('toggle', reposition);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  };
}
