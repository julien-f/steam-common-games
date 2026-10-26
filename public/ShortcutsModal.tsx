// The `?` keyboard-shortcuts dialog. Rendered once by AppShell (not per route), so every route
// gets it for free — the deleted pages each carried their own static copy of this markup in
// their own .html file plus imperative classList toggling, which is why it vanished entirely
// with them even though `panelKeyboard.ts` kept supporting the `shortcuts` option that drives
// it. The `.shortcuts-*`/`kbd` CSS it uses survived untouched in style.css.
//
// Open state lives in AppShell (it has to reach bindPanelKeyboardShortcuts' `shortcuts` option
// and the `?` key handler), so this component is pure presentation plus its close paths.
import { createEffect, For, onCleanup, on, type JSX } from 'solid-js';
import X from 'lucide-solid/icons/x';
import Kbd from './Kbd.tsx';

interface Section {
  title: string;
  rows: { keys: string[]; label: string }[];
}

// Kept as data rather than inline markup so the list reads as the reference it is — and so a
// shortcut added to panelKeyboard.ts/lightbox.tsx has one obvious place to be documented.
const SHORTCUT_SECTIONS: Section[] = [
  {
    title: 'Always',
    rows: [
      { keys: ['?'], label: 'Show / hide this dialog' },
      { keys: ['/'], label: 'Focus the game search box' },
      { keys: ['Esc'], label: 'Close panel or dialog' },
      { keys: ['R'], label: 'Open a random game from the list' },
    ],
  },
  {
    title: 'Game panel',
    rows: [
      { keys: ['↑', '↓'], label: 'Previous / next game in the list' },
      { keys: ['←', '→'], label: 'Previous / next media' },
      { keys: ['Enter'], label: 'Open the focused table row, or the focused image in the lightbox' },
      { keys: ['P'], label: 'Present this media on a second screen (the nav chip then plays, pauses and stops it)' },
    ],
  },
  {
    title: 'Ranking (compare screen)',
    rows: [
      { keys: ['←', '→'], label: 'Prefer the left / right game (browses media instead while the panel is open)' },
      { keys: ['↓'], label: 'Tie' },
      { keys: ['S'], label: 'Skip — ask about this game later' },
      { keys: ['X', '←', '→'], label: 'Exclude the left / right game' },
      { keys: ['I', '←', '→'], label: 'Open the left / right game in the side panel' },
      { keys: ['Z'], label: 'Undo the last answer' },
      { keys: ['Esc'], label: 'Close the panel, else stop and go back to the list — progress is saved' },
    ],
  },
  {
    title: 'Lightbox',
    rows: [
      { keys: ['←', '→'], label: 'Previous / next media (pans a zoomed screenshot)' },
      { keys: ['Shift', '←', '→'], label: 'Seek the video −5s / +5s' },
      { keys: ['J', 'L'], label: 'Seek the video −10s / +10s' },
      { keys: ['↑', '↓'], label: 'Previous / next game' },
      { keys: ['R'], label: 'Pick a random game from the list' },
      { keys: ['F'], label: 'Toggle fullscreen' },
      { keys: ['Z'], label: 'Zoom the screenshot in / out' },
      { keys: ['Space'], label: 'Play / pause video' },
      { keys: ['M'], label: 'Mute / unmute video' },
      { keys: ['P'], label: 'Put it on the second screen, then steer it from here; again: browse privately' },
      { keys: ['Esc'], label: 'Zoom back out, else close the lightbox' },
    ],
  },
];

export function ShortcutsModal(props: { open: boolean; onClose: () => void }): JSX.Element {
  let dialogEl!: HTMLDialogElement;
  let closeEl!: HTMLButtonElement;
  let opener: HTMLElement | null = null;
  // A modal <dialog> lets Tab leave for the browser's UI, so it still wraps here. On the document:
  // a click on the dialog's text drops focus to <body>, past a listener on the dialog.
  const keepTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    closeEl.focus();
  };
  onCleanup(() => document.removeEventListener('keydown', keepTab));
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          opener = document.activeElement as HTMLElement | null;
          dialogEl.showModal();
          document.addEventListener('keydown', keepTab);
          closeEl.focus();
        } else {
          document.removeEventListener('keydown', keepTab);
          dialogEl.close();
          if (opener?.isConnected) opener.focus();
        }
      },
      { defer: true },
    ),
  );
  return (
    // A transparent full-viewport shell: the backdrop and the box inside it keep their own fades.
    <dialog
      class="shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      ref={dialogEl}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div class={`shortcuts-backdrop${props.open ? ' open' : ''}`} onClick={() => props.onClose()} />
      <div class={`shortcuts-modal${props.open ? ' open' : ''}`}>
        <div class="shortcuts-header">
          <h2 class="shortcuts-title" id="shortcuts-title">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            class="shortcuts-close"
            aria-label="Close"
            ref={closeEl}
            onClick={() => props.onClose()}
          >
            <X />
          </button>
        </div>
        <div class="shortcuts-body">
          <For each={SHORTCUT_SECTIONS}>
            {(section) => (
              <div class="shortcuts-section">
                <h3 class="shortcuts-section-title">{section.title}</h3>
                <dl>
                  <For each={section.rows}>
                    {(row) => (
                      <div class="shortcuts-row">
                        <dt class="shortcuts-keys">
                          <For each={row.keys}>{(k) => <Kbd k={k} />}</For>
                        </dt>
                        <dd>{row.label}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </div>
            )}
          </For>
        </div>
      </div>
    </dialog>
  );
}
