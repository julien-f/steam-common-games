export interface FilterDim {
  key: 'tags' | 'genres' | 'categories' | 'developers' | 'publishers';
  label: string;
  param: string;
}
export const FILTER_DIMS: FilterDim[] = [
  { key: 'tags',       label: 'Tag',       param: 'tag'   },
  { key: 'genres',     label: 'Genre',     param: 'genre' },
  { key: 'categories', label: 'Category',  param: 'cat'   },
  { key: 'developers', label: 'Developer', param: 'dev'   },
  { key: 'publishers', label: 'Publisher', param: 'pub'   },
];

// Canonical query-param order shared by every URL-writing function on both pages. Applying
// this before every pushState/replaceState means the same logical state always serializes to
// the same URL string regardless of the order its pieces happened to be set/mutated in —
// otherwise e.g. opening a game before vs. after adding a tag filter would leave `game` in a
// different position, making two visits to an identical state look like different history
// entries and cluttering the query string with no benefit.
//
// `tv` (table view — a JSON-encoded @vates/data-table-solid view snapshot) is one shared param
// name for every list kind (Owned/Wishlist/Bundle/Recent/a user list), not one per kind — unlike
// the old separate Library/Bundles pages, each `/lists/...` route only ever has one table on
// screen at a time, so there's never a moment where two of these could coexist in the same URL
// the way e.g. `game`/`shot` can. See tableViewPrefs.ts's own restoreTableView/shareTableView/
// resetTableView and ListRoute.tsx's viewParamName. Unlike most other params here, it's not
// written automatically on every table interaction — only by the table's own "🔗 Share view" button.
const PARAM_ORDER = ['u', 'tab', 'sort', 'game', 'shot', 'name', ...FILTER_DIMS.map(d => d.param), 'tv'];

export function reorderUrlParams(params: URLSearchParams): URLSearchParams {
  const ordered = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    for (const v of params.getAll(key)) ordered.append(key, v);
  }
  // Anything not in PARAM_ORDER (forward-compat/unknown params) keeps its relative order,
  // appended after every known param.
  for (const [key, value] of params) {
    if (!PARAM_ORDER.includes(key)) ordered.append(key, value);
  }
  return ordered;
}

// A `history.replaceState`-ready URL for `params`: `<path>?a=1` while anything is left, the bare
// path once nothing is. Every URL-writing function here goes through this rather than a plain
// `?${reorderUrlParams(params)}` template, which leaves a bare trailing `?` in the address bar
// the moment the last param is deleted (closing a game panel, consuming a one-shot `?tv=` link)
// — cosmetic in isolation, but it sticks around in whatever the user copies or bookmarks next,
// and it makes two visits to an identical state serialize differently, exactly what
// reorderUrlParams above exists to prevent.
export function urlWithParams(params: URLSearchParams, pathname: string = location.pathname): string {
  const qs = reorderUrlParams(params).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// `?game=<appid>` / `&shot=<idx>` — the panel/lightbox deep-link params every page with a side
// panel writes on open/close/step. Extracted once `app.tsx`/`library.tsx`/`bundles.tsx` turned
// out to each carry a near-identical hand-copy (bundles.tsx's own copies had drifted from the
// other two: they skipped `reorderUrlParams` entirely, so `?game=`/`?shot=`'s position in the
// URL could differ from the canonical order the rest of the app enforces). Always
// `history.replaceState`, never pushed — opening/closing a game or stepping a lightbox shot
// isn't its own back/forward-navigable step on any of the three pages.
export function setPanelParam(appid: number | string | null): void {
  const params = new URLSearchParams(location.search);
  // A close (appid == null) with neither param already present is a genuine no-op — bail out
  // before touching history at all, rather than always calling replaceState regardless. This
  // matters beyond just avoiding a pointless history entry: AppShell.tsx's shell-level
  // `initPanel({ onClose })` calls this unconditionally on every panel close, including on
  // ListRoute.tsx's 'recent' kind (/game/:appid), which never writes `game` as a query param at
  // all (its own reactive effect strips the appid from the *path* instead, see that file's own
  // comment) — without this check, this would still unconditionally rewrite the URL to
  // whatever `pathname` it read *before* that navigation had actually taken effect, racing that
  // effect's own `navigate()` call and putting the appid straight back (confirmed live: closing
  // the panel on /game/620 briefly produced /game/620 again instead of the intended bare /game;
  // back when this wrote a bare `?${...}` template rather than going through urlWithParams
  // above, it showed up as a pointless `/game/620?` too).
  if (appid == null && !params.has('game') && !params.has('shot')) return;
  params.delete('shot');
  if (appid == null) params.delete('game');
  else params.set('game', String(appid));
  history.replaceState(null, '', urlWithParams(params));
}

export function setLightboxParam(idx: number | string | null): void {
  const params = new URLSearchParams(location.search);
  if (idx == null) params.delete('shot');
  else params.set('shot', String(idx));
  history.replaceState(null, '', urlWithParams(params));
}

export interface UrlState {
  slots: string[][];
  game: number | null;
  shot: string | null;
  sort: { col: string; dir: 1 | -1 } | null;
  nameFilter: string;
  filters: Record<string, string[]>;
}
// One `u=` value per slot, comma-joined identifiers within it (a Steam Family) — see the
// URL & sharing section in docs/dev/frontend.md. Shared by parseUrlState and parseAccountParam below so the
// two can never disagree about what a `u=` value means (whitespace handling, empty entries).
function parseSlots(params: URLSearchParams): string[][] {
  return params.getAll('u')
    .map(s => s.split(',').map(v => v.trim()).filter(Boolean))
    .filter(slot => slot.length > 0);
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const slots = parseSlots(params);
  const sortParam = params.get('sort');
  return {
    slots,
    game:       Number(params.get('game')) || null,
    shot:       params.get('shot'),
    sort:       sortParam ? {
      col: sortParam.startsWith('-') ? sortParam.slice(1) : sortParam,
      dir: sortParam.startsWith('-') ? -1 : 1,
    } : null,
    nameFilter: params.get('name') ?? '',
    filters:    Object.fromEntries(FILTER_DIMS.map(d => [d.key, params.getAll(d.param)])),
  };
}

// ── `?u=` — the account-override param ───────────────────────────────────────────────────────

// The raw `u=` values exactly as they sit in a URL, for forwarding across an internal
// navigation (see withAccountParam below). Kept separate from parseAccountParam's resolved
// view: forwarding must pass the identifiers through untouched (they're what the *user* shared),
// not a re-serialized version of whatever this app made of them.
export function accountParamValues(search: string): string[] {
  return new URLSearchParams(search).getAll('u');
}

export interface AccountParam {
  // The identifiers to resolve as the account being explored — one slot's worth (a plain
  // account, or several comma-joined identifiers for a Steam Family).
  identifiers: string[];
  // Any *further* slots the link carried. A `?u=alice&u=bob` link is an old Comparison-page URL
  // ("compare alice against bob"), a shape the list-centric app has no single route for anymore
  // — a comparison is a dynamic list combining two accounts' Owned lists now (see
  // docs/dev/lists-and-accounts.md). Rather than silently unioning those identifiers into one
  // Family (right games, wrong meaning) or dropping them with no explanation, the first slot is
  // honored as the explored account and the rest are surfaced here so the UI can say so.
  extraSlots: string[][];
}

export function parseAccountParam(search: string): AccountParam {
  const slots = parseSlots(new URLSearchParams(search));
  return { identifiers: slots[0] ?? [], extraSlots: slots.slice(1) };
}

// Carries whatever `u=` the current URL holds onto `path`, so the account being explored via a
// shared link survives clicking around the app instead of evaporating on the first navigation
// (the stored `currentAccount` is sticky by nature; an override has to be made sticky by hand).
// `path` may carry its own query (`/lists/owned?game=440`) — its params win over the ones
// carried over, and the result goes through reorderUrlParams like every other URL this app
// writes. Returns `path` untouched when there's no `u=` to carry, so every call site can use
// this unconditionally rather than branching on whether an override happens to be active.
export function withAccountParam(path: string, search: string = location.search): string {
  const values = accountParamValues(search);
  if (values.length === 0) return path;
  const [pathname, ownQuery] = path.split('?');
  const params = new URLSearchParams(ownQuery ?? '');
  if (!params.has('u')) values.forEach(v => params.append('u', v));
  return `${pathname}?${reorderUrlParams(params)}`;
}

// The current URL with `u=` stripped back out — what an explicit account pick navigates to,
// since the override the param carried is redundant once the user has chosen (see
// accountsStore.ts's `?u=` section and docs/dev/lists-and-accounts.md).
//
// Returns a URL for the *caller* to navigate to (replacing, never pushing — consuming the param
// isn't its own back/forward-navigable step) rather than calling history.replaceState itself
// like setPanelParam above does. That's deliberate: a raw replaceState is invisible to
// @solidjs/router's own location signal, so every href built with withAccountParam would keep
// showing the stripped param until something unrelated re-rendered it (confirmed live — Home's
// Owned/Wishlist links stayed pointed at the old `?u=` after adopting the account). Going
// through the router's navigate() instead updates that signal, and every such href with it.
export function urlWithoutAccountParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('u');
  return urlWithParams(params, pathname);
}
