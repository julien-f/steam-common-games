# Decisions

Choices that look wrong without their reasoning: the numbers this app derives itself rather than reading off an upstream (columns in `public/gameColumns.ts`, lines in the side panel — see [frontend.md](frontend.md)), and tooling choices.

## Ratings — Wilson score vs. Weighted Rating

- **Wilson Score** (hidden by default): the Wilson score lower bound at 95% confidence, computed server-side in `getGameRating`/`computeRating` from Steam's review counts. Never replace it with positive/total: that lets 2 positive reviews outrank 50,000 mostly positive ones.
- **Weighted Rating** (default-visible, default sort): `computeSteamdbRating(positive, total)` in `public/utils.ts`, client-side from the same counts — `p − (p − 0.5) × 2^(−k × log₁₀(n + 1))`, `p = positive/total`, `n = total`, `k = STEAMDB_RATING_SHRINK_STRENGTH`. A shrinkage toward 50% that fades with review volume; always between 50 and `p`, approaching `p` monotonically.
  - Adapted from SteamDB's formula ([steamdb.info-issues#793](https://github.com/SteamDatabase/steamdb.info-issues/issues/793)), which uses `k = 1` (90% over 100 reviews → 80%). This app uses `k = 2` (→ ~87–88%), converging faster — a tuning choice, so don't expect parity with SteamDB.
  - Returns the unrounded value: round only for display, so the column sorts deterministically between equal displayed integers. Not groupable — grouping on a raw value gives one row per group.
  - `computeSteamdbRating` and the `steamdbRating` row key keep their names: renaming the key would break shared view links (`?tv=`) that sort or filter on it.
- **Steam %**: the raw ratio, hidden by default.
- **The side panel** shows only the Weighted Rating ("Weighted", linking to the game's Steam reviews) plus a reviews line ("99% positive of 465k reviews") — no Wilson score, no Steam summary tier ("Very Positive"). A table showing Wilson Score beside the panel reports two different numbers for the same game: expected.

## Production Tier — a heuristic, not Steam-provided data

Steam has no budget or studio-size field, so "Production Tier (est.)" (hidden by default) is a best-effort AAA/AA/Indie guess, `computeProductionTier` in `public/utils.ts`, from three signals every row already has:

- `meta.isFree`/`meta.priceInitial` — the undiscounted price in USD cents (`getAppDetails` pins `cc=us`);
- `rating.total` — review count, a reach proxy;
- whether a Metacritic entry exists — press coverage skips most indie releases.

Decision order:

1. DLC (`meta.fullgame` set) and non-game types (`dlc`/`demo`/`music`/`video`/`series`/`episode`/`mod`/`hardware`/`advertising`) → `null`: a cheap DLC of a AAA game would read as Indie, and looking up the parent costs a fetch.
2. Free-to-play → judged on review volume alone, against a high bar (200k+).
3. ≥ $50 → AAA. $20–$50 → AA with 20k+ reviews or a Metacritic entry, else Indie. < $20 → Indie whatever the reviews (Vampire Survivors, Stardew Valley, Terraria stay Indie).

- **No publisher/developer allowlist**: it would be the strongest signal, but needs externally maintained knowledge (name variants, acquisitions, spin-offs); the heuristic stays self-updating from Steam's data.
- **Accepted misclassifications**: cheap rereleases of old AAA IP, prestige-priced niche sims from small studios, veteran-founded studios shipping a small polished game. Hence "(est.)" in the label.

## Linting: Babel, not typescript-eslint

- `eslint.config.mjs` parses with `@babel/eslint-parser`: TypeScript 7 (`tsgo`) ships no JavaScript compiler API, so `@typescript-eslint/parser` can't run here, and its peer range refuses `typescript@7`. None of the Solid rules are type-aware, so a syntax-only parser loses nothing.
- `eslint-plugin-solid` still pulls `@typescript-eslint/utils` for its helpers; `package.json`'s `overrides` point those packages' `typescript` peer at the root spec, silencing the `ERESOLVE` warnings without changing what loads.
- The `@babel/*` packages are explicit devDependencies rather than relying on `vite-plugin-solid` hoisting them.
