# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-10 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)

## Simplify

None open.

## Correctness

- **C67 · major · S** — a failed owned/wishlist fetch becomes an empty set at `public/myOwnership.ts:89` and `cachedAccountId` stays set, so for the rest of the session every row reads "Not Owned", Played shows "—", panel badges and search ✓ vanish. Keep a per-half failed marker so peeks return unknown, and reset `cachedAccountId` so the next `ensureLoading` retries.
- **C70 · minor · S** — narrowed: a failed refresh now keeps the Updated tile for every kind, but a dynamic or shared list that failed before it ever fetched still shows no tile, since `public/ListRoute.tsx` only renders it without an age for owned, wishlist and comparison lists. Render it for any list built from account sources (walking its sources), as frontend.md's "rendered unconditionally" asks.

## Security

None open.

## Performance

None open.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

None open.
