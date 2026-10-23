// Esc and placement for the nav popovers (⚙ Preferences, account chip, rank menu, Home's tree rows); the browser opens and dismisses them.
// Placed in JS: `.site-nav`'s flex-wrap moves a trigger with viewport width, off-screen for CSS anchoring (seen on a Galaxy S10).

export const POPOVER_MARGIN = 16;

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

// Below the trigger, or above it when it would run past the viewport's bottom and fits there (a
// Home tree row's menu near the end of the page).
export function popoverTop(
  triggerTop: number,
  triggerBottom: number,
  panelHeight: number,
  viewportHeight: number,
): number {
  const below = triggerBottom + 4;
  const above = triggerTop - 4 - panelHeight;
  return below + panelHeight > viewportHeight - POPOVER_MARGIN && above >= POPOVER_MARGIN ? above : below;
}

function positionPanel(trigger: HTMLElement, panel: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const { width, height } = panel.getBoundingClientRect();
  panel.style.left = `${clampPopoverLeft(triggerRect.right, width, window.innerWidth)}px`;
  panel.style.top = `${popoverTop(triggerRect.top, triggerRect.bottom, height, window.innerHeight)}px`;
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
