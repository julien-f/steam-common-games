// Human-readable labels for the list model (listsStore.ts/types.ts) — what a combine operation
// is called, and (see below) how a single source reads. Kept out of both listsStore.ts (pure
// CRUD, no presentation) and any one route: a dynamic list's op is named in the hero card
// (ListRoute.tsx), in Home's own combine form, and in its tree, and those wordings drifting
// apart is exactly the kind of thing nobody notices until two screens disagree about the same
// list.
import type { CombineOp } from './types.ts';

// Short form — a chip/label on its own, where surrounding context already says it's a combine.
export const OP_LABELS: Record<CombineOp, string> = {
  union: 'Union',
  intersect: 'Intersect',
  subtract: 'Subtract',
  'group-by-membership': 'Grouped by membership',
};

export function opLabel(op: CombineOp | undefined): string {
  return OP_LABELS[op ?? 'union'];
}
