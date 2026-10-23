# Improvements

UX backlog from `ux-review` runs against [journeys.md](journeys.md) and [ui-guidelines.md](ui-guidelines.md); last run 2026-10-23. Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

- [Sharing](#sharing)
- [Loading and feedback](#loading-and-feedback)
- [Lists and selection](#lists-and-selection)
- [Comparing](#comparing)
- [Bundles and prices](#bundles-and-prices)
- [Phone](#phone)
- [Accounts and first visit](#accounts-and-first-visit)
- [Consistency and polish](#consistency-and-polish)
- [Review tooling](#review-tooling)
- [Not yet reviewed](#not-yet-reviewed)

## Sharing

- **U125 · minor · S1, C1, S3** — List, bundle and compare links all preview identically, and a `/lists/<id>` list that exists only in the sender's browser can't be described at all. Server-side per-route `og:title` from the path alone (Owned games, Wishlist, Compare libraries, Shared list, bundle name from cache), generic for `/lists/<id>`.
- **U172 · minor · S3, B1, I3** — a dead link to a list (`/lists/<unknown id>`) or a bundle (`/lists/bundle/<unknown id>`) shows one bare status line: no h1, no way back, and the bundle's reads "Error: Bundle not found". Page not found has a heading and Go to Home; give these the same, with All bundles for a bundle.

## Loading and feedback

- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.
- **U185 · minor · B1, B2, S1** — the Taste fit note reads "Taste fit needs Alice's Owned list opened on this device" even after Owned was opened, when its account has too few games played (`withProfile` drops the saved taste, so both cases look alike); a friend opening a shared wishlist is told the same about the sender's Owned. Its "as of" date is `toLocaleDateString()` ("10/23/2026"), not ISO. Say "too few games played", as Group fit's note does, and drop the note on a `?u=` view; ISO date.
- **U188 · minor · D2** — after a failed price batch the panel's Price card says "IsThereAnyDeal didn't answer." with no retry there, and its Refresh details retries bundles but not the price; the only retry is the hero's Prices tile, out of sight behind the panel on a phone. Offer the retry in the card (the Prices tile's refresh), or have Refresh details refetch the game's price.

## Lists and selection

- **U76 · polish · F3** — with **All** chosen, the chip still reads "Genres: Action, RPG", the same as **Any**, though it shows 3 rows instead of 6. Needs an upstream change: say "all of" in the chip (vatesfr/data-table#35).
- **U161 · minor · C1, F3** — excluding a Steam tag drops every game carrying it, even as its 18th tag on a few votes (a "Horror" exclusion loses games with a passing horror level). The table filters raw column values, so: a **Main tags** column (tags ≥ ~30% of the top tag, threshold to measure first), filterable and groupable — excluding there is the soft exclusion, grouping there groups by dominant genre. Alternative: a per-column `filterValues(row)` in `@vates/data-table-core`.
- **U168 · minor · F3, F4** — no way to explore the store by Steam tag ("the best roguelikes I don't own"). `IStoreQueryService/Query` lists appids by `tagids_must_match`, key-less ([integrations.md](integrations.md#a-developers-or-publishers-games--store-search-results)); needs its own volume review like F4's.

## Comparing

- **U191 · polish · C1, I2** — Enter in a player field never submits, even when it's empty, so typing "bob", Enter (chip), Enter does nothing; keyboard users must Tab to Compare libraries. Submit on Enter when the field is empty, as Home's lookup does.
- **U170 · major · C3, L2** — saving a comparison names a player who isn't a stored account by steam64 id: the formula reads "Alice — Owned ∪ 76561198000000002 — Owned", and so do its group labels and Home's tree, though the comparison's own title said "Alice vs. Bob" and a reload doesn't fix it. Store or resolve each source account's name when the list is saved.
- **U139 · polish · C4** — panel Owned by reads "never played · not played". One phrase.
- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.

## Bundles and prices

- **U187 · minor · B1** — on a bundle priced in another currency (the Fanatical pick-and-mix), the Tier Price column reads "$2.00/game" beside Best Deal in €, while the Tiers tile and the panel convert ("1 for $2.00 (≈ €1.71)"), so step 4's tier vs. best deal comparison needs mental conversion. Add the "≈ €" conversion in the cell, as the tile does.
- **U177 · polish · B1** — shop chips (`.shop-chip`) take a hue hashed from the shop's name, outside the tokens, so a shop can land on amber, which ui-guidelines.md's Colour keeps for warnings and owned games (Humble Bundle does). One neutral chip, or a few token hues that exclude amber.

## Phone

- **U189 · minor · L1, C3, I1** — on a phone, Home's five full-width Explore cards (~400 px, repeating the nav bar and the chip's Owned/Wishlist) push **Your lists** below the fold: its heading starts at 898 px on an 844 px screen, so a returning user sees none of their lists. With no account, the Owned and Wishlist cards still read "The current account's games" and lead to "No account selected — pick one on Home". Compact the cards on a phone (two columns, no description), or put Your lists first once it has any; drop or disable the two account cards until there's an account.

## Accounts and first visit

- **U181 · minor · A3, I3** — with **Add Steam Family account**, both lookup fields are named "Steam name, profile URL, or 64-bit ID", so a screen reader can't tell them apart. Number them ("Family member 2").

## Consistency and polish

- **U152 · polish · visual** — number columns (rating, HLTB, Played, price, discount) are start-aligned (digits are tabular). Right-align them and their headers: blocked on @vates/data-table-solid, whose `th`/`td` carry no column key or class and whose column defs have no align option (vatesfr/data-table#42).
- **U160 · polish · L3** — data-table popovers: Filter opens on a range slider with no column heading; searching Columns leaves an empty "VISIBLE COLUMNS" header; an open range chip reads "Played (h): 5.0–". Label the pane, hide empty groups, write "≥ 5.0 h". Needs upstream changes in `@vates/data-table-solid` (vatesfr/data-table#42).
- **U121 · polish · F1** — ←/→ on a game showing only its Cover while its media streams does nothing visible, yet `stepLightbox` (`public/lightbox.tsx:1164`) clears the take-the-media-when-it-lands latch and marks the Cover chosen, so the screenshots never replace it. Return early when there's nothing to step to.
- **U122 · polish · F1** — a refresh that shrinks a game's media while the lightbox shows it leaves `idx()` past the end: rendering clamps it (`public/lightbox.tsx:1234`), but the caption (`:168`), counter (`:325`) and the leave-memory read (`:1111`) index `shots()[idx()]` unclamped, so paging away records nothing and lands on screenshots. Clamp once where the list changes.
- **U169 · minor · I2, I3** — revealing a hidden achievement with Enter or Space drops focus to `<body>` (the spoiler button becomes a div), against ui-guidelines.md's "focus is never dropped". Move focus to the revealed row, or to the next hidden one.
- **U112 · polish** — every table shows a "Page 1 of 1" pager with all buttons disabled when everything fits. Needs an upstream change: hide the pager when there's a single page (an option or the default in `@vates/data-table-solid`, vatesfr/data-table#41).
- **U39 · polish** — the search box shifts sideways as the account chip's label changes length ("Alice" vs. "Alice + Bob + Carol"); missing thumbnails have no placeholder; wishlisted/owned name colours have no legend (still true in Recently Looked Up).
- **U178 · minor · F1, I2** — the panel's More links menu holds only "More Like This (Steam)", Title Case and without the ↗ external links carry, repeating Similar games' "More like this on Steam ↗"; and Esc with the menu open closes the whole panel, not the menu (it has no Esc handling, unlike the `bindNavPopover` menus). Drop the menu, or name its entry the same and close it on Esc first.
- **U179 · polish · I2, I3** — the first Tab stop reads "Skip to table" on pages with no table (Home, Compare's form, About, the rank screen), where it skips to `main`. "Skip to content" there.
- **U182 · polish · I2** — a second Esc in the nav search blurs it to `<body>`, so the next Tab starts from the page top. Hand focus to the main content's first stop, or back to where `/` was pressed.
- **U184 · major · F1, F4** — once a tab's session history reaches 50 entries, Back changes the address but leaves the panel (and the lightbox) open, and the next Back leaves the list. Chromium caps `history.length` at 50, and `overlayHistory.ts` stamps its pushed entry `_depth: history.length - 1`, equal to the entry below it, so popstate sees no depth change (reproduced: 52 `pushState`s, open a game, Back). Stamp `currentDepth() + 1`; `@solidjs/router`'s saveCurrentDepth stamps the same way, worth an upstream issue.
- **U186 · minor · A1, L1, B1, I2** — focus drops to `<body>` where a control under focus goes away: Home's Look up turns `disabled` ("Looking up…") while resolving, the selection bar unmounts after Add (the "Added 2 games…" toast takes no focus), and › Next bundle disables on the last bundle. Use `aria-disabled` as the hero tiles do (frontend.md), and move focus to the toast's Open list or the table after Add.
- **U192 · polish · R1** — right after **Continue**, Undo is disabled with no reason given, so the last answer before Esc can't be undone (R1's edge "Undo right after resuming"); the stack is in memory only. Keep the undo stack with the ranking, or say "Undo covers this session's answers".

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, how high the table starts at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown;
- a private profile, so A1's "looks empty — does the UI say why?" edge can't be judged;
- prices in any currency but EUR, so B2's repricing can't be judged;
- search results (`/api/search-games`) and bundles carry no image, so the search dropdown's thumbnails and /bundles' Image column show blank;
- a trailer that plays: Hades' fixture trailer has no stream, so playback and its idle-hide can only be seen on the real server.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- On a real phone: trailer playback (headless Chromium showed black frames), pinch and double-tap zoom, swipe-to-close.
- Firefox and Safari: only Chromium was walked (View Transitions are Chromium/Safari-only).
- O1's `GET /api/metrics` (no mock); D1's age highlight, C2's price columns per group, L1's panel **Add to list**, D3 (◇ not started).
