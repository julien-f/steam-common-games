// The "who is being compared" form for /lists/compare (ListRoute.tsx's 'compare' kind) — one row
// per player slot, each slot a token input: chips for who's in it, plus a combobox that offers the
// accounts the app already knows and accepts a raw identifier for anyone it doesn't. Ported in
// shape from the pre-redesign Comparison page's own player inputs, which is the whole point:
// entering N players in one go is what made comparing easy there, and building a comparison out
// of saved account/list picks on Home never got close.
//
// It lives on the compare route rather than on Home so there's exactly one implementation of it,
// and so a bare /lists/compare is a usable destination on its own (its empty state *is* this
// form) instead of a URL you can only arrive at from somewhere else.
//
// **Why a per-slot picker rather than one row of chips under the form** (which is what this was
// first): a chip row can only ever add a player, so a Steam Family assembled out of two accounts
// the app knows was unbuildable — the one shape the slot model exists for. Picking into a
// specific slot makes that two clicks. It also lets a picked account stay an *account* rather than
// collapsing to text, which matters because `accountIdentifiers` falls back to the steam64 id for
// anyone without a Steam custom-URL name: those slots read as 17-digit numbers otherwise, on
// arrival from a `?u=` link just as much as on picking (see slotsFromIdentifiers).
//
// It owns the draft slots being typed and nothing else — no resolving, no navigation, no URL; the
// route decides what a submitted set of slots means. The one thing it reads is accountsStore.ts,
// synchronously, once at mount: nothing here can change what's in recents while it's open.
import { createSignal, createMemo, createUniqueId, For, Index, Show, type JSX } from 'solid-js';
import {
  getRecentAccounts, getMyAccount, getAccountOverride, accountDisplayLabel, accountIdentifiers,
} from './accountsStore.ts';
import {
  slotsFromIdentifiers, slotsToIdentifiers, slotIdentifiers, filterAccounts, entryLabel,
  type KnownAccount, type Slot, type SlotEntry,
} from './compareSlots.ts';
import type { AccountSlot } from './types.ts';

export interface ComparePlayersFormProps {
  initialSlots: string[][];
  submitLabel: string;
  onSubmit: (slots: string[][]) => void;
  onCancel?: () => void;
}

// Every account the app knows, most-recently-used first. `recentAccounts` already covers the
// starred and current ones (both setMyAccount and setCurrentAccount upsert into it), so the only
// one that needs adding is a `?u=` link's — deliberately never stored, but obviously worth
// offering while it's the account on screen. Picking one never writes anything back: comparing
// someone isn't picking them as your account, the same rule the route itself follows.
function knownAccounts(): KnownAccount[] {
  const myId = getMyAccount()?.id;
  const recents = getRecentAccounts();
  const override = getAccountOverride();
  const all = override && !recents.some(a => a.id === override.id) ? [override, ...recents] : recents;
  return all.map((account: AccountSlot) => ({
    id: account.id,
    label: accountDisplayLabel(account),
    avatarUrl: account.avatarUrl,
    starred: account.id === myId,
    members: account.members,
    identifiers: accountIdentifiers(account).map(m => m.identifier),
  }));
}

// Two empty players is the starting shape — a comparison needs at least two, and opening with a
// single field makes it look like the account picker it isn't.
function seedSlots(initial: string[][], known: KnownAccount[]): Slot[] {
  const seeded = slotsFromIdentifiers(initial, known);
  while (seeded.length < 2) seeded.push([]);
  return seeded;
}

export function ComparePlayersForm(props: ComparePlayersFormProps): JSX.Element {
  const known = knownAccounts();
  const [slots, setSlots] = createSignal<Slot[]>(seedSlots(props.initialSlots, known));
  // Which slot's dropdown is open, what's typed in it, and which row the arrow keys are on. One
  // set of signals rather than per-slot state: only one input can be focused at a time, so only
  // one dropdown can be open, and keeping it flat means closing one is never a matter of
  // remembering to reset the others.
  const [openSlot, setOpenSlot] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal('');
  const [highlight, setHighlight] = createSignal(0);
  const listboxId = createUniqueId();

  const matches = createMemo(() => (openSlot() == null ? [] : filterAccounts(known, slots(), query())));

  function closeDropdown(): void {
    setOpenSlot(null);
    setQuery('');
    setHighlight(0);
  }

  function openDropdown(slotIdx: number): void {
    setOpenSlot(slotIdx);
    setHighlight(0);
  }

  function addEntry(slotIdx: number, entry: SlotEntry): void {
    setSlots(prev => prev.map((slot, i) => (i === slotIdx ? [...slot, entry] : slot)));
    setQuery('');
    setHighlight(0);
  }

  function removeEntry(slotIdx: number, entryIdx: number): void {
    setSlots(prev => prev.map((slot, i) => (i === slotIdx ? slot.filter((_, j) => j !== entryIdx) : slot)));
  }

  function removeSlot(slotIdx: number): void {
    closeDropdown();
    setSlots(prev => prev.filter((_, i) => i !== slotIdx));
  }

  // Enter commits whichever the user meant: the highlighted account when the dropdown has
  // matches, otherwise whatever they typed — an identifier for someone the app has never seen is
  // the case this whole form has to keep working for.
  function commit(slotIdx: number): void {
    const account = matches()[highlight()];
    if (account) { addEntry(slotIdx, { kind: 'account', account }); return; }
    const value = query().trim();
    if (value) addEntry(slotIdx, { kind: 'typed', value });
  }

  function handleKeyDown(e: KeyboardEvent, slotIdx: number): void {
    const list = matches();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        openDropdown(slotIdx);
        setHighlight(h => (list.length === 0 ? 0 : (h + 1) % list.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(h => (list.length === 0 ? 0 : (h - 1 + list.length) % list.length));
        break;
      case 'Enter':
        // Always swallowed: this field commits a chip, it never submits the form. Submitting on
        // Enter would throw away whatever is half-typed in it.
        e.preventDefault();
        commit(slotIdx);
        break;
      case 'Escape':
        // Only closes the dropdown — the route's own Escape (closing the panel) has nothing to do
        // with a form the user is mid-way through.
        if (openSlot() != null) { e.stopPropagation(); closeDropdown(); }
        break;
      case 'Backspace':
        // The standard token-input affordance: backspace on an empty field deletes the chip
        // before it, so removing a mis-picked account doesn't mean aiming for its ×.
        if (query() === '') {
          const slot = slots()[slotIdx];
          if (slot.length > 0) removeEntry(slotIdx, slot.length - 1);
        }
        break;
    }
  }

  // Leaving the field commits whatever is half-typed in it rather than dropping it — clicking
  // straight from a typed-out name to "Compare" is the obvious thing to do, and focusout fires
  // before the click that caused it (confirmed live: the comparison silently refused to submit,
  // because closing the dropdown had already cleared the text the button was about to read).
  // Only the typed text, never the highlighted row: clicking away isn't picking one.
  function handleFocusOut(slotIdx: number): void {
    const value = query().trim();
    if (value) addEntry(slotIdx, { kind: 'typed', value });
    closeDropdown();
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    const filled = slotsToIdentifiers(slots());
    if (filled.length >= 2) props.onSubmit(filled);
  }

  // Counts the text still being typed as well as the committed chips — the button's disabled
  // state is read while the field is focused, before handleFocusOut has turned it into one.
  const filledCount = (): number =>
    slots().filter((slot, i) => slotIdentifiers(slot).length > 0 || (openSlot() === i && query().trim())).length;

  return (
    <form class="compare-form" onSubmit={handleSubmit}>
      {/* <Index>, not <For>, over the slots — <For> keys by the array's own identity, so adding a
          chip (which replaces that slot's array) would tear down and rebuild the row, taking the
          focused combobox with it. <Index> keys by position, which is what a fixed list of
          numbered players is. The entries *inside* a slot are the opposite case — they're objects
          that keep their identity — so <For> is right there. */}
      <Index each={slots()}>
        {(slot, slotIdx) => (
          <div class="compare-slot">
            <span class="compare-slot-label">Player {slotIdx + 1}</span>
            {/* focusout with a containment check handles click-away and tabbing out alike, and
                skips focus moving *within* the slot (a chip's own × button). Each option's own
                mousedown is prevented below, so picking one never takes focus off the input in
                the first place and so never reaches this. */}
            <div
              class="compare-tokens"
              onFocusOut={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) handleFocusOut(slotIdx);
              }}
            >
              <For each={slot()}>
                {(entry, entryIdx) => {
                  const account = entry.kind === 'account' ? entry.account : null;
                  return (
                    <span class="compare-token" classList={{ 'is-typed': !account }}>
                      <Show when={account?.avatarUrl}>
                        {url => <img class="account-avatar" src={url()} alt="" width="18" height="18" />}
                      </Show>
                      <span class="compare-token-label">{entryLabel(entry)}</span>
                      <Show when={account && account.members.length > 1}>
                        <span class="account-count">({account!.members.length})</span>
                      </Show>
                      <button
                        type="button"
                        class="compare-token-remove"
                        aria-label={`Remove ${entryLabel(entry)}`}
                        onClick={() => removeEntry(slotIdx, entryIdx())}
                      >×</button>
                    </span>
                  );
                }}
              </For>
              <input
                type="text"
                role="combobox"
                aria-expanded={openSlot() === slotIdx}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                  openSlot() === slotIdx && matches().length > 0 ? `${listboxId}-${highlight()}` : undefined
                }
                placeholder={slot().length > 0 ? 'Add another account…' : 'Steam name, profile URL, or 64-bit ID…'}
                value={openSlot() === slotIdx ? query() : ''}
                onFocus={() => openDropdown(slotIdx)}
                onInput={e => { setQuery(e.currentTarget.value); openDropdown(slotIdx); }}
                onKeyDown={e => handleKeyDown(e, slotIdx)}
              />
              <Show when={openSlot() === slotIdx && matches().length > 0}>
                <ul class="compare-options" id={listboxId} role="listbox">
                  <For each={matches()}>
                    {(account, optionIdx) => (
                      <li
                        id={`${listboxId}-${optionIdx()}`}
                        role="option"
                        aria-selected={highlight() === optionIdx()}
                        classList={{ active: highlight() === optionIdx() }}
                        onMouseDown={e => e.preventDefault()} // keep focus on the input, so focusout doesn't beat the click
                        onMouseEnter={() => setHighlight(optionIdx())}
                        onClick={() => addEntry(slotIdx, { kind: 'account', account })}
                      >
                        <Show when={account.avatarUrl}>
                          {url => <img class="account-avatar" src={url()} alt="" width="20" height="20" />}
                        </Show>
                        <span>{account.starred ? '★ ' : ''}{account.label}</span>
                        <Show when={account.members.length > 1}>
                          <span class="account-count">Family · {account.members.length} accounts</span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
            <Show when={slots().length > 2}>
              <button type="button" class="btn btn-ghost btn-sm" title="Remove this player" onClick={() => removeSlot(slotIdx)}>×</button>
            </Show>
          </div>
        )}
      </Index>
      {/* Several accounts in one slot are merged into a single library before comparing — the same
          Steam Family shape an AccountSlot has everywhere else in the app. */}
      <p class="compare-form-hint">Add more than one account to a player to compare a Steam Family as one library.</p>
      <div class="compare-form-actions">
        <button type="button" class="btn btn-ghost btn-sm" onClick={() => setSlots(prev => [...prev, []])}>+ Add player</button>
        <button type="submit" class="btn btn-primary btn-sm" disabled={filledCount() < 2}>{props.submitLabel}</button>
        <Show when={props.onCancel}>
          {cancel => <button type="button" class="btn btn-ghost btn-sm" onClick={() => cancel()()}>Cancel</button>}
        </Show>
      </div>
    </form>
  );
}
