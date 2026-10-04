# Improvements

UX backlog from the 2026-09-27 and two 2026-10-03 (mocked, `npm run dev:mock`) reviews (`ux-review` skill) against [scenarios.md](scenarios.md) and [ui-guidelines.md](ui-guidelines.md). Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Fix items with the `ux-fix` skill; remove an item once it ships.

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
- **U67 · polish · O1** — `GET /api/metrics` shows `budgets: {}` until the first outbound call, so an operator can't see the ceilings before spending against them. List every budget group with 0 used.

## Lists and selection

- **U11 · minor · F3** — Filter popover: range bounds print raw floats for computed columns (Weighted Rating `93.9813501 – 97.9840615`), the range shows no field label, and "never played" needs max = 0 and then reads "Played (h): 0–0". The table library prints bounds with `String(n)` and has no presets; needs an upstream change: formatting is data-table's backlog U5, presets vatesfr/data-table#30.

## Comparing

- **U51 · polish · C1** — the membership chip reads "↑ Owned by × ⊞ ×": two identical × (remove sort, remove group) side by side. The table library draws that merged chip, so telling the two apart needs an upstream change.
- **U71 · minor · C6** — a comparison has no Played column in any mode, not even mine (`PLAYTIME_COLUMN` is only on Owned and user lists), though the server sends per-account playtime. Add per-player Played columns (C6's ◇).

## Bundles and prices

## Ranking

## Keyboard and accessibility

- **U50 · minor · I2, L4, C5** — the tables' select-all, group and row checkboxes have no accessible name. `@vates/data-table-solid` renders them with no label hook (its own "select all" label goes unused), so this needs an upstream change: name them "Select all", "Select <group>", "Select <game>" (tracked in data-table's own backlog as U1).
- **U70 · polish · S2** — after the panel's 🔗 copy, the icon becomes ✓ but nothing is announced and `aria-label` stays "Copy link to this game". Announce "Link copied" through a live region.
- **U28 · polish · I2** — the open game's row is highlighted, but not exposed to assistive tech (`aria-current`); the table library has no per-row attribute hook.

## Phone

- **U30 · minor · I1, F3** — on a 390 px phone the table now starts ~48 % down the screen on Owned, ~57 % on Compare and a bundle's page (was up to ~85 %): the hero folds and the view buttons are icons, but the toolbar still takes two lines and Share/Reset their own row. Next: move them into the toolbar line once `@vates/data-table-solid` has a toolbar slot (vatesfr/data-table#29).
- **U32 · minor · I1, R1** — the ranking screen stacks cards vertically (Tie/Skip/Undo below the fold) and has no side gutter.
- **U33 · minor · F3** — no random pick on phone until a panel is open (the 🎲 lives in the panel's nav).

## Accounts and first visit

- **U34 · minor · A1** — first-visit Home doesn't say what the app does; the main button reads "Set as current account". One-line intro; "Look up".

## Consistency and polish

- **U39 · polish** — `favicon.ico` 404s; nav items shift sideways between routes; missing thumbnails have no placeholder; Released and Added use different date formats, as do the Bundles list (`2026-10-13 21:10`) and a bundle's page (`Oct 13, 09:10 PM`); "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend (still true in Recently Looked Up).

## Review tooling

States `npm run dev:mock` can't show yet — each needs a fixture or state in `e2e/mockApi.ts`:

- avatars, and a large library (thousands of games: A1's edge, U30 at scale);
- friends lists always private (A4, C4's ◇) and `/api/me` always signed out (Y1–Y3);
- a static wishlist, so R2's "buying a game drops it from the ranking" can't be shown.

## Not yet reviewed

- A4 (no allowed account has a public friends list); Y1–Y3 (needs a Steam sign-in).
- Partly: R2, R3 at phone width (the rank screen is U32); B4 (the fixture friend's wishlist is empty); D3 (◇ not started).
