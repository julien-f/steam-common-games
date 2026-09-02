import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { prefsPopoverPanelHtml, initPrefsPopover } from './prefsPopover.ts';

export type NavPageKey = 'compare' | 'library' | 'bundles' | 'about';

// Shared cross-page navigation bar — one component (`#site-nav`, present as an empty <nav> in
// every page's markup) instead of each page hand-rolling its own header corner links plus a
// second, differently-worded footer link row. An ES module, importing from prefsPopover.js
// (needed for the Preferences popover below) — used on all four pages; about.html has no
// page-specific JS of its own, so importing `initNav` from this file (which pulls in
// prefsPopover.js/region.js/prefs.js in turn, solely for this file's own popover) is all it
// loads.
//
// Converted to a real Solid component (`initNav`/`updateNavLink`
// keep their exact old plain-function signatures — no changes needed on any of the four host
// pages beyond the `.ts` → `.tsx` import path, same "thin surface, host pages untouched"
// convention `panelMount.ts`/`lightboxMount.ts` already established). `prefsPopover.ts` itself
// stays plain TS/untouched — its `prefsPopoverPanelHtml()` still returns a raw HTML string,
// spliced in below via Solid's own `innerHTML` prop rather than converting that file too; a
// `<select>` populated once from a static option list has no real list/conditional shape worth a
// JSX rewrite on its own.
const NAV_PAGES: { key: NavPageKey; href: string; label: string }[] = [
  { key: 'compare', href: '/', label: 'Comparison' },
  { key: 'library', href: '/library.html', label: 'Library Explorer' },
  { key: 'bundles', href: '/bundles.html', label: 'Bundles' },
  { key: 'about', href: '/about.html', label: 'About' },
];

// `updateNavLink` (below) used to mutate a rendered <a>'s `.href` directly via `querySelector`;
// now it just writes this signal, and the <a>'s own `href` attribute reads it reactively — no
// direct DOM poke needed, and it can never race a re-render the way a raw mutation could.
const [hrefOverrides, setHrefOverrides] = createSignal<Partial<Record<NavPageKey, string>>>({});

// `current` is the active page's key. Every other page renders as a plain link (a static href
// by default — see updateNavLink below for the two that carry state); the active page itself
// renders as a non-clickable label (there's nothing useful a link to the current page would do)
// marked `aria-current="page"`.
//
// A ⚙ "Preferences" popover sits at the end of the same bar — a place to manage a preference
// independent of whatever page happens to be open, rather than each page needing its own UI for
// it (this replaced Bundles' and the Wishlist tab's own inline region pickers). This file owns
// only the popover's shell — the `<details>`/`<summary>` toggle and its open/close mechanics —
// what's actually inside the panel (today, just region) is prefsPopover.js's job, so this file
// stays about page navigation regardless of how many preferences land in that panel later.
export function initNav(current: NavPageKey) {
  const el = document.getElementById('site-nav');
  if (!el) return;
  render(() => (
    <>
      <For each={NAV_PAGES}>
        {p => p.key === current
          ? <span class="site-nav-link active" aria-current="page">{p.label}</span>
          : <a class="site-nav-link" data-nav-key={p.key} href={hrefOverrides()[p.key] ?? p.href}>{p.label}</a>
        }
      </For>
      <details class="site-nav-prefs">
        <summary class="site-nav-link site-nav-prefs-btn" aria-label="Preferences">⚙</summary>
        <div innerHTML={prefsPopoverPanelHtml()} />
      </details>
    </>
  ), el);
  // Both run synchronously right after render() returns — render() mounts its DOM tree
  // synchronously, so `#nav-region-select`/`.site-nav-prefs` already exist by this point, same
  // ordering the old innerHTML-then-wire-up version relied on.
  initPrefsPopover();
  bindPrefsPopoverClose();
}

// `<details>` has no built-in "close on outside click" or "close on Escape" — added by hand
// here since a popover that only closes by re-clicking its own summary reads as broken. Purely
// about the `<details>` shell's own toggle mechanics, so it stays here rather than in
// prefsPopover.js regardless of what ends up inside the panel.
function bindPrefsPopoverClose() {
  const details = document.querySelector('.site-nav-prefs') as HTMLDetailsElement;
  document.addEventListener('click', e => {
    if (details.open && !details.contains(e.target as Node)) details.open = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && details.open) details.open = false;
  });
}

// Repoints one nav link's href — backs the Comparison <-> Library Explorer links carrying the
// currently-loaded player along (see updateLibraryExplorerLink in app.js / updateBackLink in
// library.js), so following the link keeps showing that player instead of landing on a bare
// empty page. A no-op if that link isn't rendered on the current page (e.g. `library` on the
// Comparison page itself, where it's the active label, not a link — `hrefOverrides` is simply
// never read for it) or `#site-nav`/`initNav` hasn't run at all.
export function updateNavLink(key: NavPageKey, href: string) {
  setHrefOverrides(prev => ({ ...prev, [key]: href }));
}
