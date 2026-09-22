// The source-picker/op form shared by HomeRoute.tsx (creating a dynamic list) and ListRoute.tsx
// (editing one's sources in place via updateDynamicList) — see docs/dev/lists-and-accounts.md's
// Combine section. Kept dumb: it only assembles { name, op, sources } and hands them to onSubmit,
// which does the actual create/update and decides what happens next (close, navigate, reload).
import { createSignal, For, Show } from 'solid-js';
import { getRecentAccounts } from './accountsStore.ts';
import { getLists } from './listsStore.ts';
import { describeListRef, createDefaultNaming, formatCombine, OP_LABELS, OP_DESCRIPTIONS } from './listLabels.ts';
import type { ListRef, CombineOp } from './types.ts';

interface SourceOption {
  key: string;
  label: string;
  ref: ListRef;
}

// Wording comes from listLabels.ts, shared with the hero card that later has to name the very
// same op back to the user on the list's own page (ListRoute.tsx) — two hand-maintained copies
// were one edit from disagreeing about what a combine does.
const COMBINE_OPS: { value: CombineOp; label: string }[] = (Object.keys(OP_LABELS) as CombineOp[])
  .map(op => ({ value: op, label: `${OP_LABELS[op]} (${OP_DESCRIPTIONS[op]})` }));

function refKey(ref: ListRef): string {
  return [ref.kind, ref.accountId ?? ref.listId].filter(Boolean).join(':');
}

// Every source a combine can currently be built from — any recent account's Owned/Wishlist,
// Recently Looked Up, or any existing user list. Not a bundle (would need its own bundle-picker
// UI, not just a checkbox) — see HomeRoute.tsx's header comment. `excludeListId` keeps a dynamic
// list being edited from being offered as a source for itself.
function sourceOptions(excludeListId?: string): SourceOption[] {
  const naming = createDefaultNaming();
  const refs: ListRef[] = [
    ...getRecentAccounts().flatMap((acc): ListRef[] => [
      { kind: 'account-owned', accountId: acc.id },
      { kind: 'account-wishlist', accountId: acc.id },
    ]),
    { kind: 'recent-games' },
    ...getLists().filter(l => l.id !== excludeListId).map((list): ListRef => ({ kind: 'user', listId: list.id })),
  ];
  return refs.map(ref => ({ key: refKey(ref), label: describeListRef(ref, naming).label, ref }));
}

export interface CombineFormProps {
  initialName?: string;
  initialOp?: CombineOp;
  initialSources?: ListRef[];
  excludeListId?: string;
  // Hidden when editing an existing dynamic list's sources — renaming has its own action
  // (HomeRoute's Rename) and updateDynamicList takes no name, so a visible-but-inert field would
  // look editable without doing anything.
  showName?: boolean;
  submitLabel: string;
  onSubmit: (input: { name?: string; op: CombineOp; sources: ListRef[] }) => void;
  onCancel?: () => void;
}

export function CombineForm(props: CombineFormProps) {
  const [name, setName] = createSignal(props.initialName ?? '');
  const [op, setOp] = createSignal<CombineOp>(props.initialOp ?? 'union');
  const [selected, setSelected] = createSignal<Set<string>>(new Set((props.initialSources ?? []).map(refKey)));
  const [error, setError] = createSignal('');

  function showName(): boolean {
    return props.showName ?? true;
  }

  function options(): SourceOption[] {
    return sourceOptions(props.excludeListId);
  }

  // What the list would be called with the name field left empty — the same derivation every
  // surface uses for a saved unnamed list, applied to the not-yet-saved formula on screen.
  function derivedName(): string | null {
    const sources = options().filter(o => selected().has(o.key)).map(o => o.ref);
    return sources.length >= 2 ? formatCombine(op(), sources, createDefaultNaming()) : null;
  }

  function toggleSource(key: string): void {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    setError('');
    const trimmed = name().trim();
    const sources = options().filter(o => selected().has(o.key)).map(o => o.ref);
    if (sources.length < 2) { setError('Pick at least 2 sources.'); return; }
    try {
      props.onSubmit({ name: showName() ? (trimmed || undefined) : undefined, op: op(), sources });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form class="combine-form" onSubmit={handleSubmit}>
      <Show when={showName()}>
        <input
          type="text"
          placeholder="Combined list name (optional)…"
          value={name()}
          onInput={e => setName(e.currentTarget.value)}
        />
      </Show>
      <select value={op()} onChange={e => setOp(e.currentTarget.value as CombineOp)}>
        <For each={COMBINE_OPS}>{o => <option value={o.value}>{o.label}</option>}</For>
      </select>
      {/* Says what leaving the name empty gets you — otherwise "optional" is invisible until after
          the list is saved. */}
      <Show when={showName() && !name().trim() && derivedName()}>
        {label => <p>Will be named: <span class="derived-name">{label()}</span></p>}
      </Show>
      <p>Pick at least 2 sources:</p>
      <ul class="combine-sources">
        <For each={options()}>
          {opt => (
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={selected().has(opt.key)}
                  onChange={() => toggleSource(opt.key)}
                />
                {opt.label}
              </label>
            </li>
          )}
        </For>
      </ul>
      {error() && <p class="error">{error()}</p>}
      <div class="combine-form-actions">
        <button type="submit">{props.submitLabel}</button>
        <Show when={props.onCancel}>
          {cancel => <button type="button" onClick={() => cancel()()}>Cancel</button>}
        </Show>
      </div>
    </form>
  );
}
