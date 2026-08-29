'use strict';

import { prefsPopoverPanelHtml, initPrefsPopover } from './prefsPopover.js';

// Shared cross-page navigation bar — one component (`#site-nav`, present as an empty <nav> in
// every page's markup) instead of each page hand-rolling its own header corner links plus a
// second, differently-worded footer link row. Loaded as a plain script (not a module) on all
// four pages, after prefs.js/region.js/prefsPopover.js (needed for the Preferences popover
// below), same convention as urlState.js/utils.js — about.html has no page-specific JS of its
// own, so this (plus prefs.js/region.js/prefsPopover.js, loaded solely for this file's own
// popover) is all it loads.
const NAV_PAGES = [
  { key: 'compare', href: '/', label: 'Comparison' },
  { key: 'library', href: '/library.html', label: 'Library Explorer' },
  { key: 'bundles', href: '/bundles.html', label: 'Bundles' },
  { key: 'about', href: '/about.html', label: 'About' },
];

// `current` is the active page's key. Every other page renders as a plain link (a static href
// by default — see updateNavLink below for the two that carry state); the active page itself
// renders as a non-clickable label (there's nothing useful a link to the current page would do)
// marked `aria-current="page"`.
//
// A ⚙ "Preferences" popover sits at the end of the same bar — a place to manage a preference
// independent of whatever page happens to be open, rather than each page needing its own UI for
// it (this replaced Bundles' and the Wishlist tab's own inline region pickers). This file owns
// only the popover's shell — the `<details>`/`<summary>` toggle and its open/close mechanics;
// what's actually inside the panel (today, just region) is prefsPopover.js's job, so this file
// stays about page navigation regardless of how many preferences land in that panel later.
export function initNav(current) {
  const el = document.getElementById('site-nav');
  if (!el) return;
  el.innerHTML = NAV_PAGES.map(p => p.key === current
    ? `<span class="site-nav-link active" aria-current="page">${p.label}</span>`
    : `<a class="site-nav-link" data-nav-key="${p.key}" href="${p.href}">${p.label}</a>`
  ).join('') + `
    <details class="site-nav-prefs">
      <summary class="site-nav-link site-nav-prefs-btn" aria-label="Preferences">⚙</summary>
      ${prefsPopoverPanelHtml()}
    </details>
  `;
  initPrefsPopover();
  bindPrefsPopoverClose();
}

// `<details>` has no built-in "close on outside click" or "close on Escape" — added by hand
// here since a popover that only closes by re-clicking its own summary reads as broken. Purely
// about the `<details>` shell's own toggle mechanics, so it stays here rather than in
// prefsPopover.js regardless of what ends up inside the panel.
function bindPrefsPopoverClose() {
  const details = document.querySelector('.site-nav-prefs');
  document.addEventListener('click', e => {
    if (details.open && !details.contains(e.target)) details.open = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && details.open) details.open = false;
  });
}

// Repoints one nav link's href — backs the Comparison <-> Library Explorer links carrying the
// currently-loaded player along (see updateLibraryExplorerLink in app.js / updateBackLink in
// library.js), so following the link keeps showing that player instead of landing on a bare
// empty page. A no-op if that link isn't rendered on the current page (e.g. `library` on the
// Comparison page itself, where it's the active label, not a link) or `#site-nav` isn't in the
// page's markup at all.
export function updateNavLink(key, href) {
  const link = document.querySelector(`#site-nav a[data-nav-key="${key}"]`);
  if (link) link.href = href;
}
