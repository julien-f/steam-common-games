# Improvements

UX backlog from the 2026-09-27 and 2026-10-03 (mocked, `npm run dev:mock`) reviews (`ux-review` skill) against [scenarios.md](scenarios.md). Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Remove an item once it ships.

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
- **U3 · minor · L2, S1** — a dynamic list has both "🔗 Share list" and "🔗 Share view", in different places. Merge or explain the difference.

## Loading and feedback

- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.

## Lists and selection

- **U11 · minor · F3** — Filter popover: category pane too narrow (scrolls sideways); the range shows no field label and raw floats (`0 – 99.0202584`, `380.2666…`); "never played" needs max = 0 and then reads "Played (h): 0–0". Label and round; add a "never played" preset.
- **U13 · minor · L2, B3** — a dynamic list built from the Wishlist loses its price columns. Keep them when a source has them.

## Comparing

- **U17 · minor · C1** — Player 1 isn't prefilled with my ★ account; the same account twice is accepted silently; the URL is rewritten with players reordered (me no longer first).
- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The hero also states the mode twice, as a badge and as the select beside it.
- **U19 · minor · C3** — a saved comparison's auto-name ("X — Owned + Y — Owned — grouped by membership") doesn't match the Compare heading ("X vs. Y").

## Bundles and prices

- **U23 · minor · B1** — every game in a three-tier bundle showed the first tier's price; check the tier mapping against ITAD.

## Ranking

- **U25 · minor · R1, F1** — the ranking card says "1.5h main story" where the table says 2.5 in "All (h)" (itself unclear). Pick one HLTB figure and label it.

## Keyboard and accessibility

- **U50 · polish · I2, B1** — unnamed controls: the bundle page's ‹ › (previous/next bundle) have no accessible name; every table's image column has a sortable "↕" header with no label; the nav's ⚙ renders as an ~8 px glyph, barely visible.
- **U28 · polish · I2** — the open game's row is highlighted, but not exposed to assistive tech (`aria-current`); the table library has no per-row attribute hook.

## Phone

- **U30 · minor · I1, F3** — on a 390 px phone the table now shows name, rating and length, but still starts ~48 % down the screen (Compare ~68 %, a bundle's page ~85 %): the hero card, status line, Share/Reset row and a two-line toolbar sit above it. Collapse them (e.g. hero tiles folded, toolbar on one row).
- **U32 · minor · I1, R1** — the ranking screen stacks cards vertically (Tie/Skip/Undo below the fold) and has no side gutter.
- **U33 · minor · F3** — no random pick on phone until a panel is open (the 🎲 lives in the panel's nav).

## Accounts and first visit

- **U34 · minor · A1** — first-visit Home doesn't say what the app does; the main button reads "Set as current account". One-line intro; "Look up".

- **U44 · minor · B3** — a combined list built from a bundle drops the bundle's games with no Steam listing without a word; the bundle page lists them below its table. Say how many were left out, on the formula line.

## Consistency and polish

- **U39 · polish** — `favicon.ico` 404s; nav items shift sideways between routes; missing thumbnails have no placeholder; Released and Added use different date formats, as do the Bundles list (`2026-10-13 21:10`) and a bundle's page (`Oct 13, 09:10 PM`); "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend.

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or switch in `e2e/mockApi.ts`:

- no images (capsules, avatars): thumbnails and avatars can't be judged (ranking cards still load Steam CDN art directly);
- no bundle ending within 48 h, so B1's "Ending soon" tile never appears;
- no ITAD-not-configured, upstream-failure, slow-stream or large-library mode (A1, B1 edges, D1–D3);
- friends lists always private (A4) and `/api/me` always signed out (Y1–Y3).

## Not yet reviewed

- A4 (no allowed account has a public friends list); C4–C6, L4, R2, R3, B4, S2 (second pass stopped early); Y1–Y3 (needs a Steam sign-in); D1–D3 (needs upstream-failure stubs); O1.
