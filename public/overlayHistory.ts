// One history entry per open overlay (the side panel, then the lightbox over it), so Back closes
// the innermost one instead of leaving the page. Stepping games or shots inside an overlay still
// only rewrites the URL (urlState.ts), so Back never walks through every game looked at.
// Entries are told apart by the `_depth` @solidjs/router stamps on each one (its index in the
// session history), which survives the router's own replace navigations — the `overlay` marker
// of ours beside it does not, so it only serves to reuse an entry.
// The entry an overlay closes back onto holds the address from when it opened, so a close rewrites
// it to the current one with the overlay stripped: a game stepped to in the lightbox stays open.
export type Overlay = 'panel' | 'lightbox';

// `toBase`: the given address with this overlay closed.
type ToBase = (url: Location | URL) => string;

const opened: { name: Overlay; depth: number; close: () => void; toBase: ToBase }[] = [];
// A self-close's landing entry and the address to give it, applied once Back lands there.
let landing: { depth: number; url: string } | null = null;
// The address of the entry Back just left. The Navigation API is the only way to read it, as
// popstate fires once the address has already changed; without it, a Back keeps the stale one.
let leftUrl: URL | null = null;
if ('navigation' in window) {
  navigation.addEventListener('currententrychange', (e) => {
    leftUrl = e.from.url ? new URL(e.from.url) : null;
  });
}

function currentDepth(): number {
  return (history.state as { _depth?: number } | null)?._depth ?? 0;
}

// A deep link arrives with the overlay already in the address, hence `toBase` for the entry below.
export function pushOverlayEntry(name: Overlay, close: () => void, toBase: ToBase): void {
  if (opened.some((o) => o.name === name)) return;
  // Back onto an entry pushed earlier (from a page a link led to, or across a reload) reopens the
  // overlay there: reuse that entry, or the page would need a second Back to leave.
  if ((history.state as { overlay?: Overlay } | null)?.overlay !== name) {
    const url = location.href;
    history.replaceState(history.state, '', toBase(location));
    history.pushState(history.state, '', url);
    // Stamped the way the router stamps its own pushes: the new entry is the last one.
    history.replaceState({ ...history.state, _depth: history.length - 1, overlay: name }, '');
  }
  opened.push({ name, depth: currentDepth(), close, toBase });
}

// The overlay closed itself (×, Esc, the backdrop): drop its entry, and any opened above it, so
// the next Back leaves the page rather than doing nothing visible. Not when the close comes from
// a navigation (a link out of the panel unmounts the route): stepping back would undo it. The
// router pushes the new page only after unmounting, hence checking on the next task.
export function popOverlayEntry(name: Overlay): void {
  const i = opened.findIndex((o) => o.name === name);
  if (i < 0) return;
  const below = opened[i].depth - 1;
  const top = opened[opened.length - 1].depth;
  const url = opened[i].toBase(location);
  opened.length = i;
  setTimeout(() => {
    if (currentDepth() !== top) return;
    landing = { depth: below, url };
    history.go(below - top);
  });
}

// Registered at import, before the router's own listener, so the router reads the rewritten address.
window.addEventListener('popstate', () => {
  const depth = currentDepth();
  let url = landing?.depth === depth ? landing.url : null;
  landing = null;
  while (opened.length && opened[opened.length - 1].depth > depth) {
    const o = opened.pop()!;
    url = leftUrl && o.depth - 1 === depth ? o.toBase(leftUrl) : null;
    o.close();
  }
  if (url) history.replaceState(history.state, '', url);
});
