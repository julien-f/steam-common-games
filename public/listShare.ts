// Encodes/decodes a dynamic list's formula (op + sources: ListRef[]) into a compact,
// human-readable URL grammar, so it can be opened by someone with none of it in their own
// storage — the same idea /lists/compare already applies to an account-vs-account comparison
// (urlState.ts's compareUrl/parseAccountParam), generalized to any ListRef kind and to real
// nesting (a `user` source whose own list is itself a dynamic combine).
//
// Grammar:
//   formula ::= op ":(" source (";" source)* ")"
//   source  ::= "o:" accountId | "w:" accountId | "b:" bundleId | "r" | "g:" formula
// `op` is a bare CombineOp string. Parens make a `g:` group's extent unambiguous at any depth —
// unlike a flat separator, nothing stops a source from itself being a `g:...` group, so this
// isn't capped at one level of nesting (that cap, in listLabels.ts's createDefaultNaming, guards
// label *length* only — listResolve.ts already resolves arbitrarily deep). `:;(),` are legal
// unencoded in a URI query component, so a formula reads as plain text in the address bar; only
// the individual accountId/bundleId payloads are defensively encodeURIComponent'd, in case one
// ever contains a character the grammar itself uses.
//
// A `user` source can't travel as a bare listId (meaningless in someone else's storage) — encode
// inlines it into a `g:` group built from that list's own op/sources instead, recursing the same
// way listResolve.ts's resolveRef does for a `user` ref, with the same visited-set cycle backstop.
// Decode does the reverse: each `g:` group becomes a synthetic in-memory GameList (id "shared:0",
// "shared:1", ...) collected into a Map, referenced from its parent as an ordinary
// `{ kind: 'user', listId }` — so resolveListWithSources/listLabels.ts need no changes at all,
// only a ListResolveFetchers.getList/ListNaming.list that check this map first.
import type { CombineOp, GameList, ListRef } from './types.ts';

const OPS: CombineOp[] = ['union', 'intersect', 'subtract', 'group-by-membership'];
const MAX_DEPTH = 50; // mirrors listResolve.ts's own backstop — not expected to bite in practice

export interface EncodableList {
  op?: CombineOp;
  sources?: ListRef[];
}

export type EncodeFailureReason = 'manual-source' | 'cycle-or-too-deep' | 'empty';

export type EncodeResult =
  | { ok: true; formula: string }
  | { ok: false; reason: EncodeFailureReason };

// ── Encode ───────────────────────────────────────────────────────────────────────────────────

export function encodeListFormula(
  list: EncodableList,
  getList: (id: string) => GameList | undefined,
): EncodeResult {
  try {
    const formula = encodeFormula(list.op ?? 'union', list.sources ?? [], getList, new Set(), 0);
    return { ok: true, formula };
  } catch (err) {
    if (err instanceof EncodeError) return { ok: false, reason: err.reason };
    throw err;
  }
}

class EncodeError extends Error {
  reason: EncodeFailureReason;
  constructor(reason: EncodeFailureReason) {
    super(reason);
    this.reason = reason;
  }
}

function encodeFormula(
  op: CombineOp,
  sources: ListRef[],
  getList: (id: string) => GameList | undefined,
  visited: Set<string>,
  depth: number,
): string {
  if (depth > MAX_DEPTH) throw new EncodeError('cycle-or-too-deep');
  if (!sources.length) throw new EncodeError('empty');
  const encoded = sources.map(ref => encodeSource(ref, getList, visited, depth));
  return `${op}:(${encoded.join(';')})`;
}

function encodeSource(
  ref: ListRef,
  getList: (id: string) => GameList | undefined,
  visited: Set<string>,
  depth: number,
): string {
  switch (ref.kind) {
    case 'account-owned':
      return `o:${encodeURIComponent(ref.accountId ?? '')}`;
    case 'account-wishlist':
      return `w:${encodeURIComponent(ref.accountId ?? '')}`;
    case 'bundle':
      return `b:${encodeURIComponent(ref.bundleId ?? '')}`;
    case 'recent-games':
      return 'r';
    case 'user': {
      const listId = ref.listId;
      if (!listId || visited.has(listId)) throw new EncodeError('cycle-or-too-deep');
      const found = getList(listId);
      if (!found) throw new EncodeError('cycle-or-too-deep'); // dangling — nothing to inline
      if (found.kind !== 'dynamic') throw new EncodeError('manual-source');
      const nextVisited = new Set(visited);
      nextVisited.add(listId);
      const inner = encodeFormula(found.op ?? 'union', found.sources ?? [], getList, nextVisited, depth + 1);
      return `g:${inner}`;
    }
    default:
      throw new EncodeError('cycle-or-too-deep');
  }
}

// ── Decode ───────────────────────────────────────────────────────────────────────────────────

export interface DecodedFormula {
  op: CombineOp;
  sources: ListRef[];
  // Every inlined `g:` group, keyed by the synthetic listId its `user` ListRef points at —
  // ListResolveFetchers.getList/ListNaming.list should check this before falling back to the
  // real store, exactly as compareNaming() does for accounts in ListRoute.tsx.
  synthetic: Map<string, GameList>;
}

export function decodeListFormula(raw: string): DecodedFormula | null {
  try {
    const synthetic = new Map<string, GameList>();
    let nextId = 0;
    const makeId = () => `shared:${nextId++}`;
    const { op, sources } = parseFormula(raw, synthetic, makeId);
    return { op, sources, synthetic };
  } catch {
    return null;
  }
}

// Splits a `source (";" source)*` list on top-level `;` only — one not inside a nested `g:(...)`.
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function parseFormula(
  raw: string,
  synthetic: Map<string, GameList>,
  makeId: () => string,
): { op: CombineOp; sources: ListRef[] } {
  const colon = raw.indexOf(':(');
  if (colon === -1 || !raw.endsWith(')')) throw new Error('malformed formula');
  const opRaw = raw.slice(0, colon);
  if (!OPS.includes(opRaw as CombineOp)) throw new Error('unknown op');
  const op = opRaw as CombineOp;
  const body = raw.slice(colon + 2, -1);
  const sources = splitTopLevel(body).map(tok => parseSource(tok, synthetic, makeId));
  if (!sources.length) throw new Error('empty formula');
  return { op, sources };
}

function parseSource(
  token: string,
  synthetic: Map<string, GameList>,
  makeId: () => string,
): ListRef {
  if (token === 'r') return { kind: 'recent-games' };
  if (token.startsWith('o:')) return { kind: 'account-owned', accountId: decodeURIComponent(token.slice(2)) };
  if (token.startsWith('w:')) return { kind: 'account-wishlist', accountId: decodeURIComponent(token.slice(2)) };
  if (token.startsWith('b:')) return { kind: 'bundle', bundleId: decodeURIComponent(token.slice(2)) };
  if (token.startsWith('g:')) {
    const { op, sources } = parseFormula(token.slice(2), synthetic, makeId);
    const id = makeId();
    const now = Date.now();
    const list: GameList = { id, parentId: null, order: 0, createdAt: now, updatedAt: now, kind: 'dynamic', op, sources };
    synthetic.set(id, list);
    return { kind: 'user', listId: id };
  }
  throw new Error(`unknown source token: ${token}`);
}

// ── URL ──────────────────────────────────────────────────────────────────────────────────────

export const SHARED_LIST_PATH = '/lists/shared';

// `formula` is already URL-safe on its own — only unreserved chars and the sub-delims (`:;(),`)
// a query component allows unencoded, since every leaf accountId/bundleId was individually
// encodeURIComponent'd going in (see encodeSource above). Wrapping the whole string in another
// encodeURIComponent here would both escape those sub-delims (defeating the point of choosing a
// grammar that doesn't need it) and double-encode each leaf payload.
export function shareListUrl(formula: string): string {
  return `${SHARED_LIST_PATH}?f=${formula}`;
}
