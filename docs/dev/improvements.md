# Improvements

UX backlog from the 2026-09-27, two 2026-10-03 the 2026-10-04 header-menu (mocked, `npm run dev:mock`) and the 2026-10-07 phone-lightbox (real dev server, touch emulation) phone panel-media (mocked), broad mocked, slow-media/design (mocked, delayed media) and lightbox-clutter (mocked) reviews (`ux-review` skill) against [journeys.md](journeys.md) and [ui-guidelines.md](ui-guidelines.md). Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

**Pilot** (claude-ux-workflow, from 2026-10-04): items tagged `pilot`, and the ◇ steps of C6, A4 and L1, are frozen. Only the bot's PRs fix them; `ux-fix` and hand fixes leave them alone until the pilot ends.

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

- **U52 · polish · S1 · pilot** — sharing an unchanged layout still sends `tv=%7B%7D`, so the recipient gets "This table uses a layout from a shared link" for a layout that is just the defaults. Omit `tv` when nothing differs.

## Loading and feedback

- **U7 · minor · L3 · pilot** — Reset view drops sort/filters instantly with no undo.
- **U67 · polish · O1 · pilot** — `GET /api/metrics` shows `budgets: {}` until the first outbound call, so an operator can't see the ceilings before spending against them. List every budget group with 0 used.

## Lists and selection

- **U11 · minor · F3** — Filter popover: "never played" needs max = 0 and then reads "Played (h): 0–0". `@vates/data-table-solid` 0.17 added range presets (its rangePresets option); give the Played column a `{ label: 'never played', max: 0 }` preset. (Raw-float bounds and the missing field label were fixed by 0.17.)
- **U76 · polish · F3** — with **All** chosen, the chip still reads "Genres: Action, RPG", the same as **Any**, though it shows 3 rows instead of 6. Needs an upstream change: say "all of" in the chip (vatesfr/data-table#35).

## Comparing

- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.
- **U71 · minor · C6 · pilot** — a comparison has no Played column in any mode, not even mine (`PLAYTIME_COLUMN` is only on Owned and user lists), though the server sends per-account playtime. Add per-player Played columns (C6's ◇).

## Bundles and prices

## Ranking

## Keyboard and accessibility

- **U70 · polish · S2 · pilot** — after the panel's 🔗 copy, the icon becomes ✓ but nothing is announced and `aria-label` stays "Copy link to this game". Announce "Link copied" through a live region.
- **U28 · polish · I2** — the open game's row is highlighted, but not exposed to assistive tech (`aria-current`). `@vates/data-table-solid` 0.17 added a current-row option (currentRow, setting `aria-current`); pass the open game's row to it.

## Phone

- **U32 · minor · I1, R1 · pilot** — the ranking screen stacks cards vertically (Tie/Skip/Undo below the fold) and has no side gutter.
- **U33 · minor · F3 · pilot** — no random pick on phone until a panel is open (the 🎲 lives in the panel's nav).

## Accounts and first visit

- **U34 · minor · A1 · pilot** — first-visit Home doesn't say what the app does; the main button reads "Set as current account". One-line intro; "Look up".

## Consistency and polish

- **U101 · polish** — every table shows a "Page 1 of 1" pager with all buttons disabled when everything fits. Needs an upstream change: hide the pager when there's a single page (an option or the default in `@vates/data-table-solid`, vatesfr/data-table#41).
- **U39 · polish · pilot** — nav items shift sideways between routes; missing thumbnails have no placeholder; "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend (still true in Recently Looked Up).
- **U80 · polish · pilot** — `favicon.ico` 404s.
- **U81 · polish · pilot** — dates read differently across pages: Released and Added differ, as do the Bundles list (`2026-10-13 21:10`) and a bundle's page (`Oct 13, 09:10 PM`).

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, how high the table starts at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown;
- a trailer that plays: Hades' fixture trailer has no stream, so playback and its idle-hide can only be seen on the real server.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- On a real phone: trailer playback (headless Chromium showed black frames), pinch and double-tap zoom.
- Partly: R2, R3 at phone width (the rank screen is U32); B4 (the fixture friend's wishlist is empty); D3 (◇ not started).
