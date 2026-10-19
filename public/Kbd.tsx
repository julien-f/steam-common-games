// A key cap. Its arrows draw as Lucide icons: Geist's self-hosted subset has ↑ ↓ but not ← →, which
// fall back to a system face drawn far smaller (docs/dev/pitfalls.md). The glyph stays as hidden text.
import { For, type JSX } from 'solid-js';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import ArrowRight from 'lucide-solid/icons/arrow-right';
import ArrowUp from 'lucide-solid/icons/arrow-up';
import ArrowDown from 'lucide-solid/icons/arrow-down';

const ARROWS: Record<string, () => JSX.Element> = {
  '←': () => <ArrowLeft />,
  '→': () => <ArrowRight />,
  '↑': () => <ArrowUp />,
  '↓': () => <ArrowDown />,
};

export default function Kbd(props: { k: string }): JSX.Element {
  return (
    <kbd>
      <For each={props.k.split(/([←→↑↓])/).filter(Boolean)}>
        {(part) =>
          ARROWS[part] ? (
            <>
              {ARROWS[part]()}
              <span class="visually-hidden">{part}</span>
            </>
          ) : (
            part
          )
        }
      </For>
    </kbd>
  );
}
