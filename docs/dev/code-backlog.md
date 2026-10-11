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

- **C95 · cleanup · S** — the other AppShell-mounted singletons have the same always-passed optional options: `bindPanelKeyboardShortcuts` (`public/panelKeyboard.ts:21`, `shortcuts`/`focusSearchInput`/`onEnterOnFocusedRow` and their `opts.x &&` guards, plus `isLightboxOpen`/`isPanelOpen`/`panelClose`/`panelStepHero` taken as options though it imports `panelHandleEscape` directly), `initLightbox` (`public/lightbox.tsx:127`, the `?? null`/`= {}`/`_onGameNav &&` fallbacks) and `initGameSearch`'s `recents`/`onSeeAllRecents`/`onSeeAllResults`. Make them required, import what's importable, trim the per-page header comments.
- **C108 · cleanup · S** — `listsStore.listDeps` is re-implemented in `listLabels.ts:146` (`describeSources`) and inline in `listsStore.ts:252` (`createList`). Call `listDeps`.
- **C110 · cleanup · S** — every `resolveRegion` call passes `getStoredRegion()` (ListRoute, panelData, BundlesBrowseRoute, region.ts), and `prefsPopover.ts:32` hand-rolls `regionLabel(detected)`. One currentRegion() in `region.ts`; call `regionLabel`.
- **C115 · cleanup · S** — `PriceAmount` is declared three times (`bundleData.ts:10`, `bundleRows.ts:12`, `priceLoading.ts:32`), and the 503 → `UnavailableError` mapping is in both `bundleData.fetchBundleById` and `BundlesBrowseRoute`'s `fetchPage` (`:377`). Share the type; move the page fetch into `bundleData.ts`.
- **C116 · cleanup · S** — `public/SearchRoute.tsx` re-implements `gameSearch.ts`'s `/api/search-games` fetch (`:131`) and ✓/☆ ownership markers (`:43`). Share a `searchGames(term)` and the marker builder.
- **C117 · cleanup · S** — smaller hand-rolls: `RankRoute.tsx:179`'s `closest('input, select, textarea')` guard instead of `utils.ts`'s `isTextEntry` (a focused checkbox stops blocking shortcuts); `ranking.ts:46` `clone()` instead of structuredClone on plain JSON state; `PROTON_TIER_COLORS` copied into `panel.tsx:738` to avoid importing the lazy `gameColumns.ts` — move it to `utils.ts` like `scoreColor`.
- **C119 · cleanup · S** — `lib/hltb.js:68-85` hand-rolls a semaphore with a delayed release that `createSemaphore(3, UPSTREAM_MIN_INTERVAL_MS, …)` already is (and would put HLTB's queue in `/api/metrics`); `lib/itad.js` requires `lib/steam.js` only for `createSemaphore`, `upstreamError` is copied in both (`steam.js:90`, `itad.js:31`), `createSemaphore`'s defaults are never used, and observability.md calls it "exported purely for unit testing". Move both into a shared `lib/` module, use it in HLTB, drop the defaults, fix the doc.
- **C120 · cleanup · S** — `server.js` route boilerplate: the `playerById` fallback (`:527`, `:596`) can't fire since `getPlayerSummaries` returns one entry per id (and would drop `placeholder: true`); `/api/common-games`, `/api/wishlist` and `/api/friends` repeat members validation, `MAX_USERS`, `refresh` parsing and id resolve (`:492`, `:558`, `:614`); the `Number(req.params.appid)` check is repeated in four limiter `skip`s and five routes. Index `playerList` directly, one parseMembers helper, `app.param('appid', …)`.
- **C122 · cleanup · S** — `lib/metrics.js`: `buildBucket` (`:214`) wraps its result in `{ groups }` both callers unwrap, and `chargeBudget`'s hourly and daily blocks (`:75-100`) are copies; `lib/steam.js:827`/`:866`'s `Promise.resolve().then(() => res.text())` is `res.text()`; `lib/hltb.js` `pickBestMatch` repeats `getHLTB`'s `™®©` strip, a no-op `?? null` and a rebuild only to drop `sim`. Return the map, loop the windows, simplify.

## Correctness

- **C70 · minor · S** — narrowed: a failed refresh now keeps the Updated tile for every kind, but a dynamic or shared list that failed before it ever fetched still shows no tile, since `public/ListRoute.tsx` only renders it without an age for owned, wishlist and comparison lists. Render it for any list built from account sources (walking its sources), as frontend.md's "rendered unconditionally" asks.
- **C91 · minor · S** — a comparison's 🔗 Share view link never applies its layout: `load()`'s compare branch rewrites the URL to `compareUrl(...)` (`public/ListRoute.tsx:2065`), which has no `tv` param, so the replace drops `?tv=` before `takeSharedView` runs at table build. Carry the view param over into the canonical URL (or take it before the rewrite).
- **C124 · minor · S** — on `/rank` the side panel's tag pills look like filter toggles but do nothing, and ↻ Refresh spins without re-fetching the game's details: `RankRoute.tsx:139` opens the panel but registers no `routeHandlers`, so AppShell's `onTagClick`/`onRefresh` relays (`public/AppShell.tsx:200`) no-op. Register the handlers RankRoute can honour (a details refresh), and render tags as plain pills when no route filters them.

## Security

None open.

## Performance

None open.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.
- **C125 · minor · S** — `lib/itad.js:172`'s `infoLimit` semaphore (`itad-info`) is missing from `GET /api/metrics`' `semaphores`: `getSemaphoreStats` (`lib/steam.js:126`) reports only store/tag/proton, so a queue building up behind ITAD's per-gid info lookups isn't visible. Report it there too.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

- **C92 · minor · S** — the F1 "Price card says when ITAD didn't answer" e2e test's route `/\/api\/(health|prices)$/` (`e2e/scenarios.spec.ts:873`) never matches `/api/prices?country=…`, so only the health failure is exercised and the price-lookup failure path isn't. Match the query string too and check the test still fails without the fix it locks.

## Docs

None open.
