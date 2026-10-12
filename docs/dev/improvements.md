# Improvements

UX backlog from `ux-review` runs against [journeys.md](journeys.md) and [ui-guidelines.md](ui-guidelines.md); last run 2026-10-12. Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

- [Sharing](#sharing)
- [Loading and feedback](#loading-and-feedback)
- [Lists and selection](#lists-and-selection)
- [Comparing](#comparing)
- [Bundles and prices](#bundles-and-prices)
- [Ranking](#ranking)
- [Keyboard and accessibility](#keyboard-and-accessibility)
- [Phone](#phone)
- [Accounts and first visit](#accounts-and-first-visit)
- [Consistency and polish](#consistency-and-polish)
- [Review tooling](#review-tooling)
- [Not yet reviewed](#not-yet-reviewed)

## Sharing

- **U125 · minor · S1, C1, S3** — List, bundle and compare links all preview identically, and a `/lists/<id>` list that exists only in the sender's browser can't be described at all. Server-side per-route `og:title` from the path alone (Owned games, Wishlist, Compare libraries, Shared list, bundle name from cache), generic for `/lists/<id>`.

## Loading and feedback

- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.

## Lists and selection

- **U135 · minor · F3** — at 1440 with the panel closed, random pick has no visible control (R only); phone has a 🎲 in the toolbar. Show the same 🎲 on desktop.
- **U136 · polish · L1, L2** — folder naming uses a native `prompt()` while list naming is inline; "Create combined list" stays on Home while "Save as a list" opens the list; Edit sources shows two Cancel buttons; "Rank this list" is enabled on 0 games. Inline naming, open the new list, one Cancel, disable ranking under 2 games with a reason.
- **U76 · polish · F3** — with **All** chosen, the chip still reads "Genres: Action, RPG", the same as **Any**, though it shows 3 rows instead of 6. Needs an upstream change: say "all of" in the chip (vatesfr/data-table#35).

## Comparing

- **U139 · polish · C4** — panel Owned by reads "never played · not played". One phrase.
- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.

## Bundles and prices

- **U140 · minor · B1** — `/bundles`' "New 2" and "Ending soon 1" filters look like plain stat figures. Style them as toggle chips with a pressed state.
- **U141 · minor · B3** — "What does this add?" drops the bundle's Tier Price and Best Deal columns and has no way back to the bundle. Keep the price columns when a bundle is a source; add a "← <bundle>" link.
- **U142 · minor · F1, B2** — ★ (1-year low) and 🔥 (all-time low) carry their meaning only in `title`. A visible label next to the panel price ("all-time low €8.00").
- **U143 · polish · B1** — the bundle hero has 6 actions in 4 styles, with "← All bundles" far right and ‹ › far left. Put "← All bundles" by ‹ ›; one primary, the rest ghost.
- **U144 · polish · O1** — without `ITAD_API_KEY`, `/bundles` keeps its toolbar, an empty table, pager, Updated and region figures under a one-line notice. One empty-state card instead.

## Ranking

- **U145 · polish · I1** — `/rank`'s keyboard hint bar shows on touch screens. Hide it under `(hover: none)`.

## Keyboard and accessibility

- **U147 · polish · I2** — in the `?` dialog, descriptions start at x 595–677 depending on key count. A two-column grid with a fixed key column.

## Phone

- **U149 · polish · I1** — Home at 390: the nav search touches the left edge; Home's card starts content at x 45 (20 margin + 24 padding) vs 12 on list pages; Recent-account rows wrap an orphan × / star onto a second line. One 12px gutter; fold row actions into ⋯.

## Accounts and first visit

None open.

## Consistency and polish

- **U152 · polish · visual** — number columns (rating, HLTB, Played, price, discount) are start-aligned (digits are tabular). Right-align them and their headers: blocked on @vates/data-table-solid, whose `th`/`td` carry no column key or class and whose column defs have no align option.
- **U153 · polish · visual** — 13 size/weight combinations on Home alone (10–20px, incl. 12.5), plus 10.5 and 18 on list pages. One scale: 11 labels, 13 meta/table, 15 body, 18 title.
- **U157 · polish · F2** — `/search` alone has a centred cyan h1 instead of the list hero, and an empty Image column. Reuse the list hero.
- **U159 · polish · F1** — nav search: a second Esc blurs but keeps the typed text; after a pick the box keeps the game's name. Clear it in both cases.
- **U160 · polish · L3** — data-table popovers: Filter opens on a range slider with no column heading; searching Columns leaves an empty "VISIBLE COLUMNS" header; an open range chip reads "Played (h): 5.0–". Label the pane, hide empty groups, write "≥ 5.0 h". Needs upstream changes in `@vates/data-table-solid`.
- **U121 · polish · F1** — ←/→ on a game showing only its Cover while its media streams does nothing visible, yet `stepLightbox` (`public/lightbox.tsx:1164`) clears the take-the-media-when-it-lands latch and marks the Cover chosen, so the screenshots never replace it. Return early when there's nothing to step to.
- **U122 · polish · F1** — a refresh that shrinks a game's media while the lightbox shows it leaves `idx()` past the end: rendering clamps it (`public/lightbox.tsx:1234`), but the caption (`:168`), counter (`:325`) and the leave-memory read (`:1111`) index `shots()[idx()]` unclamped, so paging away records nothing and lands on screenshots. Clamp once where the list changes.
- **U112 · polish** — every table shows a "Page 1 of 1" pager with all buttons disabled when everything fits. Needs an upstream change: hide the pager when there's a single page (an option or the default in `@vates/data-table-solid`, vatesfr/data-table#41).
- **U39 · polish** — nav items shift sideways between routes; missing thumbnails have no placeholder; "Demo" pills look like primary buttons; the "Updated" age has very low contrast; wishlisted/owned name colours have no legend (still true in Recently Looked Up).

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, how high the table starts at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown;
- prices in any currency but EUR, so B2's repricing can't be judged;
- a Borked ProtonDB game (C5);
- a trailer that plays: Hades' fixture trailer has no stream, so playback and its idle-hide can only be seen on the real server.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- On a real phone: trailer playback (headless Chromium showed black frames), pinch and double-tap zoom.
- Partly: R2, R3 at phone width; B4 (the fixture friend's wishlist is empty); D3 (◇ not started).
