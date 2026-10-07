// One history entry per open overlay (the side panel, then the lightbox over it), so Back closes
// the innermost one instead of leaving the page. Stepping games or shots inside an overlay still
// only rewrites the URL (urlState.ts), so Back never walks through every game looked at.
// Entries are told apart by the `_depth` @solidjs/router stamps on each one (its index in the
// session history), which survives the router's own replace navigations — the `overlay` marker
// of ours beside it does not, so it only serves to reuse an entry.
export type Overlay = 'panel' | 'lightbox';

const opened: { name: Overlay; depth: number; close: () => void }[] = [];

function currentDepth(): number {
  return (history.state as { _depth?: number } | null)?._depth ?? 0;
}

// `baseUrl`: the page with this overlay closed, for the entry Back returns to — a deep link
// arrives with the overlay already in the address.
export function pushOverlayEntry(name: Overlay, close: () => void, baseUrl: string): void {
  if (opened.some((o) => o.name === name)) return;
  // Back onto an entry pushed earlier (from a page a link led to, or across a reload) reopens the
  // overlay there: reuse that entry, or the page would need a second Back to leave.
  if ((history.state as { overlay?: Overlay } | null)?.overlay !== name) {
    const url = location.href;
    history.replaceState(history.state, '', baseUrl);
    history.pushState(history.state, '', url);
    // Stamped the way the router stamps its own pushes: the new entry is the last one.
    history.replaceState({ ...history.state, _depth: history.length - 1, overlay: name }, '');
  }
  opened.push({ name, depth: currentDepth(), close });
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
  opened.length = i;
  setTimeout(() => {
    if (currentDepth() === top) history.go(below - top);
  });
}

window.addEventListener('popstate', () => {
  const depth = currentDepth();
  while (opened.length && opened[opened.length - 1].depth > depth) opened.pop()!.close();
});
