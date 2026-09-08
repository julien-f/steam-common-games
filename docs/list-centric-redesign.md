# List-centric redesign (design proposal)

**Status: functionally complete, on the `list-centric-redesign` branch, not yet merged to `main`.** Every route/list kind described below is real and verified against live data, including a combine setup dialog on Home to actually *create* a dynamic list and real per-group table rendering for `group-by-membership` (one real table per group, most-sources-first). `public/app.tsx`'s old Comparison-page logic (and its now-orphaned sole dependents, `accountsBar.ts`/`pageShell.ts`) are deleted — a multi-account comparison is rebuilt by resolving each account on Home (a Family is one resolve with several identifiers, same as before) and combining their Owned sources with `group-by-membership`, verified live end-to-end against a real account (Owned ∩ Wishlist = 0, Owned ∪ Wishlist = 104, exactly consistent with the account's real 63 owned + 41 wishlisted games). See `CLAUDE.md`'s own top-of-file note for the exact current state, including what's genuinely still open (tree drag-and-drop polish, achievements, live account reactivity — see this doc's own updated open-questions list below) — none of it blocks merging. Once merged, fold this doc's content into `CLAUDE.md`'s own Architecture section (and delete or shrink this doc) rather than maintaining both as separate sources of truth long-term.

## Motivation

Today the app is three largely-independent pages (Comparison, Library Explorer, Bundles) each reimplementing a similar "table of games + side panel" shape around a different data source (a multi-slot comparison, one account's library/wishlist, one bundle's games). This redesign makes **lists of games** the single unifying primitive: everything the app shows — an account's owned games, its wishlist, a bundle, a saved comparison — is a list, rendered through one generic viewer. Users can also freely create, name, and organize their own lists (copied, filtered, or derived from others), not just browse read-only ones.

## Accounts

Two account slots, both optional, distinct from any list:

- **`myAccount`** — "this is me," a pinned default identity.
- **`currentAccount`** — whatever's currently being explored (can be `myAccount`, someone else, or empty). Drives the account header and the Owned/Wishlist system lists.

Both are full `AccountSlot` objects (see Data model), not just an id reference, so clearing history never orphans either.

**Picking `currentAccount`** draws from: `myAccount`, `recentAccounts` (history), or a fresh resolve. The resolve form supports entering **multiple identifiers at once** to build a Family (one field to start, "+ add another account" to merge more before resolving) — same shape as today's per-slot Comparison-page input, producing one complete `AccountSlot` (possibly multi-`members`) in one go, rather than resolving one account at a time and merging as a separate step. **`myAccount` is set by starring/pinning (★) any entry in that same picker** — no separate "profile settings" UI.

**`recentAccounts`** is global (not per-page like today's `accountsBar.ts`), uncapped, with individual removal and clear-all. Removing an entry that's still referenced by a dynamic list soft-removes it (`removedAt`) instead of deleting it outright — see Soft-delete below.

**Account header** (shown wherever `currentAccount` is relevant): avatar, persona name + profile link, online status, owned count, wishlist count.

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

A **list** is a named set of appids. Game display data (rating/HLTB/tags/price/etc.) is never stored on the list — it's always resolved live via the existing `game-details/stream` pipeline, keyed by appid, same as today.

### Kinds

- **System lists** (read-only, never stored — always live-derived): *Owned* and *Wishlist* for `currentAccount`; one per browsed *Bundle*; **Recently Looked Up** (`/game`, and `/game/:appid` when a specific lookup is also focused — see "Global game search" below) — the existing shared "recently looked up games" search history, promoted from a dropdown-only convenience to a full browsable/sortable/filterable list like any other. It's global, not account-scoped (pure local search history), and usable as a combine source like anything else (`ListRef.kind: 'recent-games'`). It's a fourth fixed link on Home alongside Owned/Wishlist/Bundles. The global search dropdown still shows recent items directly as a quick-access convenience while typing — that's unchanged, just a second view onto the same data.
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

## App shell: single-page app, not separate HTML entries

Rather than five separate Vite HTML entries with full browser navigation between them (the multi-page structure the app has today), the redesign is a **true SPA**: one entry, a client-side router (`@solidjs/router` — the app is already on Solid.js per-page, so this is that ecosystem's own router, not a new framework), and a persistent shell (nav bar, account header, global search, the docked panel) that survives navigation instead of remounting on every page load. This directly serves the docked-panel/no-interruption goal below: switching lists or returning Home no longer means a full reload.

Routing stays **path-based for "which page/list," query params for state within it** — no change to the query-param model already designed (`?u=`, `?game=&shot=`, view-sharing params):

```
/                         Home
/lists/owned              Owned (currentAccount)
/lists/wishlist           Wishlist (currentAccount)
/lists/bundle/:bundleId   a specific bundle's games
/lists/:listId            a specific user list
/bundles                  browse/discover bundles
/game/:appid?             Recently Looked Up — :appid optional, also this game's canonical link
/about                    About
```

**Server requirement**: since these are real paths, not hash routes, a cold visit or shared link (e.g. `/game/440`) must be served the app shell rather than 404ing. `server.js` needs a catch-all fallback — serve `dist/index.html` for any unmatched non-`/api`, non-asset path — placed *after* the API routes and static-file serving. Vite's dev server already does this by default for a single-entry app, so it's a production-only `server.js` change. Route-matching order also needs care: `/lists/owned`/`/lists/wishlist`/`/lists/bundle/:id` must be matched before the generic `/lists/:listId`, or a reserved word could theoretically collide with a real list id (unlikely with uuid list ids, but the router config should make the fixed routes take precedence explicitly rather than relying on that).

**`/game/:appid?` is both the Recently Looked Up list's own address and the canonical single-game link** — not two separate routes. `:appid`, when present, is opened the same way a live lookup made while already on this route is (a real row in the recent-games table, not a lesser standalone view) — see `ListRoute.tsx`'s own comments (`handleOpenGameRequest`/`openOrAddRecentGame`). A route-local `?game=` param on every *other* `/lists/...` route is a separate, contextual concern from this — it captures "where am I in this specific list" (for prev/next/restoring position on reload, and for a lookup that isn't one of that list's own rows — see `openStandaloneInPlace`), not a shareable identity for the game the way `/game/:appid` is.

**`/bundles` is itself a table** — the same `@vates/data-table-solid` viewer every list of games goes through, just over bundle rows (a cover, title, shop, game count, cheapest tier price, published/ends dates, plus hidden-by-default tier-count and active/expired status columns) rather than `Game` rows, newest-published first by default, with its own view persisted under `bundlesBrowseView` and the same 🔗 Share view/Reset view pair. ITAD has no bundle-level image, so the cover is a 2×2 grid built from four of the bundle's *games'* own `banner145` assets — already in the list response, no extra request — alongside a per-shop color chip (hue hashed from the shop name, so a shop ITAD adds later needs no code change) and a colored countdown on anything ending within the week (whole days out to seven, hours inside the last day), sharing the Ends cell's second line with the time. Both date columns show the time under the date (smaller, dimmed), not just the day — ITAD's timestamps are second-precise and the table sorts on that precision, so day-only cells made same-day rows look arbitrarily ordered; stacking keeps the precision at the cost of no extra column width. It replaced a hand-rolled row-of-`<button>`s list ported from the legacy page, which was capped to a 260px scroll box (a holdover from when the list shared a page with the opened bundle's game table), couldn't align its columns across rows (each row its own independent flex container), and offered no filtering at all. Sorting/filtering/grouping are now the table's, over the whole loaded set; only "include expired" still round-trips to the server, since that reaches ITAD's much larger archive rather than the ~30-40 currently-active bundles a default load pulls in full. `BundlesBrowseRoute.tsx` feeds `bundleBrowseStore.ts` from the table's `processedData()`, so `/lists/bundle/:bundleId`'s ‹/› nav steps through exactly what the picker showed, in the order it showed it. It carries the same hero card as every list route (`ListHero.tsx`) — title, its controls (`Include expired`, ↻ Refresh, the view buttons) in the action row, and Updated/Prices/Ending soon as tiles; no count tile, since the table's own row counter already follows the filters.

**Every list route shows the list itself, not just its games** — a hero card (`ListHero.tsx`) carries the list's name as the page's `<h1>`, an optional lead (the bundle route's ‹/› nav), kind/shop/account chips, the route's own actions, and that list's facts as labelled tiles, all off fetches the route already makes. `/lists/bundle/:bundleId` gets Ends (with its countdown), Games, Tiers as price chips, Published and Prices, plus ITAD's editorial note; Owned/Wishlist name the account they're showing (avatar, profile link, Family merge count) with Games/Updated/Prices; a user list gets its manual-or-op chip with Games/Folder/Sources/Groups/Edited; Recently Looked Up says it's local browser history. The card was bundle-only at first — every other kind opened with a couple of unlabelled gray lines and named itself nowhere on screen, only in `<title>`. Its dates are locale-formatted (`fmtBundleDateFriendly`, `Intl` with no pinned locale, year omitted for the current year), unlike the tables' ISO — a card is prose read one bundle at a time, a column is scanned down a page against its own sort. Below the table, the bundle's games with **no Steam listing** (courses, asset packs, shop-exclusive keys) render as a collapsed "N more in this bundle, not on Steam" section, and the status line reads "3 of 13 games matched to a Steam listing" — `resolveBundleGames` always returned those unresolved games and the route used to drop them, so a table holding only what resolved was passing itself off as the whole bundle. The card's count is ITAD's own claim; the status line's denominator is what the route can actually enumerate (rows + that list), which differs when `flattenBundleGames`/`resolveBundleGames` dedupe.

Looking up a game (the nav-bar search box, or a DLC/base-game link inside an open panel) never navigates away from a route that already has a list/game context of its own — it opens in place there (a real row if the appid is already loaded, a standalone panel via `?game=` otherwise). Only a route with no such context at all (Home, Bundles browse, About) navigates, to `/game/:appid` — see `AppShell.tsx`'s `openGameGlobally`.

### Global game search

The "look up any game" search box moves from being duplicated per-page (today's `gameSearch.ts` on Library/Bundles) to a **single nav-bar-level search**, part of the persistent shell — opening in place on whatever route/list is currently on screen, falling back to `/game/:appid` only from a route with no list context of its own (see the routing section above).

### The account chip

The nav bar carries **who the app is currently showing** (`AccountChip.tsx`), for the same reason every list route carries a hero card: outside Home, nothing on screen said whose library was on screen — not even while a `?u=` link was being explored — and reaching Owned/Wishlist from any other route meant a round trip through Home.

- Avatar + label off `getEffectiveCurrentAccount()`, re-read on `ACCOUNT_CHANGED_EVENT`, so a `?u=` link resolving after mount updates it in place. A 🔗 marker (and a note in its popover) says outright when a link's account is showing rather than the stored one.
- **Owned and Wishlist render inline beside the chip on a wide viewport, and inside its popover on a narrow one** — they're the two most-visited destinations in the app, worth permanent nav space wherever there's room, and the popover has to carry them for the width where there isn't. Every link carries `?u=` along (`withAccountParam`), or clicking "Owned" while exploring a link would quietly show the stored account's library instead.
- The popover also switches between recent accounts (same explicit-pick semantics as Home's picker: storing the account consumes the `?u=` override, param and all) and links to Home. It stays deliberately thin next to Home's own account section — no resolving a new identifier, ★ starring, per-account refresh, counts, Family member rows or removal — so it's a nav affordance rather than a second, half-implemented copy of that screen.
- Both nav popovers (this one and ⚙ Preferences) share `navPopover.ts`'s `bindNavPopover`: `<details>` has no built-in outside-click/Escape close, and the panel is positioned in JS because `.site-nav`'s flex-wrap moves its triggers with viewport width (see that module's own comment for the Galaxy S10 case that ruled out a CSS-only anchor).

**Still Home-only**: the folder/list tree. Jumping between user lists means going back to Home; a switcher popover or a persistent rail is the open question there.

## Panel: docked, not modal

The side panel becomes a **docked split view**, not an overlay:

- List/game routes render as two live columns (table/content + panel) rather than panel-over-backdrop; both stay interactive.
- No backdrop, no focus trap, no click-outside-to-close — closing is the panel's own × or Escape.
- Clicking a different row while the panel is open swaps its content in place, no need to close first.
- Narrow viewports fall back to a full-screen overlay for the panel (no room for two columns) — the one exception to "never modal."
- `panel.tsx`'s existing internals (hero carousel, sections, swipe, keyboard shortcuts) carry over largely unchanged; what changes is the layout/positioning, not the panel's own logic.
- **History**: opening/closing the panel keeps today's `replaceState`-only convention (Back never steps through panel opens/closes, only the panel's own ×/Escape close it) — clicking through many rows shouldn't fill history with one entry per game.
- **Focus**: opening the panel moves keyboard focus into it (its heading/close button), so screen readers announce it and keyboard users land there immediately — but there's no trap; Tab/Shift+Tab flow freely between the table and panel columns afterward, standard non-modal/complementary-region pattern.

## Storage schema

localStorage, `prefs.ts`-style flat `{key: value}` blob, with a new top-level `schemaVersion` key to give a future format change (or an eventual OpenID-backed sync layer) something to branch on.

```ts
interface AccountSlot {
  id: string;            // canonical: sorted-joined member steam64 ids (stable identity, incl. Family unions)
  members: string[];     // resolved steam64 ids, sorted
  rawInputs: string[];   // original typed identifiers (vanity name/URL/id), same order as entered
  label?: string;        // last-known display name(s) ("PersonaName" or "A + B" for a Family) — cached for instant recents rendering
  avatarUrl?: string;    // last-known avatar, same reason
  lastUsedAt: number;
  removedAt?: number;    // soft-removed from recents UI, kept while referenced by a dynamic list
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;  // null = root
  order: number;             // sibling order, shared numbering space with lists at the same parentId
  createdAt: number;
}

interface GameList {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  kind: 'manual' | 'dynamic';
  appids?: number[];                 // kind: 'manual'
  op?: 'union' | 'intersect' | 'subtract' | 'group-by-membership';  // kind: 'dynamic'
  sources?: ListRef[];               // kind: 'dynamic'
  tableView?: TableViewState;        // persisted per-list (not shared across lists)
  deletedAt?: number;                // soft-deleted, kept for dynamic-list resolution + restore
}

interface ListRef {
  kind: 'account-owned' | 'account-wishlist' | 'bundle' | 'recent-games' | 'user';
  accountId?: string;   // AccountSlot.id — pinned explicitly, never "whichever is current"
  bundleId?: string;
  listId?: string;      // → GameList.id
}
```

Pref keys: `schemaVersion`, `myAccount`, `currentAccount`, `recentAccounts`, `lists`, `folders`, `recentGames` (backs the `recent-games` system list), plus the shared table-view keys for the fixed system kinds (`ownedListView`, `wishlistListView`, `bundleListView` — shared across all bundles, unlike user lists which each keep their own `tableView` — and `recentListView`), and `bundlesBrowseView` for `/bundles`' own bundle-picker table (a table of bundles, not of games — see below).

**Cross-tab sync**: a `window` `storage` event listener refreshes in-memory state whenever another tab writes to these keys — the tree, pickers, and any open list stay consistent across tabs without requiring a reload.

**Migration**: none. This is a full replacement of the pages that wrote the old per-page localStorage keys (`accountsBar.ts` recents, `tableViewPrefs.ts` views, etc.) — those are simply never read again rather than translated into the new schema. Nothing pre-existing needs preserving since the account/list model itself is new.

## Open questions / not yet decided

Implementation sequencing was resolved by an implementation plan (see the git history on the `list-centric-redesign` branch) and is done, including every item that used to block deleting `app.tsx` — what's left below is genuine follow-up polish, not a merge blocker:

- **Folder/list tree polish** — `HomeRoute.tsx`'s rename/move/delete uses plain `window.prompt`/`window.confirm`, not drag-and-drop; no move-between-folders UI at all yet (`listsStore.ts`'s `moveFolder`/`moveList` are unused by any UI so far); no trash/restore UI for soft-deleted lists.
- **Panel tag-click filtering** — `panel.tsx` still declares `onTagClick`/`isTagActive`/`enableTagFilters`, and nothing has passed them since the redesign, so a tag in the panel is plain text. Rewiring them would mean mapping a tag click onto the route's `@vates/data-table-solid` filter state — new work rather than restoration, which is why it wasn't done alongside the other regressions found in the same sweep (achievements, "Owned by", `&shot=` deep links, the `?` dialog, region reactivity, DLC `href`s).
- **Per-account playtime in `group-by-membership` lists** — the panel's "Owned by" card covers the current account's own members (per-member playtime, from the response `myOwnership.ts` already fetches). A membership group knows *which accounts* own a game, but `listResolve.ts`'s fetchers return bare appid sets, so there's no playtime for any account other than the current one; a card mixing real meters for one account with bare names for the others would say less than the group heading already does. Teaching `listResolve.ts` to carry per-account playtime is the real fix.
- **`pricesHandledByHost` is permanently false** — nothing passes it, so `panel.tsx` self-fetches a price for every opened game even on wishlist/bundle lists that batch-price their rows. That costs a duplicate (server-cached) request, but it also fills the panel sooner for a game opened before the batch lands, so it may be the better behaviour — it just isn't a decision anyone made. Either pass the option again or delete it.
- ~~**Achievements**~~ — done: fetched by `panel.tsx` itself (`loadAchievements`), keyed to the effective current account, so it works on every route rather than being ported to `ListRoute.tsx`.
- **Live reactivity to `currentAccount` changing** while a route is already open — partly there now: `accountsStore.ts` broadcasts a `scg:account-changed` window event on every change to the effective account (the same plain-module/`window`-event shape `region.ts`'s `REGION_CHANGED_EVENT` uses, since that file still has no Solid reactivity of its own), and Home's account card, `ListRoute`'s Owned/Wishlist load effect, and every kind's ✓/☆ ownership stamps all subscribe — so a `?u=` link resolving, or an account picked on Home, re-renders/re-streams in place. Anything else a route derives from the account is still read once per mount.
- **`?game=` restore-on-reload is `ListRoute.tsx`-only** — reloading `/lists/owned?game=440` (or any other `/lists/...` route) reopens that game; reloading e.g. `/?game=440` after a Home-side lookup does not, since Home/`BundlesBrowseRoute`/`AboutRoute` have no game/list context to restore into and never register anything with `AppShell.tsx`'s route-handler registry. In practice this is rarely reachable — `openGameGlobally` only ever sends a lookup made from one of those routes to `/game/:appid` in the first place, never to `?game=` on the route itself.
