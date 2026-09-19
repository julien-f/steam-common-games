// The one-time "this browser and your Steam account both already have saved data — which one do
// you want to keep?" prompt, shown the first time a browser signs in as an account that already
// has server-side prefs of its own (see authStore.ts's reconcilePrefsOnFirstLogin). Mounted once
// by AppShell, same "plain module + window event, subscriber owns the signal" shape as every
// other cross-cutting store here — the prompt can open at any time, from an async auth check
// with no route/component of its own to live in.
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { DATA_CHOICE_EVENT, getPendingDataChoice, chooseDataSource } from './authStore.ts';

export function DataChoiceModal(): JSX.Element {
  const [prompt, setPrompt] = createSignal(getPendingDataChoice());
  const refresh = () => setPrompt(getPendingDataChoice());
  window.addEventListener(DATA_CHOICE_EVENT, refresh);
  onCleanup(() => window.removeEventListener(DATA_CHOICE_EVENT, refresh));

  const open = () => prompt() !== null;

  return (
    <>
      <div class={`data-choice-backdrop${open() ? ' open' : ''}`} />
      <div
        class={`data-choice-modal${open() ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Choose which saved data to keep"
        aria-hidden={open() ? undefined : 'true'}
      >
        <div class="data-choice-header">
          <span class="data-choice-title">Which saved data do you want to keep?</span>
        </div>
        <div class="data-choice-body">
          <p>
            This browser and your Steam account both already have saved accounts/lists/settings.
            Pick one to keep — the other will be replaced.
          </p>
          <Show when={prompt()}>
            {p => (
              <div class="data-choice-actions">
                <button type="button" class="data-choice-action" onClick={() => chooseDataSource(false)}>
                  Use this browser's data ({p().localCount} saved {p().localCount === 1 ? 'item' : 'items'})
                </button>
                <button type="button" class="data-choice-action" onClick={() => chooseDataSource(true)}>
                  Use my Steam account's data ({p().serverCount} saved {p().serverCount === 1 ? 'item' : 'items'})
                </button>
              </div>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}
