# Improvements

UX backlog from the 2026-09-27 review (`ux-review` skill) against [scenarios.md](scenarios.md). Each item names the scenarios it blocks or slows; a dedicated run per item re-walks those scenarios. Severity: **blocker** (goal unreachable) · **major** (reached with confusion or a workaround) · **minor** · **polish**. Remove an item once it ships.

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

- **U1 · blocker · S1** — 🔗 Share view on Owned/Wishlist copies no `?u=`: the recipient gets "No account selected — Games 0". Carry the current account in the link (or offer it as a toggle).
- **U2 · minor · S3** — a `/lists/<id>` link opened elsewhere says "This list no longer exists"; it exists, in the sender's browser. Explain lists are local and point to 🔗 Share list.
- **U3 · minor · L2, S1** — a dynamic list has both "🔗 Share list" and "🔗 Share view", in different places. Merge or explain the difference.

## Loading and feedback

- **U4 · major · A1, F3** — first load of a large library is slow by design (≈ 8 min for 1,179 games; uncached details are throttled), with only "368 / 1179 games loaded…" and unloaded games absent from the table. Progress bar, ETA, one line on why.
- **U5 · major · A1, F1** — while streaming into a sorted table, rows get inserted above the pointer and columns change width, so clicks land on the wrong game. Fix column widths; append or hold new rows ("N new — show").
- **U6 · minor · F1** — nav search with no match shows nothing at all. Add an empty state.
- **U7 · minor · L3** — Reset view drops sort/filters instantly with no undo.

## Lists and selection

- **U8 · major · L1, L4** — the selection toolbar ("Add to list…") sits at the top of the page, not sticky: selecting row 20 gives no visible feedback. Make it sticky/floating.
- **U9 · major · L1** — "+ Create new list…" uses a native `prompt()`, then the toolbar vanishes with no confirmation or link. Inline naming; toast with "Open list".
- **U10 · major · L1** — a list can't be moved into a folder after creation (only Rename/Delete). Add "Move to…".
- **U11 · minor · F3** — Filter popover: category pane too narrow (scrolls sideways); the range shows no field label and raw floats (`0 – 99.0202584`, `380.2666…`); "never played" needs max = 0 and then reads "Played (h): 0–0". Label and round; add a "never played" preset.
- **U12 · minor · L2** — an unnamed Subtract list's `∖` reads as `|` in the tree's italic font. Use "minus" or `−`.
- **U13 · minor · L2, B3** — a dynamic list built from the Wishlist loses its price columns. Keep them when a source has them.

## Comparing

- **U14 · major · C1** — one unresolvable player blocks the whole comparison: grey error line, failing chip unmarked, no "compare the others". Validate inline before navigating; offer to drop that player.
- **U15 · major · C2** — group headings list who's in ("A + B (12)"), never who's missing; "everyone" isn't named as such. "Everyone" / "Everyone but C".
- **U16 · major · C1** — each membership group has its own toolbar (7 groups → 7 sort/filter/column setups) and no persistence, so "sort by rating, filter co-op" is repeated per group. One shared view across groups.
- **U17 · minor · C1** — Player 1 isn't prefilled with my ★ account; the same account twice is accepted silently; the URL is rewritten with players reordered (me no longer first).
- **U18 · minor · C1** — on a failed resolve the heading shows a known account as its steam64 id.
- **U19 · minor · C3** — a saved comparison's auto-name ("X — Owned + Y — Owned — grouped by membership") doesn't match the Compare heading ("X vs. Y").

## Bundles and prices

- **U20 · blocker · B3** — a bundle can't be a combine source (`CombineForm.tsx`), so "what does this bundle add for the household" can't be built — README's tagline promises it. Allow bundle sources (e.g. "Combine…" on the bundle page).
- **U21 · major · B1** — "Cheapest tier" mixes $ and € in one sortable column (region EUR). Convert, or sort per currency and flag USD-only shops.
- **U22 · major · B1** — a bundle page has no "new to you" summary; the owned marker (yellow name + ✓) has no legend. Tile: "Adds N games · €X at best deal".
- **U23 · minor · B1** — every game in a three-tier bundle showed the first tier's price; check the tier mapping against ITAD.

## Ranking

- **U24 · major · R1** — ranking "5 chosen games", stopping, then resuming ranks the whole library; the list reads "4 / 1179 ranked · ≈ 10907 comparisons left". Keep the chosen scope on resume and show progress against it.
- **U25 · minor · R1, F1** — the ranking card says "1.5h main story" where the table says 2.5 in "All (h)" (itself unclear). Pick one HLTB figure and label it.

## Keyboard and accessibility

- **U26 · major · I2** — Esc doesn't leave the nav search box; later shortcuts (r, ?) are typed into it. Esc clears, then blurs.
- **U27 · major · I2, F3** — with no panel open, ↓/Enter/R do nothing; reaching a row takes ~25 Tabs. ↓ / R should open the first / a random row.
- **U28 · minor · F1, I2** — the row whose game is open in the panel isn't highlighted (`aria-selected=false`), so ↑/↓ loses your place. Highlight + `aria-current`.
- **U29 · minor · I2** — Tab reaches the Close button of the hidden shortcuts dialog. Make it `inert` while closed.

## Phone

- **U30 · major · I1, F3** — on a 390 px table the thumbnail takes ~40 % of the width, only name and rating fit, and the table starts halfway down. Smaller thumbnail or card rows; compact the header.
- **U31 · minor · I1** — the game panel is shifted 15 px off the left edge (x = −15), clipping content; the page scrollbar shows beside it.
- **U32 · minor · I1, R1** — the ranking screen stacks cards vertically (Tie/Skip/Undo below the fold) and has no side gutter.
- **U33 · minor · F3** — no random pick on phone until a panel is open (the 🎲 lives in the panel's nav).

## Accounts and first visit

- **U34 · minor · A1** — first-visit Home doesn't say what the app does; the main button reads "Set as current account". One-line intro; "Look up".
- **U35 · minor · A1** — Owned with no account shows "Games 0" and "pick one from Home" (not a link).
- **U36 · minor · A2** — the nav chip's switcher doesn't mark which account is mine (★).
- **U37 · minor · A1, A2** — a stored account slot's `label` is never refreshed from what the account card fetches: a slot without one (seeded, or resolved before labels existed) stays a steam64 id in the chip, Recent accounts, list labels and page title.
- **U38 · minor · A4** — a private friends list shows "Friends (0)" plus two overlapping lines. "Friends (private)".

## Consistency and polish

- **U39 · polish** — `favicon.ico` 404s; nav items shift sideways between routes; missing thumbnails have no placeholder; Released and Added use different date formats; "Demo" pills look like primary buttons; the "Updated" age has very low contrast; Compare's op `<select>` is an unstyled native white control; wishlisted/owned name colours have no legend.

## Review tooling

- **U40** — `scripts/demo-prefs.js` seeds the demo account without `label`/`avatarUrl`, so the demo shows as a steam64 id (see U37). Seed both.
- **U41** — [scenarios.md](scenarios.md) L1 asks to "put it in a folder" while its Edges say move has no UI; S1 assumes Share view adds `?u=`. Update once U10/U1 are decided.

## Not yet reviewed

- A4 (no allowed account has a public friends list); C4–C6, L4, R2, R3, B4, S2 (second pass stopped early); Y1–Y3 (needs a Steam sign-in); D1–D3 (needs upstream-failure stubs); O1.
