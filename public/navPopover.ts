// Esc and placement for the nav popovers (⚙ Preferences, account chip, rank menu); the browser opens and dismisses them.
// Placed in JS: `.site-nav`'s flex-wrap moves a trigger with viewport width, off-screen for CSS anchoring (seen on a Galaxy S10).

export const POPOVER_MARGIN = 12;

// Right-align the panel to its trigger, then clamp within `[POPOVER_MARGIN, viewportWidth -
// width - POPOVER_MARGIN]` so it can never run off either edge regardless of where the trigger
// ended up. The outer `Math.max(maxLeft, POPOVER_MARGIN)` matters for a panel wider than the
// viewport itself: without it the clamp's own upper bound would fall below its lower one and push
// the panel off the left. Pure and exported for unit testing — the off-screen case above is the
// whole reason this positioning is in JS at all.
export function clampPopoverLeft(triggerRight: number, panelWidth: number, viewportWidth: number): number {
  const maxLeft = viewportWidth - panelWidth - POPOVER_MARGIN;
  return Math.min(Math.max(triggerRight - panelWidth, POPOVER_MARGIN), Math.max(maxLeft, POPOVER_MARGIN));
}

function positionPanel(trigger: HTMLElement, panel: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const panelWidth = panel.getBoundingClientRect().width;
  panel.style.left = `${clampPopoverLeft(triggerRect.right, panelWidth, window.innerWidth)}px`;
  panel.style.top = `${triggerRect.bottom + 4}px`;
}

// Binds one trigger/panel pair. Returns a cleanup that removes every listener — the shell's
// own popovers live as long as the app does, but a popover rendered inside a component (the
// account chip) has to be able to unbind with it.
export function bindNavPopover(trigger: HTMLElement, panel: HTMLElement): () => void {
  const isOpen = () => panel.matches(':popover-open');
  const reposition = () => {
    if (isOpen()) positionPanel(trigger, panel);
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    panel.hidePopover();
    e.preventDefault(); // the page's own Esc (closing the panel, leaving /rank) skips a handled one
  };
  // Window capture: ahead of every document-level Esc handler, RankRoute's capture-phase one included.
  window.addEventListener('keydown', onKeydown, true);
  panel.addEventListener('toggle', reposition);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  return () => {
    window.removeEventListener('keydown', onKeydown, true);
    panel.removeEventListener('toggle', reposition);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  };
}
