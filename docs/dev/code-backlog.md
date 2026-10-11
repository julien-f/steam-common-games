# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10 · docs 2026-10-11.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)
- [Docs](#docs)

## Simplify

- **C126 · cleanup · M** — about 390 lines of `public/style.css` (`:338-760`, `:997`, `:1040-1172`, `:1333-1382` and their phone overrides) style classes nothing renders any more, left from the pre-redesign pages: `.user-row`, `.btn-remove`, `.results-header`, `.progress-wrap`, `.td-thumb`, `.game-group`, `.group-header`, `.player-slot`, `.family-row`, `.how-it-works`, the `.filter-*` rules, `.site-footer`, `.slot-link` and others (none appears in `public/`, `e2e/` or `@vates/data-table-solid`'s dist). Delete them, keeping the live selectors in `:1357`'s mixed list and `@keyframes spin`.
- **C127 · cleanup · M** — 19 cached getters (`lib/steam.js`, 16 × `return withDedup(`; `lib/itad.js:39`, `:92`, `:461`) repeat the getCached → hit → dedup → fetch → `res.ok` or `upstreamError` → setCache skeleton, so a change to how `force` or a miss works is 19 edits. One cached-getter helper in `lib/upstream.js`, the per-outcome TTL left to each fetch function.
- **C138 · cleanup · S** — `panelHandleEscape` (`public/panel.tsx:319`) has one caller, inside `if (isLightboxOpen())` (`public/panelKeyboard.ts:20`), so its `panelClose()` fallback never runs and the check runs twice; the fullscreen test (`document.fullscreenElement || webkitDoc().webkitFullscreenElement`) is written five times across `public/lightbox.tsx:198`, `:204`, `:220`, `:1118` and `panel.tsx`, and exiting fullscreen twice. A lightbox-side Escape handler and two fullscreen helpers in `lightbox.tsx`.
- **C139 · cleanup · S** — `public/lightbox.tsx` repeats itself: the wheel and pinch handlers (`:648`, `:795`) and `resetLbZoom`/`lbZoomTowardPoint` reset pan and cursor that `applyLbTransform` (`:335`) already resets; the zoom toggle is written three times (`:374`, `:693`, `:863`); the neighbour preload recomputes its sources for the keep set (`:1295-1328`); `stepGameFromLightbox(() => _onGameNav(dir), dir)` appears four times (`:556`, `:557`, `:615`, `:848`); whether a video is showing is read from `lbVideoEl.isConnected`, `.lb-vctrls`' inline display (`:592`) and a leftover `vid.style.display = 'block'` (`:1225`) with its `.lb-video` CSS rule, and the `.lb-img` display test six times. Delete the redundant writes; one helper each.
- **C145 · cleanup · S** — `public/gameColumns.ts`: 12 near-identical column definitions (4 score columns `:801-869`, 4 HLTB `:902-945`, the Steam-price and low columns `:1163-1266`) and the price-tier group pair repeated five times. Local column factories and one price-tier group helper shaped like the library's `numericRangeGroup` (`BundlesBrowseRoute.tsx:230` takes its region-currency variant).
- **C148 · cleanup · S** — `public/prefsPopover.ts` builds the region `<select>` as an HTML string plus imperative wiring (its comments still name a `nav.js` that's gone), costing `AppShell.tsx` an `innerHTML` wrapper with an eslint-disable, an init call and a `querySelector`. A small Solid component; keep `openPrefsPopover`.

## Correctness

- **C150 · minor · S** — the lightbox's Retry (`retryCurrentShot`, `public/lightbox.tsx:300`) loads the image without `renderLightbox`'s `lbImgToken` stale guard, so a retry that finishes after the viewer has stepped on paints the old shot over the new one. Share one guarded image load with `renderLightbox`.
- **C70 · minor · S** — narrowed: a failed refresh now keeps the Updated tile for every kind, but a dynamic or shared list that failed before it ever fetched still shows no tile, since `public/ListRoute.tsx` only renders it without an age for owned, wishlist and comparison lists. Render it for any list built from account sources (walking its sources), as frontend.md's "rendered unconditionally" asks.
- **C91 · minor · S** — a comparison's 🔗 Share view link never applies its layout: `load()`'s compare branch rewrites the URL to `compareUrl(...)` (`public/ListRoute.tsx:2065`), which has no `tv` param, so the replace drops `?tv=` before `takeSharedView` runs at table build. Carry the view param over into the canonical URL (or take it before the rewrite).
- **C124 · minor · S** — on `/rank` the side panel's tag pills look like filter toggles but do nothing, and ↻ Refresh spins without re-fetching the game's details: `RankRoute.tsx:139` opens the panel but registers no `routeHandlers`, so AppShell's `onTagClick`/`onRefresh` relays (`public/AppShell.tsx:200`) no-op. Register the handlers RankRoute can honour (a details refresh), and render tags as plain pills when no route filters them.

## Security

None open.

## Performance

None open.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

- **C92 · minor · S** — the F1 "Price card says when ITAD didn't answer" e2e test's route `/\/api\/(health|prices)$/` (`e2e/scenarios.spec.ts:873`) never matches `/api/prices?country=…`, so only the health failure is exercised and the price-lookup failure path isn't. Match the query string too and check the test still fails without the fix it locks.

## Docs

None open.
