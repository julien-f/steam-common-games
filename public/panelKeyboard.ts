// Shared page-level keyboard-shortcut handler for the game detail side panel — extracted from
// app.tsx/library.tsx/bundles.tsx's own near-identical `document.addEventListener('keydown', ...)`
// handlers (Escape/lightbox-guard/`?`/input-focus-guard/`/`/hero-step/random-pick/list-step).
// `panelHandleEscape` (panel.tsx) is called directly rather than threaded through as an option —
// it's already the one piece of this shared verbatim by all three pages' own handlers before this
// extraction, so there's no page-specific variation to parameterize here.
//
// Genuine per-page differences stay options/callbacks rather than being unified away:
// - `shortcuts` (the `?`-toggled keyboard-shortcuts modal) is optional — bundles.tsx has none.
// - `focusSearchInput` (the `/` shortcut's target) is optional for the same reason.
// - `onEnterOnFocusedRow` (app.tsx-only: Enter on a focused table row opens its panel) is optional.
// - `pickRandom`/`stepGame` are callbacks each page defines itself (already self-guarding against
//   "nothing to randomize/step through" — e.g. a standalone lookup — the same way each page's own
//   `pickRandomGame`/`stepGameList`-based helpers already did before this extraction), rather than
//   this module trying to guess what "is there something to page through" means on every page.
//   `stepGame` returns whether it actually stepped, so ArrowUp/Down's `preventDefault()` stays
//   conditional on that — same idiom `panelStepHero`'s own boolean return already uses for
//   ArrowLeft/Right — rather than always firing even when there was nothing to step to.
import { panelHandleEscape } from './panel.tsx';

export interface PanelKeyboardOptions {
  isLightboxOpen: () => boolean;
  isPanelOpen: () => boolean;
  panelClose: () => void;
  panelStepHero: (dir: 1 | -1, opts: { wrap: boolean }) => boolean;
  pickRandom: () => void;
  stepGame: (dir: 1 | -1) => boolean; // true if it actually stepped — see the header comment above
  shortcuts?: { isOpen: () => boolean; toggle: () => void; close: () => void };
  focusSearchInput?: () => void;
  onEnterOnFocusedRow?: () => boolean; // return true once handled, to short-circuit like every other branch here
}

export function bindPanelKeyboardShortcuts(opts: PanelKeyboardOptions): void {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // panelHandleEscape owns the lightbox-close/fullscreen-guard logic shared by all three
      // pages — delegating here means none of them can independently drift from it the way
      // bundles.tsx once did (missing the lightbox-close branch entirely; see its own history).
      if (opts.isLightboxOpen()) { panelHandleEscape(); return; }
      if (opts.shortcuts?.isOpen()) { opts.shortcuts.close(); return; }
      opts.panelClose(); // onClose (see each page's own initPanel call) handles the URL/state cleanup
      return;
    }
    // The lightbox owns the keyboard while open (its own arrows/Home/End/f/space/m, wired in
    // lightbox.tsx's own listener) — every other page-level shortcut below is blocked rather
    // than firing invisibly behind it.
    if (opts.isLightboxOpen()) return;
    if (opts.shortcuts && e.key === '?') { e.preventDefault(); opts.shortcuts.toggle(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (opts.focusSearchInput && e.key === '/') { e.preventDefault(); opts.focusSearchInput(); return; }
    if (opts.onEnterOnFocusedRow && e.key === 'Enter' && opts.onEnterOnFocusedRow()) return;
    if (!opts.isPanelOpen()) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (opts.panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); opts.pickRandom(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (opts.stepGame(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
  });
}
