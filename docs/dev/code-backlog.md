# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10 · docs 2026-10-12.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)
- [Docs](#docs)

## Simplify

None open.

## Correctness

- **C154 · minor · S** — the panel's ↻ Refresh does nothing on `/search`: `public/SearchRoute.tsx:252` registers no `refreshGame` (`public/AppShell.tsx:202` calls `routeHandlers.refreshGame?.`), so the spinner-less click is silently dropped. Register one that refetches `/api/game-details/:appid?refresh=1` and updates the shown result, sharing RankRoute's once its follow-up lands.

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

## Docs

- **C159 · minor · S** — `docs/user/features.md` misses shipped features: the screenshot lightbox and its keys (Enter, ↑/↓, F, Z, Space/M, swipe — `public/lightbox.tsx`, `public/ShortcutsModal.tsx:51`); per-player Played columns and the "never played" preset in comparisons (`public/ListRoute.tsx:263`, `:271`); chat link previews (Sharing, ~line 108); the bundle browser's Include expired (`public/BundlesBrowseRoute.tsx:472`). Line 36's "never stored, never stale" contradicts line 127 and the Updated tile (server-cached, with an age); line 82's "switch it to Intersect" undersells the mode menu's four operations. Add each in its section.
- **C160 · minor · S** — `docs/dev/frontend.md` drift: line 331's Known gap (panel self-prices every game) is fixed (`public/panel.tsx:491`); lines 153–163 miss recent's Looked up column and default sort (`public/ListRoute.tsx:339`, `:2244`), compare's Played columns and price columns on user lists with a priced source (`:475`); lines 207/217/225 put a Prices tile on owned lists (it shows only when `hasPrices()`, `:2638`); line 276's panel section order is wrong and omits the description card and bundle lines (`public/panel.tsx:2304`–`2410`); line 56 misses RankRoute and the 404 page navigating to `/game/:appid`; lines 54/224/310 miss recent rewriting the path instead of `?game=` (`public/ListRoute.tsx:1302`); line 133's "one deliberate exception" ignores `public/BundlesBrowseRoute.tsx:308`; the module map lacks AccountFriends, authStore, bundleSnapshots, CombineForm, fanaticalPicks, syncedPrefKeys, currency and membershipColumn.
