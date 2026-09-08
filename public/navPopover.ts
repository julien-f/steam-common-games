// Open/close + positioning mechanics for the nav bar's `<details>` popovers — the ⚙ Preferences
// panel (AppShell.tsx) and the account chip's own (AccountChip.tsx).
//
// `<details>` gives a free, accessible toggle, but has no built-in "close on outside click" or
// "close on Escape", so both are added by hand; and the panel can't be anchored in CSS alone.
// `.site-nav`'s flex-wrap re-centers its items as a group once they wrap onto more than one
// line, so a trigger's own x-position shifts with viewport width in a way a CSS-only anchor
// can't follow — confirmed live on a real Galaxy S10 (Firefox) as the ⚙ panel running off-screen
// to the left. So the panel is `position: fixed`, anchored to its own trigger's live position and
// clamped inside the viewport, recomputed on every toggle/resize/scroll while it's open.
//
// One implementation rather than one per popover: this used to be AppShell.tsx's own
// `bindPrefsPopoverClose`/`bindPrefsPopoverPosition` pair (itself once a deliberate duplicate of
// the now-deleted nav.tsx's identically-named pair), hardcoded to `.site-nav-prefs`'s selectors.
// A second popover needing the same behavior is exactly the point at which that becomes two
// copies free to drift apart.

export const POPOVER_MARGIN = 12;

// Right-align the panel to its trigger, then clamp within `[margin, viewportWidth - width -
// margin]` so it can never run off either edge regardless of where the trigger ended up. The
// outer `Math.max(maxLeft, margin)` matters for a panel wider than the viewport itself: without
// it the clamp's own upper bound would fall below its lower one and push the panel off the left.
// Pure and exported for unit testing — the off-screen case above is the whole reason this
// positioning is in JS at all.
export function clampPopoverLeft(triggerRight: number, panelWidth: number, viewportWidth: number, margin = POPOVER_MARGIN): number {
  const maxLeft = viewportWidth - panelWidth - margin;
  return Math.min(Math.max(triggerRight - panelWidth, margin), Math.max(maxLeft, margin));
}

function positionPanel(details: HTMLDetailsElement, panel: HTMLElement): void {
  const triggerRect = details.querySelector('summary')!.getBoundingClientRect();
  const panelWidth = panel.getBoundingClientRect().width;
  panel.style.left = `${clampPopoverLeft(triggerRect.right, panelWidth, window.innerWidth)}px`;
  panel.style.top = `${triggerRect.bottom + 4}px`;
}

// Binds one `<details>`/panel pair. Returns a cleanup that removes every listener — the shell's
// own popovers live as long as the app does, but a popover rendered inside a component (the
// account chip) has to be able to unbind with it.
export function bindNavPopover(details: HTMLDetailsElement, panel: HTMLElement): () => void {
  const reposition = () => { if (details.open) positionPanel(details, panel); };
  const onClick = (e: MouseEvent) => {
    if (details.open && !details.contains(e.target as Node)) details.open = false;
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && details.open) details.open = false;
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  details.addEventListener('toggle', reposition);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  return () => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    details.removeEventListener('toggle', reposition);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  };
}
