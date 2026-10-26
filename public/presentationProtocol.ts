// What the main window (presentation.ts) and the presentation window (PresentationView.tsx) say to each other.
import type { MediaItem } from './mediaItems.ts';

export const PRESENTATION_CHANNEL = 'playshelf-presentation';
export const HEARTBEAT_MS = 5000;

export interface OnAir {
  appid: number;
  name: string;
  item: MediaItem;
  // Which media of the game it is, shown and read out: "Screenshot 3 / 12", "Screenshot 3 of 12".
  label: string;
  spoken: string;
  // A trailer handed over from the lightbox: where it was, and whether it was paused. Optional: a
  // window opened before they existed still takes the message.
  startAt?: number;
  paused?: boolean;
}
// The host's remote control (the nav chip). `seekBy` is applied to the TV's own position, so presses add up.
export type Control =
  'play' | 'pause' | 'replay' | 'mute' | 'unmute' | 'retry' | { seekBy: number } | { seekTo: number };
// What the window reports of it. `needsClick`: an unmute it refused — Chrome pauses a video unmuted
// before the window's own first click, so sound waits for one there.
export interface Playback {
  paused: boolean;
  muted: boolean;
  t: number;
  dur: number;
  ended: boolean;
  failed: boolean;
  needsClick: boolean;
  buffering: boolean;
}

// `bye`: the main window is going (closed, or reloading: then `main` follows).
export type ToPresentation = { main: string } & (
  | { type: 'onAir'; onAir: OnAir }
  | { type: 'control'; control: Control }
  | { type: 'close' }
  | { type: 'main' }
  | { type: 'bye' }
);
// `state` is the heartbeat, echoing what the window shows; `hidden` (occluded or minimized) means its
// timers are throttled, beating about once a minute.
export type FromPresentationBody =
  | { type: 'hello' }
  | { type: 'state'; onAir: OnAir | null; hidden?: boolean }
  | { type: 'playback'; playback: Playback }
  // A host steering from the TV (its focus stays there after its first click): the lightbox's stepping keys.
  | { type: 'key'; key: string; up: boolean }
  | { type: 'bye' };
export type FromPresentation = { main: string } & FromPresentationBody;
