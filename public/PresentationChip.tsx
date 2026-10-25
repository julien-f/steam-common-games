// In the site nav while presenting (presentation.ts): the game shown, and × to stop.
import { Show, type JSX } from 'solid-js';
import Cast from 'lucide-solid/icons/cast';
import X from 'lucide-solid/icons/x';
import { presented, stopPresenting } from './presentation.ts';

export function PresentationChip(): JSX.Element {
  return (
    <Show when={presented()}>
      {(onAir) => (
        <div class="present-chip">
          <Cast class="present-chip-icon" aria-hidden="true" />
          <span class="present-chip-name">{onAir().name}</span>
          <button
            type="button"
            class="present-chip-btn"
            aria-label="Stop presenting"
            title="Stop presenting"
            onClick={stopPresenting}
          >
            <X />
          </button>
        </div>
      )}
    </Show>
  );
}
