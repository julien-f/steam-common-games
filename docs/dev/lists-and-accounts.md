# Lists & accounts

The data model the whole frontend is built around: everything the app shows — an account's owned games, its wishlist, a bundle, a saved comparison — is a **list of appids**, rendered through one generic viewer ([frontend.md](frontend.md)'s `ListRoute.tsx`). Game display data (rating/HLTB/tags/price) is never stored on a list; it's resolved live via `game-details/stream`, keyed by appid.

Accounts, lists, folders and preferences are `localStorage` only (`prefs.ts`), optionally synced to the server once signed in with Steam — localStorage stays the source every read goes through even when signed in (every read here is synchronous; the server is a second replica kept eventually consistent with it, not a replacement for it). Signing in (the account chip's popover — `AccountChip.tsx`) is entirely optional; without it the app behaves exactly as before.

**Every pref key carries its own `updatedAt`** (`prefs.ts`'s internal storage format — `getPref`/`setPref`'s own signatures are unchanged, callers never see the timestamp). Once signed in, `setPref` pushes the changed key's `{ value, updatedAt }` to `PUT /api/me/prefs/:key` — per key, never a whole-blob PUT, so two keys changing around the same time on different tabs/devices can't clobber each other. The server (`setUserPref`, `lib/auth.js`) always accepts the write — `updatedAt` is stored for display, not enforced as a write guard; by the time a PUT lands here the client has already decided this write should win (see below). A table-view key is the one exception: `setPref` never auto-pushes it at all (see below).

**Every sign-in check merges prefs with the server, not just the first one** (`authStore.ts`'s `syncPrefsWithServer`, run from `initAuth` on every page load). Most prefs (region, account picks, ...) merge by per-key last-write-wins — but a device's *first ever* sync with a given account is treated differently from every sync after it:

- **First sync**: local never overrides a key the server already has, regardless of its `updatedAt` — only server → local for anything both sides have. A brand-new device's local timestamps aren't a trustworthy signal that it should compete with an account's existing configuration; they could just be leftover anonymous-browsing state that happens to look "recent". A key the server has never seen at all still pushes up (there's nothing there to override), so nothing is lost — an account with no prefs at all still ends up with everything this device had.
- **Every sync after that**: plain last-write-wins, per key, both ways — whichever side has the newer `updatedAt` wins, a key on only one side propagates to the other, a tie is left alone. By this point the device has proven itself a real sync participant, so its timestamps reflect actual edits (including retrying a push that failed on an earlier attempt) — this is what keeps two of your own devices, both already signed in, from silently drifting apart.

Adopting anything from the server reloads the page, since every store (`accountsStore.ts`, `listsStore.ts`, ...) seeds its in-memory state from `localStorage` once at load — live-patching each of them to notice an external write isn't worth it for something that, once merged, won't differ again until the next real edit on either side. See [architecture.md](architecture.md) for the underlying routes and [data.md](data.md) for the server-side `user_prefs` table.

**A table-view key (`ownedListView`/`wishlistListView`/`bundleListView`/`recentListView`/`compareListView`/`sharedListView`/`bundlesBrowseView` — [frontend.md](frontend.md)'s table section, `public/tableViewKeys.ts`) is never synced this way at all — it's local-only until the user explicitly says otherwise.** Editing a table (sort/columns/filters/grouping) is a local-only change: `setPref` never auto-pushes it (unlike every other pref), so it can never silently overwrite what's saved to the account. Instead, `public/tableViewSync.ts` keeps a `baseline` per table-view key — this session's best-known copy of the server's value, refreshed from `syncPrefsWithServer` on every sign-in check (in memory only, not written to localStorage) — and the owning route (`ListRoute.tsx`/`BundlesBrowseRoute.tsx`) compares the live table against it on every render. Whenever they differ, in place of the normal Share/Reset-view buttons it shows an "unsaved changes" banner naming which parts of the view changed (`tableViewSync.ts`'s `summarizeViewDiff` — Sort/Columns/Column order/Filters/Grouping/Page size): "Unsaved changes to this view (Sort, Filters) — differs from what's saved to your account — Save / Revert". `page`/`searchQuery` are excluded throughout, not just from this diff — `stripTransientViewFields` (`tableViewSync.ts`) strips them from what Save pushes and what Revert applies too, since paging or typing a search isn't really "a setting" worth syncing at all; Save and Revert are symmetric here, neither one touches them. **Save** (`tableViewPrefs.ts`'s `saveTableViewToServer`) pushes the current (stripped) view to the server unconditionally and advances the baseline to match, clearing the banner immediately. **Revert** (`revertTableViewToServer`) discards the local edits instead: live-patches the table directly via `setViewState` and writes the baseline's value locally through `adoptPrefEntry` (bypassing `setPref`, so it isn't immediately treated as a fresh edit) — no page reload either way, unlike every other pref kind's adopt path. Signing out clears every baseline (`resetBaselines`), so a stale one can't leak into the next account or into signed-out browsing.

**Signing in also fills in `myAccount`/`currentAccount`** when either is still unset (`authStore.ts`'s `autoPopulateAccountFromLogin`) — a verified Steam login already *is* a resolved identity, so there's no reason to make someone retype their own steamid into the picker below right after using it to sign in. Same "never overwrites the stored preference" rule as the `?u=` override: an existing pick, from an earlier manual resolve or from adopting server prefs above, is left alone. Runs the normal `resolveAccountSummary` resolve step (same one Home's picker uses) and is a no-op once both are already set, so a failed resolve just retries on the next page load.

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
- **Several slots is a comparison, not an account** (`?u=alice&u=bob`). `parseAccountParam` returns nothing for one, so nothing resolves it as an override and `withAccountParam` never forwards it — otherwise every comparison would quietly declare a current account on the side, which the nav chip would then claim you were browsing. `/lists/compare` is that shape's own address (see [Combine](#combine)); an old Comparison-page link, which is spelled `/?u=alice&u=bob`, is forwarded there by Home rather than explained away.

This is all deliberate: opening someone else's shared link shouldn't silently change your own default account, and it also shouldn't stop working the moment you click something.

## Lists

A list is a set of appids, usually named — a dynamic one may have no name of its own (see [Combine](#combine)).

### Kinds

- **System lists** (read-only, never stored — always live-derived): *Owned* and *Wishlist* for `currentAccount`; one per browsed *Bundle*; **Recently Looked Up** (`/game`, and `/game/:appid` when a specific lookup is also focused — see [frontend.md](frontend.md)) — the shared "recently looked up games" search history (`recentGames.ts`), browsable/sortable/filterable like any other list. It's global, not account-scoped (pure local search history), and usable as a combine source like anything else (`ListRef.kind: 'recent-games'`). It's a fourth fixed link on Home alongside Owned/Wishlist/Bundles. The nav-bar search dropdown also shows these directly while typing — a second view onto the same data.
- **User lists** (stored, full CRUD):
  - **`manual`** — a stored `appids[]`, directly editable (add/remove games, per-row or via bulk selection — row selection UI defers entirely to whatever `@vates/data-table-solid` already provides, not a bespoke mechanism).
  - **`dynamic`** — stored as a formula (`op` + `sources: ListRef[]`) over other lists, recomputed live every time it's opened. Its own page states that formula in the hero card — each source named (`listLabels.ts`'s `describeListRef`, shared with Home's combine form), linked to its own address, and carrying what it contributed (`Alice — Owned 343 ∪ Alice — Wishlist 115 = 457`, from `resolveListWithSources`' per-source counts), with a dangling source flagged in place rather than silently omitted. Because its contents come from the same server-cached account fetches `/lists/owned` reads, its hero also states how old the oldest of them is and re-resolves them all when clicked (`createDefaultFetchers`'s `refresh`/`onFetchedAt` — the options live on the real wiring, not on the injectable `ListResolveFetchers` seam, which stays pure for the resolver's own tests). Editable after creation too — an "Edit sources" action reopens the same setup dialog used at creation, pre-filled, saving in place (same id/folder position).

### Combine

Creating a dynamic list (or previewing one before saving): pick 2+ source lists via a short, non-blocking **setup dialog**, choose an operation —

- `union`, `intersect`, `subtract` — flat resulting list. Source order matters only for `subtract` (first source minus the union of the rest — `combine.ts`'s `subtract`); the combine form tracks pick order rather than checkbox-list order, and surfaces it as a numbered, reorderable (▲▼) list whenever `subtract` is selected, since it's inert for the other ops.
- `group-by-membership` — groups rows by which combination of sources each game belongs to (generalizes the old Comparison page's "group by exact owner set" table — an N-way account-Owned-lists combine with this mode reproduces it, and `/lists/compare` below is exactly that combine)

— then land in the list viewer with the **live combined result** and a save bar (save as dynamic by default, or freeze immediately to a static manual list).

**Naming is optional for a dynamic list.** Leave the name empty and it's labeled by its own formula everywhere it appears — the tree, the hero title, `<title>`, and another list's formula that uses it as a source (`listLabels.ts`'s `listDisplayName`, falling back to `formatFormula`). Derived on every read, not stamped in at creation: the label then follows a source edit or an account rename instead of quietly going stale, which is the whole point of a dynamic list. The combine form previews the label it would get, and a derived label renders dimmed/italic (`.derived-name`) so it doesn't read as a name someone chose. An unnamed list used as a *source* is parenthesized (`(Alice — Owned ∪ Alice — Wishlist) ∩ Bob — Owned`) and nesting is capped at one level — deeper, it reads "Untitled combined list" rather than growing without end. Freezing an unnamed dynamic list to manual has to stamp the derived name in, since a manual list has no formula left to be labeled from.

**Comparing libraries — `/lists/compare?u=alice&u=bob`.** A comparison is a dynamic list that was never saved: the URL's player slots *are* its formula (one `account-owned` source each), so it resolves, groups and explains itself through the same path a stored one does — the route just builds the `GameList` in memory instead of reading it from this store. That keeps the pre-redesign Comparison page's URLs working (see the `?u=` section above) and its group-per-owner-set table with them, and makes "Save as a list" one `createList` call with the same formula — deliberately unnamed, so the saved list is labeled by that formula and keeps following the accounts.

- Each slot is resolved by the route itself, and **never lands in `recentAccounts`** — comparing someone isn't picking them as your account, the same rule a `?u=` override follows.
- The address is rewritten to the resolved steam64 ids in canonical order once they're known, so one comparison is one URL (and one history entry) however its players were typed. The route's own load guard is what keeps that rewrite from resolving and re-streaming everything a second time.
- Entry point is the players form on the route itself (`ComparePlayersForm.tsx`), not a second copy on Home — Home just links to it. A bare `/lists/compare` is therefore a usable destination whose empty state *is* that form.
- Each player slot in that form is a **token input** over the accounts the app already knows: `getRecentAccounts()` — which needs no union, since `setMyAccount`/`setCurrentAccount` both upsert into recents — plus a `?u=` link's account when one is being explored, that being the only account deliberately kept out. Picking one adds it to *that* slot, so an ad-hoc Family is two picks; a picked account stays an account rather than collapsing to text, and a slot arriving from a `?u=` URL is matched back to named chips (`slotsFromIdentifiers`), because an account without a Steam custom-URL name is otherwise a 17-digit number on screen. Accounts already placed drop out of the dropdown. Nothing here writes back — no `lastUsedAt` bump, nothing new in recents.

`ListRef`s into account-scoped system lists (`account-owned`/`account-wishlist`) always pin an explicit `accountId` — never "whichever account is currently current" — so a saved "Alice ∩ Bob" comparison keeps meaning that regardless of what `currentAccount` is later set to.

**Sharing any saved dynamic list — `/lists/shared?f=<formula>`.** Same idea as comparing libraries above, generalized from "several accounts' Owned lists" to any dynamic list's actual formula (owned/wishlist/bundle/recent-games/nested user-list sources, any op): the formula is encoded into a compact URL grammar (`listShare.ts`) and resolved in memory on arrival, so it opens for someone with none of it in their own storage — see [frontend.md](frontend.md#routes) for the grammar and how a nested `user` source travels. Dynamic lists only for now; a `user` source pointing at a *manual* list can't be shared (there's no appid-set token in the grammar yet) and disables the hero's "🔗 Share list" action with a tooltip.

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
             memberSince? · countryCode? · realName? (solo-account trivia, last-known like avatarUrl)
             lastUsedAt · removedAt?
Folder       id · name · parentId (null = root) · order · createdAt
GameList     id · name? (absent = unnamed, labeled by its formula) · parentId · order · createdAt · updatedAt
             kind 'manual'  → appids[]
             kind 'dynamic' → op + sources[] (ListRef)
             tableView? · deletedAt?
ListRef      kind 'account-owned' | 'account-wishlist' | 'bundle' | 'recent-games' | 'user'
             accountId? (pinned explicitly, never "whichever is current") · bundleId? · listId?
```

`Folder` and `GameList` share one `order` numbering per `parentId`, so folders and lists interleave in display order.

Pref keys: `schemaVersion`, `myAccount`, `currentAccount`, `recentAccounts`, `lists`, `folders`, `recentGames` (backs the `recent-games` system list), plus the shared table-view keys for the fixed system kinds (`ownedListView`, `wishlistListView`, `bundleListView`, `compareListView` and `sharedListView` — each shared across all bundles/comparisons/shared links, unlike user lists which each keep their own `tableView` — and `recentListView`), and `bundlesBrowseView` for `/bundles`' own bundle-picker table (a table of bundles, not of games).

**Cross-tab sync**: not implemented. The design called for a `window` `storage` listener refreshing in-memory state when another tab writes these keys; nothing listens today, so two open tabs can hold divergent state until one reloads.

**Migration**: none, by decision. The keys the pre-redesign pages wrote (their own recents, per-page table views) are simply never read again rather than translated — the account/list model itself was new, so nothing pre-existing needed preserving. An existing user's recents/views reset once.

