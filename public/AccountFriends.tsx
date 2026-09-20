// The currently-explored account's friends list, with any friend who's also a friend of the
// signed-in user's own account marked. Its own component (not inlined into HomeRoute.tsx's
// account card) so each fetch can key a `createResource` on a plain accountId string — Solid's
// reactivity rules require a primitive resource source, not the AccountSlot object itself.
import { createResource, createMemo, For, Show, type JSX } from 'solid-js';
import { fetchAccountFriends, membersFromAccountId, type AccountFriend } from './accountData.ts';
import { steamVanity } from './utils.ts';
import type { AccountSlot } from './types.ts';

async function loadFriends(accountId: string): Promise<{ friends: AccountFriend[]; unavailable: string[] }> {
  return fetchAccountFriends(membersFromAccountId(accountId));
}

// A friend as a single-account AccountSlot, built entirely from data this component already has
// (no extra resolve fetch needed) — handed to onExplore so the caller can just pickAccount() it,
// same as picking any other recent/resolved account.
function toAccountSlot(f: AccountFriend): AccountSlot {
  const vanity = steamVanity(f.profileUrl);
  return {
    id: f.steamid,
    members: [f.steamid],
    rawInputs: [f.steamid],
    label: f.name,
    avatarUrl: f.avatarUrl || undefined,
    vanities: vanity ? { [f.steamid]: vanity } : {},
    lastUsedAt: Date.now(),
  };
}

export function AccountFriends(props: { accountId: string; myAccountId: string | null; onExplore: (account: AccountSlot) => void }): JSX.Element {
  const [explored] = createResource(() => props.accountId, loadFriends);
  // Only fetched when exploring somebody else's account — comparing an account's friends against
  // its own friends would mark every single one of them "mutual", which says nothing useful.
  const [mine] = createResource(
    () => (props.myAccountId && props.myAccountId !== props.accountId ? props.myAccountId : undefined),
    loadFriends,
  );
  const mineIds = createMemo(() => new Set((mine()?.friends ?? []).map(f => f.steamid)));

  // Mutual friends first (the more interesting fact when browsing someone else's list), then
  // alphabetical — Steam's own GetFriendList order is neither stable nor meaningful (roughly
  // friend-since, unspecified for a merged Family's union).
  const sortedFriends = createMemo(() => {
    const mutual = mineIds();
    return [...(explored()?.friends ?? [])].sort((a, b) => {
      const am = mutual.has(a.steamid), bm = mutual.has(b.steamid);
      if (am !== bm) return am ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  });

  return (
    <Show when={explored()}>
      {data => (
        <details class="account-friends">
          <summary>Friends ({data().friends.length})</summary>
          <Show when={data().unavailable.length > 0}>
            <p class="account-friends-note">
              Friends list is private for {data().unavailable.length} member{data().unavailable.length > 1 ? 's' : ''}.
            </p>
          </Show>
          <Show when={data().friends.length > 0} fallback={<p>No public friends found.</p>}>
            <ul class="account-friends-list">
              <For each={sortedFriends()}>
                {f => (
                  <li>
                    <Show when={f.avatarUrl}>
                      {url => (
                        <span class="account-avatar-wrap">
                          <img class="account-avatar" src={url()} alt="" width="28" height="28" />
                        </span>
                      )}
                    </Show>
                    <Show when={f.profileUrl} fallback={<span class="account-name">{f.name}</span>}>
                      {url => (
                        <a class="account-name account-profile-link" href={url()} target="_blank" rel="noopener noreferrer">
                          {f.name} <span class="account-profile-arrow">↗</span>
                        </a>
                      )}
                    </Show>
                    <Show when={mineIds().has(f.steamid)}>
                      <span class="account-friend-mutual" title="Also a friend of your own account">🤝 Mutual</span>
                    </Show>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      title={`Explore ${f.name}'s library`}
                      onClick={() => props.onExplore(toAccountSlot(f))}
                    >Explore →</button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </details>
      )}
    </Show>
  );
}
