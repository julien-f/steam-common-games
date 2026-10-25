// What the main window (presentation.ts) and the presentation window (PresentationView.tsx) say to each other.
import type { MediaItem } from './mediaItems.ts';

export const PRESENTATION_CHANNEL = 'playshelf-presentation';
export const HEARTBEAT_MS = 5000;

export interface OnAir {
  appid: number;
  name: string;
  item: MediaItem;
}
export type ToPresentation = { main: string } & (
  { type: 'onAir'; onAir: OnAir } | { type: 'close' } | { type: 'main' }
);
// `state` is the heartbeat, echoing what the window shows.
export type FromPresentationBody = { type: 'hello' } | { type: 'state'; onAir: OnAir | null } | { type: 'bye' };
export type FromPresentation = { main: string } & FromPresentationBody;
