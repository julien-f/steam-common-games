// One polite status line for the whole app: what screen readers hear of a change shown only visually
// (a copy's ✓, what's presented on the second screen).
let liveRegion: HTMLElement | undefined;
export function announce(message: string): void {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
    document.body.append(liveRegion);
  }
  const region = liveRegion;
  // Emptied first so the same message twice in a row is announced again.
  region.textContent = '';
  setTimeout(() => (region.textContent = message), 100);
}
