// The app-wide keyboard shortcuts around the game detail side panel, bound once by AppShell.
// `pickRandom`/`stepGame` delegate to the mounted route, which knows whether it has a list to page.
import { isLightboxOpen } from './lightbox.tsx';
import { isPanelOpen, panelClose, panelStepHero, presentHero } from './panel.tsx';
import { isTextEntry } from './utils.ts';

interface PanelKeyboardOptions {
  pickRandom: () => void;
  stepGame: (dir: 1 | -1) => boolean; // true if it actually stepped, so ↑/↓ only preventDefault then
  shortcuts: { isOpen: () => boolean; toggle: () => void; close: () => void };
  focusSearchInput: () => void;
}

export function bindPanelKeyboardShortcuts(opts: PanelKeyboardOptions): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return; // a popover or the search dropdown took it
      // Each dialog closes itself on its own `cancel`; this one mustn't also close the panel behind.
      if (isLightboxOpen()) return;
      if (opts.shortcuts.isOpen()) {
        opts.shortcuts.close();
        return;
      }
      panelClose(); // initPanel's onClose (AppShell) handles the URL/state cleanup
      return;
    }
    // Over the lightbox too: the shortcuts dialog stacks above it.
    if (e.key === '?') {
      e.preventDefault();
      opts.shortcuts.toggle();
      return;
    }
    // The lightbox owns the keyboard while open (its own arrows/Home/End/f/space/m, wired in
    // lightbox.tsx's own listener) — every other page-level shortcut below is blocked rather
    // than firing invisibly behind it.
    if (isLightboxOpen()) return;
    if (isTextEntry(document.activeElement)) return;
    if (e.key === '/') {
      e.preventDefault();
      opts.focusSearchInput();
      return;
    }
    // Also with no panel open: the quickest way into a list without the mouse.
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      opts.pickRandom();
      return;
    }
    if (!isPanelOpen()) return;
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      presentHero();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (opts.stepGame(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
  });
}
