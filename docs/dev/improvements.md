# Improvements

UX backlog from `ux-review` runs against [journeys.md](journeys.md) and [ui-guidelines.md](ui-guidelines.md); last run 2026-10-11. Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

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

None open.

## Loading and feedback

- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.

## Lists and selection

- **U76 · polish · F3** — with **All** chosen, the chip still reads "Genres: Action, RPG", the same as **Any**, though it shows 3 rows instead of 6. Needs an upstream change: say "all of" in the chip (vatesfr/data-table#35).

## Comparing

- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.

## Bundles and prices

None open.

## Ranking

None open.

## Keyboard and accessibility

None open.

## Phone

None open.

## Accounts and first visit

None open.

## Consistency and polish

- **U121 · polish · F1** — ←/→ on a game showing only its Cover while its media streams does nothing visible, yet `stepLightbox` (`public/lightbox.tsx:1164`) clears the take-the-media-when-it-lands latch and marks the Cover chosen, so the screenshots never replace it. Return early when there's nothing to step to.
- **U122 · polish · F1** — a refresh that shrinks a game's media while the lightbox shows it leaves `idx()` past the end: rendering clamps it (`public/lightbox.tsx:1234`), but the caption (`:168`), counter (`:325`) and the leave-memory read (`:1111`) index `shots()[idx()]` unclamped, so paging away records nothing and lands on screenshots. Clamp once where the list changes.
- **U112 · polish** — every table shows a "Page 1 of 1" pager with all buttons disabled when everything fits. Needs an upstream change: hide the pager when there's a single page (an option or the default in `@vates/data-table-solid`, vatesfr/data-table#41).
- **U39 · polish** — nav items shift sideways between routes; missing thumbnails have no placeholder; "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend (still true in Recently Looked Up).

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, how high the table starts at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown;
- a trailer that plays: Hades' fixture trailer has no stream, so playback and its idle-hide can only be seen on the real server.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- On a real phone: trailer playback (headless Chromium showed black frames), pinch and double-tap zoom.
- Partly: R2, R3 at phone width; B4 (the fixture friend's wishlist is empty); D3 (◇ not started).
