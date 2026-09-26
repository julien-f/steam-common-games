// Pure ranking engine for a ranked list (see docs/dev/lists-and-accounts.md's Ranked lists
// section): binary insertion driven by one-vs-one answers, resumable at any point because the
// whole state is plain data. Every function returns a new state rather than mutating, so the
// compare screen's undo is just a stack of previous states.
//
// The stored state is never pruned to the source: a game that drops out (or a source that fails
// to load for a moment) is only filtered out at read time, so its rank comes back with it. The
// binary search therefore runs over "live" groups — those with at least one in-source member —
// while the cursor's lo/hi stay indices into the stored `groups` array.

export interface RankingCursor {
  appid: number; // the game being inserted
  lo: number; // insertion gap range [lo, hi] into `groups`, narrowed by each answer
  hi: number;
  anchor?: number; // a re-ranked game's old neighbour, asked about first
  gallop?: { dir: 'up' | 'down'; step: number }; // after the anchor: probes 1, 2, 4… live groups away, until an answer turns back
}

export interface RankingState {
  groups: number[][]; // tie groups, best first
  excluded: number[];
  skipped: number[]; // deferred, asked again after every other pending game
  hints?: Record<number, number>; // re-ranked game → its anchor, so its insertion starts from where it was
  cursor?: RankingCursor;
}

export type RankingAnswer = 'candidate' | 'opponent' | 'tie' | 'skip' | 'exclude-candidate' | 'exclude-opponent';

export interface RankingPair {
  candidate: number;
  opponent: number;
}

export const EMPTY_RANKING: RankingState = { groups: [], excluded: [], skipped: [] };

// How the compare screen was opened from the list page — both only pick *which* game is asked
// next, never who it's compared against, so each still lands at its right place in the whole
// ranking (and, answers being consistent, the final order doesn't depend on them).
export interface RankingOptions {
  focus?: Set<number>; // "Compare N selected": only these games are asked about
  order?: number[]; // the table's sort: these are asked first, in this order
}

function clone(state: RankingState): RankingState {
  return {
    groups: state.groups.map(g => [...g]),
    excluded: [...state.excluded],
    skipped: [...state.skipped],
    ...(state.hints ? { hints: { ...state.hints } } : {}),
    ...(state.cursor ? { cursor: { ...state.cursor, ...(state.cursor.gallop ? { gallop: { ...state.cursor.gallop } } : {}) } } : {}),
  };
}

function liveIndices(state: RankingState, source: Set<number>, lo = 0, hi = state.groups.length): number[] {
  const out: number[] = [];
  for (let i = lo; i < hi; i++) if (state.groups[i].some(id => source.has(id))) out.push(i);
  return out;
}

type Probe = { index: number; phase: 'anchor' | 'gallop' | 'bisect' };

// The group the cursor is compared against next: the anchor's, then galloping away from it,
// then plain bisection of what's left.
function probe(state: RankingState, source: Set<number>): Probe | null {
  const { cursor } = state;
  if (!cursor) return null;
  const live = liveIndices(state, source, cursor.lo, cursor.hi);
  if (!live.length) return null;
  if (cursor.anchor !== undefined) {
    const g = state.groups.findIndex(group => group.includes(cursor.anchor as number));
    if (live.includes(g)) return { index: g, phase: 'anchor' };
  }
  if (cursor.gallop) {
    const i = cursor.gallop.dir === 'down' ? cursor.gallop.step - 1 : live.length - cursor.gallop.step;
    if (i >= 0 && i < live.length) return { index: live[i], phase: 'gallop' };
  }
  return { index: live[Math.floor(live.length / 2)], phase: 'bisect' };
}

function dropHint(state: RankingState, appid: number): void {
  if (state.hints) delete state.hints[appid];
}

function isPlaced(state: RankingState, appid: number): boolean {
  return state.groups.some(g => g.includes(appid)) || state.excluded.includes(appid);
}

// Pending games in the order they'll be asked: `order` first, then the rest in source order,
// then skipped ones.
export function pendingAppids(state: RankingState, source: Set<number>, { focus, order = [] }: RankingOptions = {}): number[] {
  const skipped = new Set(state.skipped);
  const asked = (id: number) => source.has(id) && (!focus || focus.has(id)) && id !== state.cursor?.appid && !isPlaced(state, id);
  const fresh = new Set<number>();
  for (const id of [...order, ...source]) if (!skipped.has(id) && asked(id)) fresh.add(id);
  const deferred = state.skipped.filter(asked);
  return [...fresh, ...deferred];
}

// Removes `appid` from its group, dropping the group if emptied and keeping the cursor's gap
// range pointing at the same groups.
function removeFromGroups(state: RankingState, appid: number): void {
  const g = state.groups.findIndex(group => group.includes(appid));
  if (g === -1) return;
  state.groups[g] = state.groups[g].filter(id => id !== appid);
  if (state.groups[g].length) return;
  state.groups.splice(g, 1);
  const { cursor } = state;
  if (!cursor) return;
  if (g < cursor.lo) cursor.lo--;
  if (g < cursor.hi) cursor.hi--;
}

function placeCursor(state: RankingState): void {
  const { cursor } = state;
  if (!cursor) return;
  state.groups.splice(cursor.lo, 0, [cursor.appid]);
  dropHint(state, cursor.appid);
  delete state.cursor;
}

// Brings the state to the next point where an answer is needed — picking the next pending game
// and placing it outright whenever no live group is left to compare against (e.g. the very
// first game). Returns that state and the pair to ask, or a null pair once nothing is pending.
export function nextPair(input: RankingState, source: Set<number>, opts: RankingOptions = {}): { state: RankingState; pair: RankingPair | null } {
  const { focus } = opts;
  const state = clone(input);
  // An insertion left mid-way outside the focus restarts later rather than being asked now.
  if (state.cursor && (!source.has(state.cursor.appid) || (focus && !focus.has(state.cursor.appid)))) delete state.cursor;
  for (;;) {
    if (!state.cursor) {
      const next = pendingAppids(state, source, opts)[0];
      if (next === undefined) return { state, pair: null };
      state.skipped = state.skipped.filter(id => id !== next);
      const anchor = state.hints?.[next];
      state.cursor = { appid: next, lo: 0, hi: state.groups.length, ...(anchor !== undefined ? { anchor } : {}) };
    }
    const p = probe(state, source);
    if (!p) { placeCursor(state); continue; }
    const opponent = state.groups[p.index].find(id => source.has(id)) as number;
    return { state, pair: { candidate: state.cursor.appid, opponent } };
  }
}

// Applies one answer to the pair nextPair returned for this same state/source, then advances
// to the next pair.
export function answer(
  input: RankingState, source: Set<number>, ans: RankingAnswer, opts: RankingOptions = {},
): { state: RankingState; pair: RankingPair | null } {
  const { state: current, pair } = nextPair(input, source, opts);
  if (!pair) return { state: current, pair: null };
  const state = clone(current);
  const cursor = state.cursor as RankingCursor;
  const { index: mid, phase } = probe(state, source) as Probe;
  switch (ans) {
    case 'candidate':
    case 'opponent': {
      const dir = ans === 'candidate' ? 'up' : 'down';
      if (dir === 'up') cursor.hi = mid; else cursor.lo = mid + 1;
      if (phase === 'anchor') cursor.gallop = { dir, step: 1 };
      else if (phase === 'gallop' && cursor.gallop?.dir === dir) cursor.gallop.step *= 2;
      else delete cursor.gallop;
      delete cursor.anchor;
      break;
    }
    case 'tie':
      state.groups[mid].push(cursor.appid);
      dropHint(state, cursor.appid);
      delete state.cursor;
      break;
    case 'skip':
      state.skipped = [...state.skipped.filter(id => id !== cursor.appid), cursor.appid];
      delete state.cursor;
      break;
    case 'exclude-candidate':
      state.excluded.push(cursor.appid);
      dropHint(state, cursor.appid);
      delete state.cursor;
      break;
    case 'exclude-opponent':
      removeFromGroups(state, pair.opponent);
      state.excluded.push(pair.opponent);
      break;
  }
  return nextPair(state, source, opts);
}

// Takes a game out of the ranking (and out of excluded/skipped) so it's asked again, starting
// next to where it was: a game it was tied with, else the one below it, else the one above.
export function rerank(input: RankingState, appid: number): RankingState {
  const state = clone(input);
  if (state.cursor?.appid === appid) delete state.cursor;
  dropHint(state, appid);
  const g = state.groups.findIndex(group => group.includes(appid));
  const anchor = g === -1 ? undefined : state.groups[g].find(id => id !== appid) ?? state.groups[g + 1]?.[0] ?? state.groups[g - 1]?.[0];
  if (anchor !== undefined) state.hints = { ...state.hints, [appid]: anchor };
  removeFromGroups(state, appid);
  state.excluded = state.excluded.filter(id => id !== appid);
  state.skipped = state.skipped.filter(id => id !== appid);
  return state;
}

export function exclude(input: RankingState, appid: number): RankingState {
  const state = rerank(input, appid);
  dropHint(state, appid);
  state.excluded.push(appid);
  return state;
}

// Competition ranking (1, 2, 2, 4) over in-source games only.
export function ranks(state: RankingState, source: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  let next = 1;
  for (const group of state.groups) {
    const live = group.filter(id => source.has(id));
    for (const id of live) out.set(id, next);
    next += live.length;
  }
  return out;
}

export interface RankingProgress {
  ranked: number;
  excluded: number;
  pending: number; // includes the game currently being inserted; only focused games under a focus
  remaining: number; // estimated comparisons left
}

export function progress(state: RankingState, source: Set<number>, { focus }: RankingOptions = {}): RankingProgress {
  const ranked = ranks(state, source).size;
  const excluded = state.excluded.filter(id => source.has(id)).length;
  const hasCursor = !!state.cursor && source.has(state.cursor.appid) && (!focus || focus.has(state.cursor.appid));
  const queued = pendingAppids(state, source, { focus });
  let groups = liveIndices(state, source).length;
  // A re-ranked game is expected to land near its anchor: about 2 answers.
  const cost = (k: number, hinted: boolean) => Math.min(hinted ? 2 : Infinity, Math.ceil(Math.log2(k + 1)));
  let remaining = hasCursor ? cost(liveIndices(state, source, state.cursor!.lo, state.cursor!.hi).length, state.cursor!.anchor !== undefined) : 0;
  if (hasCursor) groups++;
  for (const id of queued) remaining += cost(groups++, state.hints?.[id] !== undefined);
  return { ranked, excluded, pending: queued.length + (hasCursor ? 1 : 0), remaining };
}
