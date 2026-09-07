// /bundles — browse/discover current Steam bundles via IsThereAnyDeal (see
// docs/list-centric-redesign.md and the implementation plan's Phase 5 step 5). Ported from
// bundles.tsx's own bundle-list browsing UI (loadBundles/BundleListView/cheapestTierPrice/
// fmtBundleListPrice/fmtExpiry), simplified: opening a bundle here always navigates to
// /lists/bundle/:bundleId (ListRoute.tsx's `bundle` kind) instead of rendering the resolved
// game table inline the way the legacy page does — this route is only ever the "which bundle do
// you want" picker, not the bundle detail view too. No `?bundle=` deep-link/list-collapse/
// region-reopen-in-place state to carry over either; those are legacy-page-specific polish, not
// core browsing behavior.
import { createSignal, For, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { getStoredRegion, resolveRegion } from './region.ts';
import { setBrowsedBundles } from './bundleBrowseStore.ts';

const BUNDLES_PAGE_SIZE = 20;

interface PriceAmount { amount: number; currency: string }
interface BundleListItem {
  id: number;
  title: string;
  page: { name?: string } | null;
  counts: { games?: number } | null;
  expiry: string | null;
  tiers: { price: PriceAmount | null }[];
}

// Cheapest tier that actually has a price — `null` means no tier had one at all (a "Build Your
// Own N Bundle" pick-and-mix format, never a free bundle: a genuinely free/$0 tier still has a
// real, truthy price object).
function cheapestTierPrice(bundle: BundleListItem): PriceAmount | null {
  const priced = (bundle.tiers || []).filter(t => t.price);
  if (!priced.length) return null;
  return priced.reduce((min, t) => (t.price as PriceAmount).amount < min.amount ? (t.price as PriceAmount) : min, priced[0].price as PriceAmount);
}

function fmtBundleListPrice(price: PriceAmount | null): string {
  if (!price) return 'Price varies';
  if (price.amount === 0) return 'Free';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
}

function fmtExpiry(expiry: string | null): string {
  if (!expiry) return '';
  const d = new Date(expiry);
  return isNaN(d.getTime()) ? '' : `ends ${d.toISOString().slice(0, 10)}`;
}

export default function BundlesBrowseRoute() {
  const navigate = useNavigate();
  const [bundles, setBundles] = createSignal<BundleListItem[]>([]);
  const [statusText, setStatusText] = createSignal('');
  const [sort, setSort] = createSignal('-publish');
  const [includeExpired, setIncludeExpired] = createSignal(false);
  const [loadMoreHidden, setLoadMoreHidden] = createSignal(true);
  let offset = 0;

  async function load({ reset = true }: { reset?: boolean } = {}) {
    if (reset) { offset = 0; setBundles([]); }
    setStatusText('Loading bundles…');
    const qs = new URLSearchParams({
      country: resolveRegion(getStoredRegion()),
      sort: sort(),
      expired: String(includeExpired()),
      offset: String(offset),
      limit: String(BUNDLES_PAGE_SIZE),
    });
    try {
      const res = await fetch(`/api/bundles?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load bundles');
      const next = reset ? data.bundles : [...bundles(), ...data.bundles];
      setBundles(next);
      // Feeds /lists/bundle/:bundleId's prev/next nav — see bundleBrowseStore.ts's own comment.
      setBrowsedBundles(next.map((b: BundleListItem) => ({ id: b.id, title: b.title })));
      offset += data.bundles.length;
      setStatusText(bundles().length ? `${bundles().length} bundles` : 'No current bundles');
      setLoadMoreHidden(data.bundles.length < BUNDLES_PAGE_SIZE);
    } catch (err) {
      setStatusText(`Error: ${(err as Error).message}`);
    }
  }

  onMount(() => load());

  return (
    <div class="bundles-browse-route">
      <div class="bundles-controls">
        <select value={sort()} onChange={e => { setSort(e.currentTarget.value); load(); }}>
          <option value="-publish">Newest</option>
          <option value="-games">Most games</option>
          <option value="expiry">Ending soon</option>
        </select>
        <label>
          <input type="checkbox" checked={includeExpired()} onChange={e => { setIncludeExpired(e.currentTarget.checked); load(); }} />
          Include expired
        </label>
      </div>
      <div class="bundles-status">{statusText()}</div>
      <div class="bundle-list">
        <For each={bundles()}>
          {bundle => {
            const price = cheapestTierPrice(bundle);
            return (
              <button type="button" class="bundle-item" onClick={() => navigate(`/lists/bundle/${bundle.id}`)}>
                <span class="bundle-item-title">{bundle.title}</span>
                <span class="bundle-item-shop">{bundle.page?.name || ''}</span>
                <span class="bundle-item-price">{fmtBundleListPrice(price)}</span>
                <span class="bundle-item-count">{bundle.counts?.games ?? '?'} games</span>
                <span class="bundle-item-expiry">{fmtExpiry(bundle.expiry)}</span>
              </button>
            );
          }}
        </For>
      </div>
      {!loadMoreHidden() && (
        <button type="button" class="btn btn-ghost" onClick={() => load({ reset: false })}>Load more</button>
      )}
    </div>
  );
}
