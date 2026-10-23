// Home's "Accounts": every account the user keeps, one tile each (docs/dev/frontend.md).
import { createSignal, For, Index, Show } from 'solid-js';
import { accountDisplayLabel, clearRecentAccounts, getRecentAccounts, removeRecentAccount } from './accountsStore.ts';
import { fadeInOnLoad } from './utils.ts';
import Star from 'lucide-solid/icons/star';
import X from 'lucide-solid/icons/x';
import type { AccountSlot } from './types.ts';

// Past this many tiles, finding one by eye gets slow enough to offer a filter.
const FILTER_MIN = 9;
// A Family's tile overlaps this many faces at most.
const MAX_FACES = 3;

interface Props {
  myAccountId: string | null;
  currentAccountId: string | null;
  onPick: (account: AccountSlot) => void;
  // Where focus goes once the last tile is removed.
  emptyFocus: () => HTMLElement;
}

function Faces(props: { account: AccountSlot }) {
  const members = () => props.account.members.slice(0, MAX_FACES);
  return (
    <Show
      when={props.account.members.length > 1}
      fallback={
        <span class="account-tile-faces">
          <Show
            when={props.account.avatarUrl}
            fallback={
              <span class="account-tile-face" aria-hidden="true">
                {accountDisplayLabel(props.account).charAt(0).toUpperCase()}
              </span>
            }
          >
            {(url) => <img class="account-tile-face" src={url()} alt="" width="64" height="64" ref={fadeInOnLoad} />}
          </Show>
        </span>
      }
    >
      <span class="account-tile-faces account-tile-faces--family" style={{ '--n': members().length }}>
        <Index each={members()}>
          {(id, i) => (
            <Show
              when={props.account.memberAvatars?.[id()]}
              fallback={<span class="account-tile-face" style={{ '--i': i }} />}
            >
              {(url) => (
                <img
                  class="account-tile-face"
                  style={{ '--i': i }}
                  src={url()}
                  alt=""
                  width="44"
                  height="44"
                  ref={fadeInOnLoad}
                />
              )}
            </Show>
          )}
        </Index>
      </span>
    </Show>
  );
}

export function AccountTiles(props: Props) {
  const recents = () => getRecentAccounts();
  const [query, setQuery] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const filterShown = () => recents().length >= FILTER_MIN;
  // Only while the field is shown: a filter nobody can see must not hide tiles.
  const activeQuery = () => (filterShown() ? query().trim().toLocaleLowerCase() : '');
  const shown = () =>
    activeQuery()
      ? recents().filter((a) => accountDisplayLabel(a).toLocaleLowerCase().includes(activeQuery()))
      : recents();

  let filterField: HTMLInputElement | undefined;
  let editBtn: HTMLButtonElement | undefined;

  function stopEditingIfEmpty(): void {
    if (recents().length === 0) setEditing(false);
  }

  // The removed tile's Remove goes with it: focus the next one's, else the previous one's, else the filter, else emptyFocus.
  function handleRemove(id: string, e: MouseEvent): void {
    const tile = (e.currentTarget as HTMLElement).closest('li');
    const neighbourId = ((tile?.nextElementSibling ?? tile?.previousElementSibling) as HTMLElement | null)?.dataset
      .accountId;
    removeRecentAccount(id);
    stopEditingIfEmpty();
    const neighbour =
      neighbourId && document.querySelector<HTMLElement>(`[data-account-id="${neighbourId}"] .account-tile-remove`);
    (neighbour || (filterShown() && filterField) || props.emptyFocus()).focus();
  }

  function handleClear(): void {
    clearRecentAccounts();
    stopEditingIfEmpty();
    props.emptyFocus().focus();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !editing()) return;
    setEditing(false);
    editBtn?.focus();
  }

  return (
    <div class="home-recents" onKeyDown={onKeyDown}>
      <div class="recents-head">
        <h3>Accounts</h3>
        <Show when={filterShown()}>
          <input
            ref={filterField}
            type="search"
            class="recents-filter"
            placeholder="Filter accounts"
            aria-label="Filter accounts"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !query()) return;
              e.stopPropagation(); // Esc clears the text first, then leaves edit mode
              setQuery('');
            }}
          />
        </Show>
        <Show when={recents().length > 0}>
          <button ref={editBtn} type="button" class="btn recents-edit" onClick={() => setEditing((v) => !v)}>
            {editing() ? 'Done' : 'Edit'}
          </button>
        </Show>
      </div>
      <Show when={recents().length > 0} fallback={<p>No accounts yet: look one up above.</p>}>
        <Show
          when={shown().length > 0}
          fallback={
            <p>
              No account matches “{query().trim()}”.{' '}
              <button
                type="button"
                class="recents-clear"
                onClick={() => {
                  setQuery('');
                  filterField?.focus();
                }}
              >
                Clear filter
              </button>
            </p>
          }
        >
          <ul class="account-tiles" classList={{ 'is-editing': editing() }}>
            <For each={shown()}>
              {(account) => (
                <li data-account-id={account.id}>
                  <button
                    type="button"
                    class="account-tile"
                    aria-current={account.id === props.currentAccountId ? 'true' : undefined}
                    title={accountDisplayLabel(account)}
                    onClick={() => props.onPick(account)}
                  >
                    <Faces account={account} />
                    <span class="account-tile-name">{accountDisplayLabel(account)}</span>
                    <Show when={account.members.length > 1}>
                      <span class="account-tile-sub">Family · {account.members.length}</span>
                    </Show>
                    <Show when={account.id === props.myAccountId}>
                      <span class="account-tile-mine">
                        <Star />
                        <span class="visually-hidden">(yours)</span>
                      </span>
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="account-tile-remove"
                    title="Remove"
                    aria-label={`Remove ${accountDisplayLabel(account)}`}
                    onClick={[handleRemove, account.id]}
                  >
                    <X />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={editing()}>
          <button type="button" class="recents-clear" onClick={handleClear}>
            Clear all
          </button>
        </Show>
      </Show>
    </div>
  );
}
