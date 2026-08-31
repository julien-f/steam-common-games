// Shared "apply an ITAD /api/prices response to a row" logic — extracted from library.js's
// loadWishlistPrices and bundles.js's loadPrices, which map the identical response shape onto
// the identical set of row fields and fall back to the identical "don't leave it stuck on its
// loading placeholder forever" null-out on failure (see CLAUDE.md's Bundles/Wishlist-pricing
// sections). Chunking (library.js only — a wishlist can run past the server's batch cap, a
// bundle's game list never does) and the no-ITAD-configured check (library.js only — bundles.js
// hides its whole page instead) stay local to each caller, since neither is actually shared.
//
// Takes `discountPct` (gameColumns.js) as a parameter rather than importing it directly — same
// reasoning panel.js's own Price card gives for not importing gameColumns.js itself: that file
// pulls in `@vates/data-table-core`, meaningless for this module and for its Node unit tests.
// Both callers already import discountPct for their own column definitions anyway.
import type { PriceFields } from './types.ts';

export const PRICE_FIELDS = [
  'steamRegular', 'bestDealPrice', 'bestDealShop', 'bestDealUrl', 'bestDealCut', 'lowAll', 'lowY1', 'lowM3',
] as const;

// The shape of one game's entry in a `POST /games/prices/v3` response, as extracted server-side
// (lib/itad.js's extractPriceInfo) — only the fields read below.
interface PriceAmount { amount: number; currency: string; }
interface PriceInfo {
  steamRegular?: PriceAmount | null;
  bestDeal?: { price?: PriceAmount | null; shop?: string | null; url?: string | null } | null;
  lowAll?: PriceAmount | null;
  lowY1?: PriceAmount | null;
  lowM3?: PriceAmount | null;
}

// Every figure in one /games/prices/v3 response is in the same requested-country currency, so
// any of them is an equally valid source for priceCurrency — see the matching comment on
// formatMoney (utils.ts)/renderPrice (gameColumns.ts) for why priceCurrency and a bundle's own
// tierCurrency can legitimately disagree. `discountPct` (gameColumns.ts) is passed in rather than
// imported — see the file-header note; its signature here matches utils.ts's own.
export function applyPriceInfo(row: PriceFields, info: PriceInfo | null | undefined, discountPct: (bestDealAmt: number | null, steamRegularAmt: number | null) => number | null): void {
  row.steamRegular  = info?.steamRegular?.amount ?? null;
  row.bestDealPrice = info?.bestDeal?.price?.amount ?? null;
  row.bestDealShop  = info?.bestDeal?.shop ?? null;
  row.bestDealUrl   = info?.bestDeal?.url ?? null;
  row.bestDealCut   = discountPct(row.bestDealPrice, row.steamRegular);
  row.lowAll        = info?.lowAll?.amount ?? null;
  row.lowY1         = info?.lowY1?.amount ?? null;
  row.lowM3         = info?.lowM3?.amount ?? null;
  row.priceCurrency = info?.steamRegular?.currency ?? info?.bestDeal?.price?.currency
    ?? info?.lowAll?.currency ?? info?.lowY1?.currency ?? info?.lowM3?.currency ?? null;
}

// A failed request (rate limited, transient upstream error): fills only whatever this row never
// got a value for, rendered "—" same as any other "no data" case — used for a lookup that may
// have partially succeeded before failing.
export function nullMissingPriceFields(row: PriceFields): void {
  for (const f of PRICE_FIELDS) if (row[f] === undefined) row[f] = null;
}

// No ITAD key configured at all: every field is unconditionally "no data", not just whatever's
// still unset.
export function nullAllPriceFields(row: PriceFields): void {
  for (const f of PRICE_FIELDS) row[f] = null;
  row.priceCurrency = null;
}

// Exactly one of gids/appids, matching POST /api/prices's own contract. Throws with the
// server's own error message on a non-2xx response, same as both callers' pre-extraction code.
export async function postPrices({ gids, appids, country, force = false }: { gids?: string[]; appids?: number[]; country: string; force?: boolean }): Promise<Record<string, PriceInfo>> {
  const qs = new URLSearchParams({ country });
  if (force) qs.set('refresh', '1');
  const res = await fetch(`/api/prices?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gids ? { gids } : { appids }),
  });
  const data: { prices?: Record<string, PriceInfo>; error?: string } = await res.json();
  if (!res.ok) throw new Error(data.error || 'Price lookup failed');
  return data.prices ?? {};
}
