'use strict';

// Shared cross-page navigation bar — one component (`#site-nav`, present as an empty <nav> in
// every page's markup) instead of each page hand-rolling its own header corner links plus a
// second, differently-worded footer link row. Loaded as a plain script (not a module) on all
// four pages, same convention as urlState.js/utils.js/region.js — about.html has no other JS
// at all, so this is its only script.
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
function initNav(current) {
  const el = document.getElementById('site-nav');
  if (!el) return;
  el.innerHTML = NAV_PAGES.map(p => p.key === current
    ? `<span class="site-nav-link active" aria-current="page">${p.label}</span>`
    : `<a class="site-nav-link" data-nav-key="${p.key}" href="${p.href}">${p.label}</a>`
  ).join('');
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
