'use strict';

// Shared cross-page navigation bar — one component (`#site-nav`, present as an empty <nav> in
// every page's markup) instead of each page hand-rolling its own header corner links plus a
// second, differently-worded footer link row. Loaded as a plain script (not a module) on all
// four pages, after prefs.js/region.js (needed for the Preferences popover below), same
// convention as urlState.js/utils.js — about.html has no page-specific JS of its own, so this
// (plus prefs.js/region.js, loaded solely for this file's own popover) is all it loads.
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
// it (see the region control below, which replaced Bundles' and the Wishlist tab's own inline
// pickers). Only region lives here today; more preferences are expected to land in this same
// popover later rather than each needing a new place of its own.
function initNav(current) {
  const el = document.getElementById('site-nav');
  if (!el) return;
  el.innerHTML = NAV_PAGES.map(p => p.key === current
    ? `<span class="site-nav-link active" aria-current="page">${p.label}</span>`
    : `<a class="site-nav-link" data-nav-key="${p.key}" href="${p.href}">${p.label}</a>`
  ).join('') + `
    <details class="site-nav-prefs">
      <summary class="site-nav-link site-nav-prefs-btn" aria-label="Preferences">⚙</summary>
      <div class="site-nav-prefs-panel">
        <label class="site-nav-prefs-row">Region
          <select id="nav-region-select"></select>
        </label>
      </div>
    </details>
  `;
  initNavPrefs();
}

// Populates the region select and wires it to the shared region preference (region.js) — the
// one place it's picked now. `setStoredRegion` broadcasts `REGION_CHANGED_EVENT` on every
// change regardless of which UI made it, so this popover doesn't need to know anything about
// Bundles/library.js reacting to it (see their own comments).
//
// `<details>` has no built-in "close on outside click" or "close on Escape" — added by hand
// here since a popover that only closes by re-clicking its own summary reads as broken.
function initNavPrefs() {
  const details = document.querySelector('.site-nav-prefs');
  const select = document.getElementById('nav-region-select');
  initRegionSelect(select);
  select.addEventListener('change', () => setStoredRegion(select.value));
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
function updateNavLink(key, href) {
  const link = document.querySelector(`#site-nav a[data-nav-key="${key}"]`);
  if (link) link.href = href;
}
