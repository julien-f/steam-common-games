// What the main window (presentation.ts) and the presentation window (PresentationView.tsx) say to each other.
import type { MediaItem } from './mediaItems.ts';

export const PRESENTATION_CHANNEL = 'playshelf-presentation';
export const HEARTBEAT_MS = 5000;

export interface OnAir {
  appid: number;
  name: string;
  item: MediaItem;
  // A trailer handed over from the lightbox: where it was, and whether it was paused. Optional: a
  // window opened before they existed still takes the message.
  startAt?: number;
  paused?: boolean;
}
// `bye`: the main window is going (closed, or reloading: then `main` follows).
export type ToPresentation = { main: string } & (
  { type: 'onAir'; onAir: OnAir } | { type: 'close' } | { type: 'main' } | { type: 'bye' }
);
// `state` is the heartbeat, echoing what the window shows; `hidden` (occluded or minimized) means its
// timers are throttled, beating about once a minute.
export type FromPresentationBody =
  { type: 'hello' } | { type: 'state'; onAir: OnAir | null; hidden?: boolean } | { type: 'bye' };
export type FromPresentation = { main: string } & FromPresentationBody;
