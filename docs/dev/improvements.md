# Improvements

UX backlog from `ux-review` runs against [journeys.md](journeys.md) and [ui-guidelines.md](ui-guidelines.md); last run 2026-10-19. Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

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

## Lists and selection

- **U76 · polish · F3** — with **All** chosen, the chip still reads "Genres: Action, RPG", the same as **Any**, though it shows 3 rows instead of 6. Needs an upstream change: say "all of" in the chip (vatesfr/data-table#35).
- **U161 · minor · C1, F3** — excluding a Steam tag drops every game carrying it, even as its 18th tag on a few votes (a "Horror" exclusion loses games with a passing horror level). The table filters raw column values, so: a **Main tags** column (tags ≥ ~30% of the top tag, threshold to measure first), filterable and groupable — excluding there is the soft exclusion, grouping there groups by dominant genre. Alternative: a per-column `filterValues(row)` in `@vates/data-table-core`.
- **U168 · minor · F3, F4** — no way to explore the store by Steam tag ("the best roguelikes I don't own"). `IStoreQueryService/Query` lists appids by `tagids_must_match`, key-less ([integrations.md](integrations.md#a-developers-or-publishers-games--store-search-results)); needs its own volume review like F4's.

## Comparing

- **U170 · major · C3, L2** — saving a comparison names a player who isn't a stored account by steam64 id: the formula reads "Alice — Owned ∪ 76561198000000002 — Owned", and so do its group labels and Home's tree, though the comparison's own title said "Alice vs. Bob" and a reload doesn't fix it. Store or resolve each source account's name when the list is saved.
- **U139 · polish · C4** — panel Owned by reads "never played · not played". One phrase.
- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.

## Bundles and prices

- **U177 · polish · B1** — shop chips (`.shop-chip`) take a hue hashed from the shop's name, outside the tokens, so a shop can land on amber, which ui-guidelines.md's Colour keeps for warnings and owned games (Humble Bundle does). One neutral chip, or a few token hues that exclude amber.

## Phone

- **U173 · polish · C1, C3, B1, R1** — the phone hero's ⋯ (More actions) draws its icon 9 px above centre (`.list-hero-more` is `inline-flex` without centring). Since 0663512's Lucide icon.

## Accounts and first visit

- **U174 · polish · A2** — the nav chip's switcher marks my account with an outline star, where Home draws mine filled and an outline star means "not starred"; its tooltip, "Your account (★ on Home)", names a glyph Home doesn't show. Fill it as Home does; tooltip "Your account". Since 0663512.
- **U181 · minor · A3, I3** — with **Add Steam Family account**, both lookup fields are named "Steam name, profile URL, or 64-bit ID", so a screen reader can't tell them apart. Number them ("Family member 2").

## Consistency and polish

- **U152 · polish · visual** — number columns (rating, HLTB, Played, price, discount) are start-aligned (digits are tabular). Right-align them and their headers: blocked on @vates/data-table-solid, whose `th`/`td` carry no column key or class and whose column defs have no align option (vatesfr/data-table#42).
- **U160 · polish · L3** — data-table popovers: Filter opens on a range slider with no column heading; searching Columns leaves an empty "VISIBLE COLUMNS" header; an open range chip reads "Played (h): 5.0–". Label the pane, hide empty groups, write "≥ 5.0 h". Needs upstream changes in `@vates/data-table-solid` (vatesfr/data-table#42).
- **U121 · polish · F1** — ←/→ on a game showing only its Cover while its media streams does nothing visible, yet `stepLightbox` (`public/lightbox.tsx:1164`) clears the take-the-media-when-it-lands latch and marks the Cover chosen, so the screenshots never replace it. Return early when there's nothing to step to.
- **U122 · polish · F1** — a refresh that shrinks a game's media while the lightbox shows it leaves `idx()` past the end: rendering clamps it (`public/lightbox.tsx:1234`), but the caption (`:168`), counter (`:325`) and the leave-memory read (`:1111`) index `shots()[idx()]` unclamped, so paging away records nothing and lands on screenshots. Clamp once where the list changes.
- **U169 · minor · I2, I3** — revealing a hidden achievement with Enter or Space drops focus to `<body>` (the spoiler button becomes a div), against ui-guidelines.md's "focus is never dropped". Move focus to the revealed row, or to the next hidden one.
- **U112 · polish** — every table shows a "Page 1 of 1" pager with all buttons disabled when everything fits. Needs an upstream change: hide the pager when there's a single page (an option or the default in `@vates/data-table-solid`, vatesfr/data-table#41).
- **U39 · polish** — the search box shifts sideways as the account chip's label changes length ("Alice" vs. "Alice + Bob + Carol"); missing thumbnails have no placeholder; wishlisted/owned name colours have no legend (still true in Recently Looked Up).
- **U175 · polish · F1, I3** — the panel's Tags & details tells a tag from a genre, category or developer only by a dot colour, from hex in `panel.tsx`'s `TAG_KIND_META` (`#66c0f4` is the old palette's `--accent2`); so "Action" and "Co-op" each appear twice, as identical buttons to a screen reader. ProtonDB's tier colours (`utils.ts`'s `PROTON_TIER_COLORS`) are hex too. Move both to tokens, and name each chip's kind ("Action, genre").
- **U176 · polish · I2, R1** — Geist draws ← and → far smaller than ↑ and ↓, so the shortcuts dialog's key caps and the ranking's hints mix two arrow sizes. Size the key-cap arrows to match, or draw them all one way. Since 91f369a's Geist.
- **U178 · polish · F1** — the panel's More links menu holds only "More Like This (Steam)", Title Case and without the ↗ external links carry, repeating Similar games' "More like this on Steam ↗". Drop the menu entry, or name it the same.
- **U179 · polish · I2, I3** — the first Tab stop reads "Skip to table" on pages with no table (Home, Compare's form, About, the rank screen), where it skips to `main`. "Skip to content" there.
- **U180 · polish · motion** — the skeleton's shimmer animates `background-position` over a 2.4 s loop, against ui-guidelines.md's Motion (only opacity and transform move, durations from `--dur-*`). Sweep a pseudo-element with `translate`. Since b3bd1f5.
- **U182 · polish · I2** — a second Esc in the nav search blurs it to `<body>`, so the next Tab starts from the page top. Hand focus to the main content's first stop, or back to where `/` was pressed.
- **U183 · polish · F3** — journeys.md still marks F3's **Pick a random game** ◇, but the table toolbar has it and an e2e edge test locks it. Drop the ◇.

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, how high the table starts at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown;
- prices in any currency but EUR, so B2's repricing can't be judged;
- search results (`/api/search-games`) and bundles carry no image, so the search dropdown's thumbnails and /bundles' Image column show blank;
- a lookup of an appid outside the catalog (`/game/<unknown>`) throws in `fixtures.ts`'s `game()` and kills the `dev:mock` server, rather than answering as a failed lookup;
- a trailer that plays: Hades' fixture trailer has no stream, so playback and its idle-hide can only be seen on the real server.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- On a real phone: trailer playback (headless Chromium showed black frames), pinch and double-tap zoom, swipe-to-close.
- Firefox and Safari: only Chromium was walked (View Transitions are Chromium/Safari-only).
- O1's `GET /api/metrics` (no mock); D1's age highlight, C2's price columns per group, L1's panel **Add to list**, D3 (◇ not started).
