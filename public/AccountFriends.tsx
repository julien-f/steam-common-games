// The currently-explored account's friends list, with any friend who's also a friend of the
// signed-in user's own account marked. Its own component (not inlined into HomeRoute.tsx's
// account card) so each fetch can key a `createResource` on a plain accountId string — Solid's
// reactivity rules require a primitive resource source, not the AccountSlot object itself.
import { createResource, createMemo, For, Show, type JSX } from 'solid-js';
import { fetchAccountFriends, membersFromAccountId, type AccountFriend } from './accountData.ts';
import { fmtAge, steamVanity } from './utils.ts';
import type { AccountSlot } from './types.ts';

// `info.refetching` is what the ↻ below sets — the same "a refetch means force" convention the
// side panel's own resources use (see panelData.ts), bypassing both the server's cache and
// Steam's copy of a friends list that changes far more often than the long TTL it's cached for.
async function loadFriends(
  accountId: string,
  info: { refetching: boolean | unknown },
): Promise<{ friends: AccountFriend[]; unavailable: string[]; fetchedAt: number | null }> {
  return fetchAccountFriends(membersFromAccountId(accountId), { refresh: info.refetching === true });
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
    memberSince: f.memberSince || undefined,
    countryCode: f.countryCode || undefined,
    realName: f.realName || undefined,
    lastUsedAt: Date.now(),
  };
}

export function AccountFriends(props: { accountId: string; myAccountId: string | null; onExplore: (account: AccountSlot) => void }): JSX.Element {
  const [explored, { refetch: refetchExplored }] = createResource(() => props.accountId, loadFriends);
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
          {/* Same age-is-the-control shape as the list heroes' Updated tile and the panel's own
              ↻ — inside the disclosure rather than in its summary, since clicking a button in a
              <summary> would also toggle the disclosure it sits in. */}
          <p class="account-friends-meta">
            <button
              type="button"
              class="account-friends-refresh"
              disabled={explored.loading}
              title="How old the server's cached copy of this friends list is — click to re-fetch it from Steam"
              onClick={() => void refetchExplored()}
            >
              Updated {explored.loading ? 'Refreshing…' : fmtAge(data().fetchedAt)} <span class="account-friends-refresh-icon">↻</span>
            </button>
          </p>
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
