# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)

## Simplify

- **C93 · cleanup · S** — 25 value exports have no importer outside their own file, tests included: 18 in `public/gameColumns.ts` (`renderScoreNum`, the `PROTON_TIER`/`PRODUCTION_TIER`/`PRICE_STATUS`/`OWNERSHIP_STATUS` orders, comparators and renderers, `renderReleaseDate`, `formatScoreBucket`, `renderCut`, `PRICE_STATUS_COLUMN`), plus `upsertRecentAccount`, `saveRecentGames`, `RECENT_GAMES_PREF_KEY`, `NON_GAME_TYPES`, `stepLightbox`, `SHORTCUT_SECTIONS`, `LB_SWIPE_AXIS_LOCK`. Drop the `export`.
- **C95 · cleanup · S** — the other AppShell-mounted singletons have the same always-passed optional options: `bindPanelKeyboardShortcuts` (`public/panelKeyboard.ts:21`, `shortcuts`/`focusSearchInput`/`onEnterOnFocusedRow` and their `opts.x &&` guards, plus `isLightboxOpen`/`isPanelOpen`/`panelClose`/`panelStepHero` taken as options though it imports `panelHandleEscape` directly), `initLightbox` (`public/lightbox.tsx:127`, the `?? null`/`= {}`/`_onGameNav &&` fallbacks) and `initGameSearch`'s `recents`/`onSeeAllRecents`/`onSeeAllResults`. Make them required, import what's importable, trim the per-page header comments.
- **C97 · cleanup · M** — `public/panelData.ts:105-219`'s news/achievements/price/bundles fetchers each repeat the same set-or-keep-previous cache block, and `public/panel.tsx:478-540`'s four resources each repeat peekX then "!force && cached !== undefined ? cached : fetchX". One `sessionCached(map, key, load, force)` returning the cached value synchronously (no pending tick) or the promise; drops the peekX exports.
- **C98 · cleanup · S** — `initHeroSwipe` and `initPanelSwipe` (`public/panel.tsx:2463`, `:2527`) hand-roll the axis lock (8/6 px dead zone, 1.2× bias) that `lightboxSwipe.ts`'s `decideSwipeAxis` already implements, its comment saying "Same bias as panel.tsx's own swipes". Share it (lock distance as a parameter) across all three.
- **C99 · cleanup · M** — table-view persistence is half-shared: `tableViewPrefs.ts:52` `bindViewPersistence` (and `DataTableLike.onViewChange`) has no caller, while `ListRoute.tsx:567` and `BundlesBrowseRoute.tsx:338` each rebuild it as an effect; `viewParamName()` (`ListRoute.tsx:1805`) and `VIEW_PARAM` (`BundlesBrowseRoute.tsx:94`) are both always `'tv'`; the unsaved-view banner (`ListRoute.tsx:3424` vs `BundlesBrowseRoute.tsx:541`), the discard handler and the Share/Default view buttons are copied. Move the effect helper and the param into `tableViewPrefs.ts`, drop the param argument, extract an `UnsavedViewBanner` next to `SharedViewBanner.tsx`.
- **C101 · cleanup · M** — `load()`'s compare and shared branches (`public/ListRoute.tsx:2054`, `:2176`) build the same in-memory `GameList` literal (a third in `listShare.ts:169`), and those two plus the user branch (`:2131`) repeat the resolve → `setListSources` → groups-or-flatten → catch block; `isGroupMode &&` is redundant with `Array.isArray`. An `inMemoryDynamicList(op, sources)` helper and one resolve-into-rows helper.
- **C102 · cleanup · S** — price loading in `public/ListRoute.tsx`: bundle and wishlist rows set the nine price fields to `undefined` explicitly (`:2279`, `:2341`), which a missing field already reads as; `loadWishlistPrices` and `loadBundlePrices` (`:1626`, `:1759`) duplicate the apply/null-out/status code, and their callers map rows to `{ appid }` for nothing; `applyPriceInfo` (`priceLoading.ts:49`) still takes `discountPct` as a parameter though it now lives in `utils.ts`, which that file imports. Delete the blocks, merge the two loaders, import `discountPct`.
- **C103 · cleanup · S** — `selectedBestDeals` (`public/ListRoute.tsx:2690`) and the "New to you" tile repeat "one row per gid, convert, sum or null", and `onePerGid` (`:2628`) and the Fanatical picks (`:2678`) each rebuild the same `gidOf` map. One `sumBestDeals(rows, currency)` and one memoized `gidOf`.
- **C104 · cleanup · S** — single-purpose leftovers in the list route: `accountChipLabel` (`public/ListRoute.tsx:2971`) re-implements `accountDisplayLabel`, which exists to replace exactly that; `activeTable()` (`:1236`) just returns `table` (and `:1118`'s comment still describes per-group tables); `listShare.ts:27`'s `OPS` repeats `OP_LABELS`' keys. Use the helper, inline, `in OP_LABELS`.
- **C105 · cleanup · S** — the `ResolvedAccountSummary` → `AccountSlot` literal is copied four times (`authStore.ts:136`, `accountOverride.ts:92`, `HomeRoute.tsx:243`, `ListRoute.tsx:1999`), two inlining `accountIdFor`; `HomeRoute`'s `pickAccount` duplicates `AccountChip`'s pick and `selectAccount` (`:264`) is an alias of it. One `accountSlotFromSummary(summary, rawInputs)` in `accountsStore.ts` and one shared adopt-account function.
- **C108 · cleanup · S** — `listsStore.listDeps` is re-implemented in `listLabels.ts:146` (`describeSources`) and inline in `listsStore.ts:252` (`createList`). Call `listDeps`.
- **C110 · cleanup · S** — every `resolveRegion` call passes `getStoredRegion()` (ListRoute, panelData, BundlesBrowseRoute, region.ts), and `prefsPopover.ts:32` hand-rolls `regionLabel(detected)`. One currentRegion() in `region.ts`; call `regionLabel`.
- **C111 · cleanup · S** — `withMissingGroup`/`formatMissingGroup` (`public/gameColumns.ts:433`) work around a gap `@vates/data-table-core` 0.17 closed: its bucketers return `null` for missing values and it ships numericRangeGroup/datePartGroup with a `missingLabel`. Use those for the HLTB, release-date and Discount columns (`gameColumns.ts`, `BundlesBrowseRoute.tsx:221,265,288`, `ListRoute.tsx:304,327`); keep the wrappers only for the custom buckets that coerce `null` to 0.
- **C112 · cleanup · S** — the "order list + `indexOf`" comparator is hand-written six times (`compareProtonTier`, `compareProductionTier`, `comparePriceStatus`, `compareOwnershipStatus` in `gameColumns.ts`; `compareEndsIn`, `compareBundleAge` in `bundleRows.ts`), and `renderPriceStatus`/`renderOwnershipStatus` (`gameColumns.ts:597`, `:680`) are one tier-pill renderer. `compareByOrder(order)` and `renderTierLabel(tiers)`.
- **C115 · cleanup · S** — `PriceAmount` is declared three times (`bundleData.ts:10`, `bundleRows.ts:12`, `priceLoading.ts:32`), and the 503 → `UnavailableError` mapping is in both `bundleData.fetchBundleById` and `BundlesBrowseRoute`'s `fetchPage` (`:377`). Share the type; move the page fetch into `bundleData.ts`.
- **C116 · cleanup · S** — `public/SearchRoute.tsx` re-implements `gameSearch.ts`'s `/api/search-games` fetch (`:131`) and ✓/☆ ownership markers (`:43`). Share a `searchGames(term)` and the marker builder.
- **C117 · cleanup · S** — smaller hand-rolls: `RankRoute.tsx:179`'s `closest('input, select, textarea')` guard instead of `utils.ts`'s `isTextEntry` (a focused checkbox stops blocking shortcuts); `ranking.ts:46` `clone()` instead of structuredClone on plain JSON state; `PROTON_TIER_COLORS` copied into `panel.tsx:738` to avoid importing the lazy `gameColumns.ts` — move it to `utils.ts` like `scoreColor`.
- **C119 · cleanup · S** — `lib/hltb.js:68-85` hand-rolls a semaphore with a delayed release that `createSemaphore(3, UPSTREAM_MIN_INTERVAL_MS, …)` already is (and would put HLTB's queue in `/api/metrics`); `lib/itad.js` requires `lib/steam.js` only for `createSemaphore`, `upstreamError` is copied in both (`steam.js:90`, `itad.js:31`), `createSemaphore`'s defaults are never used, and observability.md calls it "exported purely for unit testing". Move both into a shared `lib/` module, use it in HLTB, drop the defaults, fix the doc.
- **C120 · cleanup · S** — `server.js` route boilerplate: the `playerById` fallback (`:527`, `:596`) can't fire since `getPlayerSummaries` returns one entry per id (and would drop `placeholder: true`); `/api/common-games`, `/api/wishlist` and `/api/friends` repeat members validation, `MAX_USERS`, `refresh` parsing and id resolve (`:492`, `:558`, `:614`); the `Number(req.params.appid)` check is repeated in four limiter `skip`s and five routes. Index `playerList` directly, one parseMembers helper, `app.param('appid', …)`.
- **C122 · cleanup · S** — `lib/metrics.js`: `buildBucket` (`:214`) wraps its result in `{ groups }` both callers unwrap, and `chargeBudget`'s hourly and daily blocks (`:75-100`) are copies; `lib/steam.js:827`/`:866`'s `Promise.resolve().then(() => res.text())` is `res.text()`; `lib/hltb.js` `pickBestMatch` repeats `getHLTB`'s `™®©` strip, a no-op `?? null` and a rebuild only to drop `sim`. Return the map, loop the windows, simplify.

## Correctness

- **C70 · minor · S** — narrowed: a failed refresh now keeps the Updated tile for every kind, but a dynamic or shared list that failed before it ever fetched still shows no tile, since `public/ListRoute.tsx` only renders it without an age for owned, wishlist and comparison lists. Render it for any list built from account sources (walking its sources), as frontend.md's "rendered unconditionally" asks.
- **C91 · minor · S** — a comparison's 🔗 Share view link never applies its layout: `load()`'s compare branch rewrites the URL to `compareUrl(...)` (`public/ListRoute.tsx:2065`), which has no `tv` param, so the replace drops `?tv=` before `takeSharedView` runs at table build. Carry the view param over into the canonical URL (or take it before the rewrite).

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
