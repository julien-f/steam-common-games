// Shared page bootstrap — the one order-dependent sequence every page (app.js/library.js/
// bundles.js) repeats: nav bar, then lightbox, then the game detail side panel. Nothing about
// this order is optional — panel.js's own options (onNavigateGame, etc.) assume the lightbox is
// already wired, and the nav bar has no dependency on either, so it goes first for consistency.
// Kept intentionally thin: URL restore/popstate and each page's own keydown handling stay local
// (real per-page differences — different data models, different extra shortcuts), this only
// removes the chance of the *sequencing itself* silently drifting between pages, the way
// bundles.js's `initNav('bundles')` call once being deferred to the end of its own init() (after
// data fetch) rather than up front was an accidental, meaningless difference from the other two
// pages.
import { initNav } from './nav.js';
import { initLightbox } from './lightbox.js';
import { initPanel } from './panel.js';

// `page`: the nav bar's current-page key ('compare' | 'library' | 'bundles' | 'about').
// `lightbox`/`panel`: passed straight through to initLightbox/initPanel.
export function initPageShell({ page, lightbox, panel }) {
  initNav(page);
  initLightbox(lightbox);
  initPanel(panel);
}
