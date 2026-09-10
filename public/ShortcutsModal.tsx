// The `?` keyboard-shortcuts dialog. Rendered once by AppShell (not per route), so every route
// gets it for free — the deleted pages each carried their own static copy of this markup in
// their own .html file plus imperative classList toggling, which is why it vanished entirely
// with them even though `panelKeyboard.ts` kept supporting the `shortcuts` option that drives
// it. The `.shortcuts-*`/`kbd` CSS it uses survived untouched in style.css.
//
// Open state lives in AppShell (it has to reach bindPanelKeyboardShortcuts' `shortcuts` option
// and the `?` key handler), so this component is pure presentation plus its two close paths.
import { For, type JSX } from 'solid-js';

interface Section {
  title: string;
  rows: { keys: string[]; label: string }[];
}

// Kept as data rather than inline markup so the list reads as the reference it is — and so a
// shortcut added to panelKeyboard.ts/lightbox.tsx has one obvious place to be documented.
export const SHORTCUT_SECTIONS: Section[] = [
  {
    title: 'Always',
    rows: [
      { keys: ['?'], label: 'Show / hide this dialog' },
      { keys: ['/'], label: 'Focus the game search box' },
      { keys: ['Esc'], label: 'Close panel or dialog' },
    ],
  },
  {
    title: 'Game panel',
    rows: [
      { keys: ['↑', '↓'], label: 'Previous / next game in the list' },
      { keys: ['←', '→'], label: 'Previous / next media' },
      { keys: ['R'], label: 'Pick a random game from the list' },
      { keys: ['Enter'], label: 'Open the focused table row' },
    ],
  },
  {
    title: 'Lightbox',
    rows: [
      { keys: ['←', '→'], label: 'Previous / next screenshot (seeks −5s / +5s instead while a video plays)' },
      { keys: ['Shift', '←', '→'], label: 'Previous / next screenshot, even during video playback' },
      { keys: ['↑', '↓'], label: 'Previous / next game' },
      { keys: ['R'], label: 'Pick a random game from the list' },
      { keys: ['F'], label: 'Toggle fullscreen' },
      { keys: ['Space'], label: 'Play / pause video' },
      { keys: ['M'], label: 'Mute / unmute video' },
      { keys: ['Esc'], label: 'Close lightbox' },
    ],
  },
];

export function ShortcutsModal(props: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <>
      <div class={`shortcuts-backdrop${props.open ? ' open' : ''}`} onClick={() => props.onClose()} />
      <div
        class={`shortcuts-modal${props.open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        aria-hidden={props.open ? undefined : 'true'}
      >
        <div class="shortcuts-header">
          <span class="shortcuts-title">Keyboard shortcuts</span>
          <button type="button" class="shortcuts-close" aria-label="Close" onClick={() => props.onClose()}>×</button>
        </div>
        <div class="shortcuts-body">
          <For each={SHORTCUT_SECTIONS}>
            {section => (
              <div class="shortcuts-section">
                <div class="shortcuts-section-title">{section.title}</div>
                <For each={section.rows}>
                  {row => (
                    <div class="shortcuts-row">
                      <For each={row.keys}>{k => <kbd>{k}</kbd>}</For>
                      <span>{row.label}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
