// A key cap. Its arrows draw as Lucide icons, one size on every platform: system faces lack some or draw
// ← → far smaller than ↑ ↓ (docs/dev/ui-guidelines.md, Type). The glyph stays as hidden text.
import { For, type JSX } from 'solid-js';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import ArrowRight from 'lucide-solid/icons/arrow-right';
import ArrowUp from 'lucide-solid/icons/arrow-up';
import ArrowDown from 'lucide-solid/icons/arrow-down';

const ARROWS = new Map<string, () => JSX.Element>([
  ['←', () => <ArrowLeft />],
  ['→', () => <ArrowRight />],
  ['↑', () => <ArrowUp />],
  ['↓', () => <ArrowDown />],
]);

export default function Kbd(props: { k: string }): JSX.Element {
  return (
    <kbd>
      <For each={props.k.split(/([←→↑↓])/).filter(Boolean)}>
        {(part) => {
          const icon = ARROWS.get(part);
          return icon ? (
            <>
              {icon()}
              <span class="visually-hidden">{part}</span>
            </>
          ) : (
            part
          );
        }}
      </For>
    </kbd>
  );
}
