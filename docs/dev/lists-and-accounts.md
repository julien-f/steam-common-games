# Lists & accounts

The data model the whole frontend is built around: everything the app shows — an account's owned games, its wishlist, a bundle, a saved comparison — is a **list of appids**, rendered through one generic viewer ([frontend.md](frontend.md)'s `ListRoute.tsx`). Game display data (rating/HLTB/tags/price) is never stored on a list; it's resolved live via `game-details/stream`, keyed by appid.

Nothing here is server-side. Accounts, lists, folders and preferences are `localStorage` only (`prefs.ts`), so there is no login and no cross-device sync yet — `prefs.ts`'s per-key setter is the seam a future Steam-auth-backed sync would attach to.

- [Accounts](#accounts)
  - [`?u=` URL semantics — honored on every route, not just Home](#u-url-semantics--honored-on-every-route-not-just-home)
- [Lists](#lists)
  - [Kinds](#kinds)
  - [Combine](#combine)
  - [Organization — folders](#organization--folders)
  - [Soft-delete + restore](#soft-delete--restore)
- [Storage schema](#storage-schema)


## Accounts

Two account slots, both optional, distinct from any list:

- **`myAccount`** — "this is me," a pinned default identity.
- **`currentAccount`** — whatever's currently being explored (can be `myAccount`, someone else, or empty). Drives the account header and the Owned/Wishlist system lists.

Both are full `AccountSlot` objects (see the schema below), not just an id reference, so clearing history never orphans either.

**Picking `currentAccount`** draws from: `myAccount`, `recentAccounts` (history), or a fresh resolve. The resolve form supports entering **multiple identifiers at once** to build a Family (one field to start, "+ add another account" to merge more before resolving) — producing one complete `AccountSlot` (possibly multi-`members`) in one go, rather than resolving one account at a time and merging as a separate step. **`myAccount` is set by starring/pinning (★) any entry in that same picker** — no separate "profile settings" UI.

**`recentAccounts`** is global, uncapped, with individual removal and clear-all. Removing an entry that's still referenced by a dynamic list soft-removes it (`removedAt`) instead of deleting it outright — see Soft-delete below.

**Account header** (shown wherever `currentAccount` is relevant): avatar, persona name + profile link, online status, owned count, wishlist count.

**Copyable identifier**: a ⧉ button beside the name copies the nicest identifier the account has — its Steam custom-URL name (`gaben`) when it set one, its steam64 id otherwise (`accountsStore.ts`'s `accountIdentifiers`). Per member, never one string for the slot: a Family's joined label is nothing any input accepts back. Offered wherever an account is named — the account card, Home's "Recent accounts", the nav chip and its recents — since it reads off the stored slot and so needs no account to be current. The custom names are captured at resolve time from the `profileurl` `/api/common-games` already returns and stored as `AccountSlot.vanities`, so every surface can offer the nice form without a fetch; a slot resolved before that field existed simply falls back to ids.

**Reactivity**: `currentAccount` is app-wide reactive state, not read once per page load — if it changes while `/lists/owned` or `/lists/wishlist` is open, that route re-fetches/re-streams in place immediately, rather than only taking effect on the next navigation. This matters more than it would have in the old multi-page structure, since switching accounts no longer implies a page reload.

### `?u=` URL semantics — honored on every route, not just Home

`?u=` is a **URL override, not a "consume and adopt" param** (unlike the `?tv=` table-view param elsewhere in the app). Implemented as `accountOverride.ts` (parse the param, resolve it, hand it over) plus `accountsStore.ts`'s own in-memory override slot — `getEffectiveCurrentAccount()` (override ?? stored) is what every reader of "the current account" calls; only Home's account *picker* still deals in the stored one directly.

- Present → takes precedence over the stored `currentAccount` everywhere it's read — Home's account card, `/lists/owned`, `/lists/wishlist`, and the panel's/table's ownership status (`myOwnership.ts`) — but never overwrites the stored preference, and never lands in `recentAccounts` either: browsing someone's library from a link isn't the same act as picking an account for yourself.
- **Resolved once for the whole app**, by `AppShell.tsx` (a `createEffect` on the router's `location.search`) rather than per route — the shell outlives every navigation, so a shared link is honored identically on all of them. `syncAccountOverrideFromUrl` is keyed on the identifiers themselves, so an unrelated param write (a panel `?game=`, a lightbox `&shot=`) costs no re-resolve.
- **Forwarded across in-app navigation** (`withAccountParam`, `urlState.ts`): the shell's nav links, Home's four fixed list links, `ListRoute`'s own `navigate()` calls (bundle ‹/›, `/game/:appid`) and the panel's ownership badges all carry it along. The stored account is sticky by nature; an override has to be made sticky by hand, or clicking "Owned" while exploring a link would quietly switch back to your own library. The panel's 🔗 "copy link to this game" deliberately does *not* carry it — that link is the game's canonical shareable address, and baking in whichever account the sender happened to be exploring would make it explore that account for everyone it reaches.
- `/lists/owned`/`/lists/wishlist` treat the link as **authoritative**: while it's resolving, and if it fails outright (a private or unknown profile), the stored account is deliberately not loaded in its place — the route shows the override's own status text instead. Falling back would both waste a full library fetch/stream on an account the URL didn't ask for (the route's load effect runs right after the shell's resolve has only just started) and, on a failure, quietly show someone else's library under a URL naming a specific account.
- The stored `currentAccount` only changes via an explicit account pick through the UI — including the "Set as my current account" button in Home's own "Exploring … from this link" note, the only way an override is ever adopted — at which point the `u=` param (now redundant) is dropped from state and stripped from the URL. That strip goes through the router's `navigate(..., { replace: true })`, not a bare `history.replaceState`: a raw replaceState is invisible to `@solidjs/router`'s location signal, so every `withAccountParam`-built href would keep pointing at an account the URL no longer names (found live).
- An **old Comparison-page link** (`?u=alice&u=bob`, several slots) has no single-route equivalent anymore — a comparison is a dynamic list combining two accounts' Owned lists now. The first slot is honored as the explored account and the extras are *reported* ("This link lists 2 accounts to compare. Showing the first; …") rather than silently unioned into one Family (right games, wrong meaning) or dropped with no explanation.

This is all deliberate: opening someone else's shared link shouldn't silently change your own default account, and it also shouldn't stop working the moment you click something.

## Lists

A list is a named set of appids.

### Kinds

- **System lists** (read-only, never stored — always live-derived): *Owned* and *Wishlist* for `currentAccount`; one per browsed *Bundle*; **Recently Looked Up** (`/game`, and `/game/:appid` when a specific lookup is also focused — see [frontend.md](frontend.md)) — the shared "recently looked up games" search history (`recentGames.ts`), browsable/sortable/filterable like any other list. It's global, not account-scoped (pure local search history), and usable as a combine source like anything else (`ListRef.kind: 'recent-games'`). It's a fourth fixed link on Home alongside Owned/Wishlist/Bundles. The nav-bar search dropdown also shows these directly while typing — a second view onto the same data.
- **User lists** (stored, full CRUD):
  - **`manual`** — a stored `appids[]`, directly editable (add/remove games, per-row or via bulk selection — row selection UI defers entirely to whatever `@vates/data-table-solid` already provides, not a bespoke mechanism).
  - **`dynamic`** — stored as a formula (`op` + `sources: ListRef[]`) over other lists, recomputed live every time it's opened. Its own page states that formula in the hero card — each source named (`listLabels.ts`'s `describeListRef`, shared with Home's combine form), linked to its own address, and carrying what it contributed (`Alice — Owned 343 ∪ Alice — Wishlist 115 = 457`, from `resolveListWithSources`' per-source counts), with a dangling source flagged in place rather than silently omitted. Editable after creation too — an "Edit sources" action reopens the same setup dialog used at creation, pre-filled, saving in place (same id/folder position). One-way **"freeze to snapshot"** converts a dynamic list to manual (copies current contents, drops the formula).

### Combine

Creating a dynamic list (or previewing one before saving): pick 2+ source lists via a short, non-blocking **setup dialog**, choose an operation —

- `union`, `intersect`, `subtract` — flat resulting list
- `group-by-membership` — groups rows by which combination of sources each game belongs to (generalizes the old Comparison page's "group by exact owner set" table — an N-way account-Owned-lists combine with this mode reproduces it)

— then land in the list viewer with the **live combined result** and a save bar (save as dynamic by default, or freeze immediately to a static manual list).

`ListRef`s into account-scoped system lists (`account-owned`/`account-wishlist`) always pin an explicit `accountId` — never "whichever account is currently current" — so a saved "Alice ∩ Bob" comparison keeps meaning that regardless of what `currentAccount` is later set to.

**Cycle detection**: since a dynamic list can reference another `user` list as a source, a chain like A←B←A is possible. Saving or editing a dynamic list walks the *full* source dependency graph (not just a direct self-reference check) and rejects the save outright with a clear error if it would introduce a cycle — nothing broken is ever allowed to be saved, rather than silently breaking/truncating a cyclic reference at resolve time.

### Organization — folders

User lists (not system lists/bundles) live in a **renameable folder/list tree**, arbitrarily nested:

```
Folder { id, name, parentId: string | null, order, createdAt }
GameList { ...above..., parentId: string | null, order }
```

Flat arrays keyed by `parentId`, not a nested structure — rename/move/reorder is a single-item mutation, not a tree walk. Folders and lists share one `order` numbering per `parentId` so they interleave in display order; reorder is drag-and-drop plus a "Move to…" menu (not drag-only, for accessibility). The tree supports ctrl/shift-click **multi-select** for bulk move/delete, plus standard tree keyboard navigation (arrows to move, Enter to open/rename) — no bespoke conventions needed there.

Deleting a folder walks its contents and applies the same soft-delete check to each child (see below) rather than cascading an unconditional delete.

### Soft-delete + restore

A `GameList` or `AccountSlot` still referenced by some dynamic list's `sources[]` is never hard-deleted on removal — it's stamped (`deletedAt`/`removedAt`) and hidden from normal browsing (tree, pickers, recents) but kept resolvable, with a restore affordance (ideally inline, right next to the now-broken-looking source in whatever dynamic list still points at it, in addition to a general "Trash" view). A sweep on every reference change purges anything soft-deleted that's no longer referenced by anything.

A referenced **bundle** disappearing (ITAD's own data expiring) is different — that's remote data, not something the app deleted, so it just renders as "Bundle no longer available," no restore possible.


## Storage schema

One flat `{key: value}` blob in localStorage (`prefs.ts`), with a top-level `schemaVersion` key giving a future format change (or an eventual auth-backed sync layer) something to branch on.

The interfaces themselves are declared in `public/types.ts` — that's the source of truth; the shape at a glance:

```
AccountSlot  id (sorted-joined member steam64 ids) · members[] · rawInputs[] · label? · avatarUrl?
             vanities? (steam64 → Steam custom-URL name, for the members that set one)
             lastUsedAt · removedAt?
Folder       id · name · parentId (null = root) · order · createdAt
GameList     id · name · parentId · order · createdAt · updatedAt
             kind 'manual'  → appids[]
             kind 'dynamic' → op + sources[] (ListRef)
             tableView? · deletedAt?
ListRef      kind 'account-owned' | 'account-wishlist' | 'bundle' | 'recent-games' | 'user'
             accountId? (pinned explicitly, never "whichever is current") · bundleId? · listId?
```

`Folder` and `GameList` share one `order` numbering per `parentId`, so folders and lists interleave in display order.

Pref keys: `schemaVersion`, `myAccount`, `currentAccount`, `recentAccounts`, `lists`, `folders`, `recentGames` (backs the `recent-games` system list), plus the shared table-view keys for the fixed system kinds (`ownedListView`, `wishlistListView`, `bundleListView` — shared across all bundles, unlike user lists which each keep their own `tableView` — and `recentListView`), and `bundlesBrowseView` for `/bundles`' own bundle-picker table (a table of bundles, not of games).

**Cross-tab sync**: not implemented. The design called for a `window` `storage` listener refreshing in-memory state when another tab writes these keys; nothing listens today, so two open tabs can hold divergent state until one reloads.

**Migration**: none, by decision. The keys the pre-redesign pages wrote (their own recents, per-page table views) are simply never read again rather than translated — the account/list model itself was new, so nothing pre-existing needed preserving. An existing user's recents/views reset once.

