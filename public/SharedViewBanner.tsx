import type { JSX } from 'solid-js';

// Shown while a table follows the layout of a 🔗 Share view link: it applies to this visit only,
// and view persistence stays paused until the viewer keeps it or goes back to their own.
export function SharedViewBanner(props: { onKeep: () => void; onDiscard: () => void }): JSX.Element {
  return (
    <div class="pref-unsaved-banner" role="status">
      This table uses a layout from a shared link — for this visit only.
      <button type="button" class="btn btn-ghost btn-sm" onClick={() => props.onKeep()}>
        Keep as my layout
      </button>
      <button type="button" class="btn btn-ghost btn-sm" onClick={() => props.onDiscard()}>
        Use my own
      </button>
    </div>
  );
}
