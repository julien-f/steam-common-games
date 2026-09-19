// A small "⧉ copy" button for JSX call sites, over clipboard.ts's copyText. The confirmation is
// a signal rather than clipboard.ts's own DOM-writing flash: inside a Solid component the label
// is Solid's to own, and a direct textContent write would be silently undone by any re-render.
import { createSignal, onCleanup, type JSX } from 'solid-js';
import { copyText, COPIED_MS } from './clipboard.ts';

export function CopyButton(props: { text: string; label?: string; title: string; class?: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  function copy(): void {
    copyText(props.text).then(ok => {
      if (!ok) return;
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), COPIED_MS);
    });
  }

  return (
    <button
      type="button"
      class={`copy-btn${copied() ? ' copy-btn--copied' : ''}${props.class ? ` ${props.class}` : ''}`}
      title={copied() ? 'Copied!' : props.title}
      aria-label={props.title}
      onClick={copy}
    >{copied() ? '✓' : (props.label ?? '⧉')}</button>
  );
}
