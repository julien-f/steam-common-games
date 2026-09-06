// The persistent app shell — nav bar, ⚙ Preferences popover, global "look up any game" search,
// the shared side panel + lightbox (mounted once, not per-route) — passed as @solidjs/router's
// `root` (see AppRoot.tsx) so it wraps every route instead of remounting on each navigation. This
// replaces pageShell.ts's per-page `initPageShell({page, lightbox, panel})` call, which the
// legacy pages (app.tsx/library.tsx/bundles.tsx) still use unchanged until they're deleted (see
// docs/list-centric-redesign.md's implementation plan, Phase 7) — pageShell.ts itself is left
// alone for now rather than touched, since retiring it only makes sense once nothing still
// calls it.
//
// nav.tsx (the legacy pages' own nav bar) is also left untouched here rather than reworked in
// place — this shell needs a genuinely different (router-aware `<A>`-based) nav, and rewriting
// nav.tsx's exports out from under four still-live pages would break them well before they're
// due to be deleted. The ⚙ Preferences popover's outside-click/position bindings below are
// necessarily a second, temporary copy of nav.tsx's own bindPrefsPopoverClose/
// bindPrefsPopoverPosition for exactly that reason — consolidate the two once nav.tsx is
// deleted in Phase 7.
import { onMount, onCleanup, For, type JSX } from 'solid-js';
import { A, useNavigate, type RouteSectionProps } from '@solidjs/router';
import { prefsPopoverPanelHtml, initPrefsPopover } from './prefsPopover.ts';
import { initLightbox, isLightboxOpen } from './lightbox.tsx';
import { initPanel, isPanelOpen, panelClose, panelStepHero } from './panel.tsx';
import { bindPanelKeyboardShortcuts } from './panelKeyboard.ts';
import { initGameSearch } from './gameSearch.ts';
import { addRecentGame, renderRecentGamesBar, bindRecentGamesBar } from './recentGames.ts';

// Route-specific keyboard behavior (pickRandom/stepGame/onEnterOnFocusedRow) can't be hardcoded
// at the shell level — different routes have different "list" contexts, or none at all (Home,
// About, the Bundles browse screen). Each mounted route registers its own handlers here; the
// shell's one bindPanelKeyboardShortcuts call below always delegates through this indirection,
// defaulting to a no-op when nothing is registered rather than each route needing to rebind the
// whole document-level keydown listener itself.
interface RouteKeyboardHandlers {
  pickRandom?: () => void;
  stepGame?: (dir: 1 | -1) => boolean;
  onEnterOnFocusedRow?: () => boolean;
}
let routeKeyboardHandlers: RouteKeyboardHandlers = {};
export function registerRouteKeyboardHandlers(handlers: RouteKeyboardHandlers): () => void {
  routeKeyboardHandlers = handlers;
  return () => { routeKeyboardHandlers = {}; };
}

const NAV_LINKS: { href: string; label: string; end?: boolean }[] = [
  { href: '/', label: 'Home', end: true },
  { href: '/bundles', label: 'Bundles' },
  { href: '/about', label: 'About' },
];

export function AppShell(props: RouteSectionProps): JSX.Element {
  let searchInputEl!: HTMLInputElement;
  const navigate = useNavigate();

  onMount(() => {
    initLightbox({});
    // inertSelector still applies here (Phase 3 removes it along with the rest of the panel's
    // modal mechanics — see the implementation plan) — `.app-content` is this shell's
    // equivalent of each legacy page's own root container class.
    initPanel({
      inertSelector: '.app-content',
      onNavigateGame: (appid: number) => navigate(`/game/${appid}`),
    });
    initGameSearch({
      inputEl: searchInputEl,
      resultsEl: document.getElementById('app-search-results') as HTMLElement,
      onSelect: game => {
        addRecentGame(game.appid, game.name, game.tinyImage);
        renderRecentGamesBar(document.getElementById('app-recent-games')!);
        navigate(`/game/${game.appid}`);
      },
    });
    renderRecentGamesBar(document.getElementById('app-recent-games')!);
    bindRecentGamesBar(document.getElementById('app-recent-games')!, appid => navigate(`/game/${appid}`));

    bindPanelKeyboardShortcuts({
      isLightboxOpen,
      isPanelOpen,
      panelClose,
      panelStepHero,
      pickRandom: () => routeKeyboardHandlers.pickRandom?.(),
      stepGame: dir => routeKeyboardHandlers.stepGame?.(dir) ?? false,
      focusSearchInput: () => searchInputEl.focus(),
      onEnterOnFocusedRow: () => routeKeyboardHandlers.onEnterOnFocusedRow?.() ?? false,
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
            <A href={link.href} end={link.end} class="site-nav-link" activeClass="active">
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
      <div id="app-recent-games" class="recents-bar" hidden></div>

      <main class="app-content">{props.children}</main>

      <div id="panel-backdrop" class="panel-backdrop"></div>
      <div id="game-panel" class="game-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <button id="panel-close" class="panel-close" aria-label="Close">×</button>
        <div id="panel-nav" class="panel-nav"></div>
        <div id="panel-body" class="panel-body"></div>
      </div>
    </div>
  );
}

// Same two small helpers as nav.tsx's own bindPrefsPopoverClose/bindPrefsPopoverPosition —
// `<details>` has no built-in "close on outside click/Escape", and the panel is anchored to the
// ⚙ button's own live position rather than a CSS-only anchor (see nav.tsx's own comment for why:
// `.site-nav`'s flex-wrap re-centers on wrap, which a CSS-only anchor can't reliably follow).
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
