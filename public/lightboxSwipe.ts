'use strict';

// The lightbox's touch-swipe decisions, split out of `lightbox.tsx` for the same reason
// `lightboxTime.ts` and `compareSlots.ts` are: it's the part worth testing, and it needs
// neither a DOM nor a store. The handler in `lightbox.tsx` keeps only the DOM work —
// tracking the finger, moving the media element, and running the resolved action.

export type SwipeAxis = 'x' | 'y';
export type SwipeAction = 'media-prev' | 'media-next' | 'game-prev' | 'game-next';

// Past this the gesture is a drag, not a tap — and the axis it locks onto is final. Matches
// the lightbox's own tap threshold, so a gesture is never both.
export const LB_SWIPE_AXIS_LOCK = 10;
export const LB_SWIPE_X_DISTANCE = 50;
export const LB_SWIPE_Y_DISTANCE = 80;
// A short flick commits below the distance thresholds — the intent is just as clear.
export const LB_SWIPE_FLICK_DISTANCE = 25;
export const LB_SWIPE_FLICK_MS = 250;
// Applied to the follow-the-finger offset when the axis has nothing to step to, so the drag
// reads as resistance rather than as a step that silently didn't happen.
export const LB_SWIPE_RESISTANCE = 0.35;

// Same bias as panel.tsx's own swipes: a gesture has to be clearly more horizontal than
// vertical to page media, since vertical is the one that changes game.
export function decideSwipeAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.abs(dx) < LB_SWIPE_AXIS_LOCK && Math.abs(dy) < LB_SWIPE_AXIS_LOCK) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
}

// `mediaCount`/`hasGameList`: what there is to step to on each axis — a lone screenshot or a
// standalone lookup with no list behind it resolves to null, and the caller snaps back.
export function resolveSwipe({ axis, dx, dy, dt, mediaCount, hasGameList }: {
  axis: SwipeAxis;
  dx: number;
  dy: number;
  dt: number;
  mediaCount: number;
  hasGameList: boolean;
}): SwipeAction | null {
  const delta = axis === 'x' ? dx : dy;
  const distance = Math.abs(delta);
  const committed = distance >= (axis === 'x' ? LB_SWIPE_X_DISTANCE : LB_SWIPE_Y_DISTANCE) ||
    (distance >= LB_SWIPE_FLICK_DISTANCE && dt <= LB_SWIPE_FLICK_MS);
  if (!committed) return null;
  if (axis === 'x') return mediaCount > 1 ? (delta < 0 ? 'media-next' : 'media-prev') : null;
  // Content follows the finger, feed-style: dragging up brings the next game up from below.
  return hasGameList ? (delta < 0 ? 'game-next' : 'game-prev') : null;
}
