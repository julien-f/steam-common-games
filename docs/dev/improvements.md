# Improvements

UX backlog from the 2026-09-27 and two 2026-10-03 (mocked, `npm run dev:mock`) reviews (`ux-review` skill) against [scenarios.md](scenarios.md). Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

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

- **U52 · polish · S1** — sharing an unchanged layout still sends `tv=%7B%7D`, so the recipient gets "This table uses a layout from a shared link" for a layout that is just the defaults. Omit `tv` when nothing differs.

## Loading and feedback

- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.
- **U57 · minor · D1** — Updated ↻ on Owned empties the table at once, then re-streams every row (one by one under `mock=slow`, though details are cached), and clears the row selection. Keep the rows and selection on screen and swap in the new set when it lands.
- **U67 · polish · O1** — `GET /api/metrics` shows `budgets: {}` until the first outbound call, so an operator can't see the ceilings before spending against them. List every budget group with 0 used.

## Lists and selection

- **U11 · minor · F3** — Filter popover: category pane too narrow (scrolls sideways); the range shows no field label and raw floats (`0 – 99.0202584`, `380.2666…`); "never played" needs max = 0 and then reads "Played (h): 0–0". Label and round; add a "never played" preset.
- **U61 · minor · C5** — when ProtonDB didn't answer, the Filter's ProtonDB values show one unlabelled blank entry, which would also hold games with no report. Label the empty values ("No report" / "Didn't answer").
- **U62 · minor · L4** — Recently Looked Up defaults to ↓ Weighted Rating and has no Looked-up column, so the latest lookups aren't on top; it silently keeps only the last 10. Default to recency (or add the column) and say "your last 10 lookups".

## Comparing

- **U17 · minor · C1** — Player 1 isn't prefilled with my ★ account; the same account twice is accepted silently; the URL is rewritten with players reordered (me no longer first).
- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The hero also states the mode twice, as a badge and as the select beside it.
- **U58 · minor · C4** — on a comparison, Portal 2's group reads "Owned by: All 3" while the panel's Owned by card lists only Alice. List the comparison's players there, with playtime from `/api/common-games`' `playtime` map.
- **U71 · minor · C6** — a comparison has no Played column in any mode, not even mine (`PLAYTIME_COLUMN` is only on Owned and user lists), though the server sends per-account playtime. Add per-player Played columns (C6's ◇).
- **U19 · minor · C3** — a saved comparison's auto-name ("X — Owned + Y — Owned — grouped by membership") doesn't match the Compare heading ("X vs. Y").

## Bundles and prices

- **U56 · minor · B4, B2, O1** — with no ITAD key, Wishlist still shows Best Deal/Discount columns of "—", a Prices tile with ↻, and the panel says "No pricing data available"; only /bundles says the instance isn't connected to IsThereAnyDeal. Reuse that message on the Prices tile and in the panel, or hide the price columns.

## Ranking

- **U25 · minor · R1, F1** — the ranking card says "1.5h main story" where the table says 2.5 in "All (h)" (itself unclear). Pick one HLTB figure and label it. Still true on a Wishlist ranking (6.3h main story vs. 10.5 All (h)).
- **U63 · minor · R2** — ranking a Wishlist offers "Haven't played — exclude" for games the user doesn't own. Say "Not interested — exclude" when the source isn't Owned.
- **U64 · minor · R2** — 🏆 Rank this list a second time silently creates another "Ranking of Alice — Wishlist"; Home then lists two with the same name. Offer to open the existing ranking of this source.

## Keyboard and accessibility

- **U50 · minor · I2, B1, L4, C5** — unnamed controls: every table's select-all, group and row checkboxes; the bundle page's ‹ › (previous/next bundle); every table's image column (a sortable "↕" header, and "⠿ ×" with no label in the Columns picker); the nav's ⚙ renders as an ~8 px glyph, barely visible. Name them ("Select all", "Select <game>", "Image").
- **U70 · polish · S2** — after the panel's 🔗 copy, the icon becomes ✓ but nothing is announced and `aria-label` stays "Copy link to this game". Announce "Link copied" through a live region.
- **U28 · polish · I2** — the open game's row is highlighted, but not exposed to assistive tech (`aria-current`); the table library has no per-row attribute hook.

## Phone

- **U30 · minor · I1, F3** — on a 390 px phone the table now starts ~48 % down the screen on Owned, ~57 % on Compare and a bundle's page (was up to ~85 %): the hero folds and the view buttons are icons, but the toolbar still takes two lines and Share/Reset their own row. Next: move them into the toolbar line once `@vates/data-table-solid` has a toolbar slot (upstream PR drafted).
- **U32 · minor · I1, R1** — the ranking screen stacks cards vertically (Tie/Skip/Undo below the fold) and has no side gutter.
- **U65 · minor · I1, L4** — row checkboxes are 13×13 px; a tap 12 px below one, inside its 29×45 cell, does nothing. Make the whole select cell the hit target (≥ 24×24).
- **U33 · minor · F3** — no random pick on phone until a panel is open (the 🎲 lives in the panel's nav).

## Accounts and first visit

- **U34 · minor · A1** — first-visit Home doesn't say what the app does; the main button reads "Set as current account". One-line intro; "Look up".

- **U66 · minor · B4** — a friend's empty Wishlist shows only "No games to show.", above the toolbar and apart from the empty table, with no hint it may be private on Steam. Say "Bob's wishlist is empty, or private on Steam", inside the table area.
- **U44 · minor · B3** — a combined list built from a bundle drops the bundle's games with no Steam listing without a word; the bundle page lists them below its table. Say how many were left out, on the formula line.

## Consistency and polish

- **U39 · polish** — `favicon.ico` 404s; nav items shift sideways between routes; missing thumbnails have no placeholder; Released and Added use different date formats, as do the Bundles list (`2026-10-13 21:10`) and a bundle's page (`Oct 13, 09:10 PM`); "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend (still true in Recently Looked Up).
- **U59 · minor · C4, S2, F1** — once the panel body is scrolled, its × is covered by `.panel-header-sticky` and can't be clicked (Esc and swipe still work). Raise the × above the sticky header, or move it into it.
- **U60 · minor · C4** — the panel's section nav keeps "Overview" active after clicking Owned by, HLTB or Achievements when the panel can't scroll that section to the top. Set the active tab on click, or fall back to the last section at the scroll end.
- **U68 · polish · R1, R2** — a ranked list's primary button reads "Compare (all ranked)", while the nav's Compare means comparing libraries. Rename it, e.g. "Rank more" / "Re-rank".
- **U69 · polish · L4, R2** — "Added 2 game(s) to new list…" and "≈ 1 comparisons left". Pluralize.

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, U30 at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- no Borked game and no game without a ProtonDB report (C5's Expect);
- `fetchedAt` fixed at server start: no aged Updated values (D1), and a refresh never visibly changes the age;
- no friend with a wishlist (B4); a 2-game, static wishlist, so R2 gets one pair and "buying drops it from the ranking" can't be shown.

- **U72 · polish · C1, C6, R1, O1** — docs out of step with the app: C1's edge and C6's steps say "the Intersect switch" (it's a Union / Intersect / Subtract / Grouped `<select>`); C6's Expect says membership groups carry the current account's playtime (a comparison has no Played column at all, U71); R1 says "Compare on the list page to resume" (it reads "Compare (all ranked)" once complete); `default.env` says `ITAD_API_KEY` is "only required for the Bundles page" (it also drives Wishlist prices and the panel's price and bundle lines).

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- Partly: R2, R3 at phone width (the rank screen is U32); B4 (the fixture friend's wishlist is empty); D3 (◇ not started).
