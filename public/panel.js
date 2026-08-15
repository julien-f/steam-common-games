'use strict';

// ── Shared game side panel ──────────────────────────────────────────────────
// Used by both the comparison page (app.js) and the Library Explorer
// (library.js). Depends on globals from utils.js, mediaItems.js, and
// lightbox.js (all loaded as classic scripts before this one).
//
// Host pages call initPanel(options) once, then panelOpen(game)/panelClose()
// to show/hide it. Anything page-specific — the "Owned by" section, tag-click
// filtering, the nav bar's list of games — is left to the host page via
// options or by wrapping panelOpen/panelClose with its own extra logic.
// `options.onClose` specifically exists because panelClose() itself is called from more
// places than just the host's own code (the backdrop click, × button, and swipe-to-close
// all call it directly) — a host that needs to run cleanup on every close (not just the
// ones it explicitly triggers) should do it there rather than in a wrapper around
// panelClose(), which those other paths would silently bypass.
// pickRandomFrom() below is a generic "shuffle bag" usable by both pages.

let panelOptions = {};
let panelGame = null;
let heroIdx = 0;
let panelPrevFocus = null;
let panelRefreshing = false; // true while the host's onRefresh() is in flight

function panelShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const randomQueues = new Map(); // queueKey → remaining shuffled games

// Picks the next game from a shuffle bag scoped to queueKey (e.g. a group key,
// or a fixed constant for a page with only one list) so repeated picks cycle
// through every item before repeating. The bag is rebuilt when exhausted or
// when `list` no longer matches what's left in it (e.g. after filtering).
function pickRandomFrom(list, queueKey, currentAppid) {
  if (!list.length) return null;
  let queue = randomQueues.get(queueKey) || [];
  const ids = new Set(list.map(g => g.appid));
  const queueValid = queue.length > 0 && queue.every(g => ids.has(g.appid));
  if (!queueValid) {
    const remaining = panelShuffle(list).filter(g => g.appid !== currentAppid);
    queue = remaining.length ? remaining : panelShuffle(list);
  }
  const pick = queue.shift();
  randomQueues.set(queueKey, queue);
  return pick;
}

function clearRandomQueue(queueKey) {
  randomQueues.delete(queueKey);
}

function clearAllRandomQueues() {
  randomQueues.clear();
}

function initPanel(options = {}) {
  panelOptions = options;

  document.getElementById('panel-backdrop').addEventListener('click', panelClose);
  document.getElementById('panel-close').addEventListener('click', panelClose);

  // Delegated on #panel-body (a stable element that only has its innerHTML replaced)
  // rather than bound directly to #panel-hero — the hero now lives inside #panel-body's
  // generated markup (see renderPanelBody) and is recreated from scratch on every
  // render, so a listener attached straight to the old hero node would go stale/detached
  // the moment the panel re-renders (including at init time, before the first
  // panelOpen() has rendered anything at all).
  const panelBodyEl = document.getElementById('panel-body');
  panelBodyEl.addEventListener('click', e => {
    if (!e.target.closest('.panel-hero')) return;
    const thumb = e.target.closest('.panel-film-item');
    if (thumb) { heroIdx = Number(thumb.dataset.idx); renderPanelHero(); return; }
    if (e.target.closest('.panel-hero-prev')) { panelStepHero(-1); return; }
    if (e.target.closest('.panel-hero-next')) { panelStepHero(1); return; }
    if (e.target.closest('.panel-hero-img')) openLightbox(panelGame, heroIdx);
  });
  panelBodyEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.panel-hero-img')) { e.preventDefault(); openLightbox(panelGame, heroIdx); }
  });
  panelBodyEl.addEventListener('wheel', e => {
    const strip = e.target.closest('.panel-filmstrip');
    if (!strip) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  document.getElementById('game-panel').addEventListener('click', e => {
    if (e.target.closest('.panel-refresh-btn')) { handlePanelRefresh(); return; }
    const btn = e.target.closest('.panel-tag-btn');
    if (!btn || !panelOptions.onTagClick) return;
    panelOptions.onTagClick(btn.dataset.dim, btn.dataset.val);
  });

  initPanelSwipe();
  initHeroSwipe();
}

function isPanelOpen() { return panelGame != null; }
function getPanelGame() { return panelGame; }

// Forces a fresh rating/HLTB/store-metadata/tags fetch for the open game, bypassing
// its cache TTL. The actual fetch + state update is host-specific (app.js updates its
// `games` array and table row; library.js updates its data-table row) — panelOptions.onRefresh
// does that and panel.js only owns the button's disabled/spinning state and re-render.
async function handlePanelRefresh() {
  if (!panelGame || panelRefreshing || !panelOptions.onRefresh) return;
  const game = panelGame;
  panelRefreshing = true;
  renderPanelBody(game);
  try {
    await panelOptions.onRefresh(game);
  } finally {
    panelRefreshing = false;
    if (panelGame === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// dir: -1 (previous) or 1 (next). wrap: true for keyboard arrow navigation
// (cycles through all media), false for the hero prev/next buttons (clamps
// at the ends — the next button is disabled once heroIdx is at the last item).
function panelStepHero(dir, { wrap = false } = {}) {
  if (!panelGame) return false;
  const items = getPanelItems();
  if (wrap) {
    if (items.length <= 1) return false;
    heroIdx = (heroIdx + dir + items.length) % items.length;
  } else {
    heroIdx = Math.max(0, heroIdx + dir);
  }
  renderPanelHero();
  if (wrap) document.getElementById('panel-hero').querySelector('.panel-hero-img')?.focus();
  return true;
}

function panelOpen(game) {
  panelGame = game;
  heroIdx = 0;
  panelPrevFocus = document.activeElement;
  document.getElementById('panel-body').scrollTop = 0;
  renderPanelBody(game);
  document.getElementById('game-panel').classList.add('open');
  document.getElementById('panel-backdrop').classList.add('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) el.inert = true;
  }
  (document.getElementById('panel-hero').querySelector('.panel-hero-img') ?? document.getElementById('panel-close')).focus();
}

// `preserveUrl`: threaded through to `onClose` unchanged — for a host that clears
// `?game=`/`&shot=` there, this lets a caller that's about to reopen the same game right
// after (e.g. a forced-refresh reload) close the panel's DOM state without losing the
// deep link it'll restore from once the reload completes. Not used by the backdrop
// click/× button/swipe paths below, which always want the default (URL cleared).
function panelClose({ preserveUrl = false } = {}) {
  if (!panelGame) return;
  panelGame = null;
  document.getElementById('game-panel').classList.remove('open');
  document.getElementById('panel-backdrop').classList.remove('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) el.inert = false;
  }
  document.getElementById('panel-nav')?.replaceChildren();
  panelPrevFocus?.focus();
  panelPrevFocus = null;
  // Every close path funnels through here — the backdrop click and × button are bound
  // straight to this function (see initPanel below), and swipe-to-close calls it directly
  // too — so this is the one place host-specific close cleanup (clearing `?game=`/`&shot=`
  // from the URL, resetting the host's own "active game" state) can hook in without every
  // host having to remember to wrap all of those paths itself.
  panelOptions.onClose?.({ preserveUrl });
}

function getPanelItems() {
  return buildMediaItems(panelGame.appid, panelGame.details?.meta);
}

function buildPanelHero() {
  if (!panelGame) return;
  const hero = document.getElementById('panel-hero');
  const items = getPanelItems();
  heroIdx = Math.max(0, Math.min(heroIdx, items.length - 1));
  const hasMany = items.length > 1;

  hero.innerHTML = `
    ${renderHeroMain(items)}
    ${hasMany ? `
      <div class="panel-filmstrip">${items.map((item, i) => {
        // Screenshots have a separate full-res `main` behind the small `thumb` — if the
        // thumbnail variant 404s (a stale/broken CDN asset upstream), retrying with the
        // full-res image gives the filmstrip a second shot before giving up. Videos have
        // no such fallback (there's no full-res still behind the poster), so a broken
        // video thumb goes straight to the broken-image state below.
        const fallback = item.type === 'image' && item.main !== item.thumb ? item.main : '';
        return `<button type="button" class="panel-film-item${i === heroIdx ? ' active' : ''}${item.type === 'video' ? ' is-video' : ''}" data-idx="${i}" aria-label="${i === 0 ? esc(panelGame.name) : (item.type === 'video' ? `Video ${i}` : `Screenshot ${i}`)}">` +
        `<img class="panel-film-thumb" src="${esc(item.thumb)}" data-fallback="${esc(fallback)}" alt="" loading="lazy">` +
        `</button>`;
      }).join('')}</div>
    ` : ''}`;

  setupHeroImg(hero);
  // `error` doesn't bubble, so this needs the capture phase; delegated (rather than one
  // listener per <img>) since the whole filmstrip is rebuilt fresh here each time.
  hero.querySelector('.panel-filmstrip')?.addEventListener('error', (e) => {
    const img = e.target;
    if (!img.classList?.contains('panel-film-thumb')) return;
    const fallback = img.dataset.fallback;
    if (fallback && img.src !== fallback) { img.src = fallback; return; }
    img.classList.add('panel-film-thumb--broken');
  }, true);
  hero.querySelector('.panel-film-item.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderPanelHero(scrollActive = true) {
  if (!panelGame) return;
  const hero = document.getElementById('panel-hero');
  const items = getPanelItems();
  heroIdx = Math.max(0, Math.min(heroIdx, items.length - 1));

  const main = hero.querySelector('.panel-hero-main');
  if (!main) { buildPanelHero(); return; }

  main.outerHTML = renderHeroMain(items);
  setupHeroImg(hero);

  hero.querySelectorAll('.panel-film-item').forEach((el, i) =>
    el.classList.toggle('active', i === heroIdx)
  );

  if (scrollActive) hero.querySelector('.panel-film-item.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderHeroMain(items) {
  const current = items[heroIdx];
  const isShot = heroIdx > 0;
  const hasMany = items.length > 1;
  return `<div class="panel-hero-main${current.type === 'video' ? ' is-video' : ''}">` +
    `<img class="panel-hero-img${isShot ? ' panel-hero-img--shot' : ''}" tabindex="0" role="button" aria-label="Open in lightbox" src="${esc(current.type === 'video' ? current.thumb : current.main)}" alt="${esc(panelGame.name)}">` +
    (hasMany
      ? `<button class="panel-hero-btn panel-hero-prev"${heroIdx <= 0 ? ' disabled' : ''} aria-label="Previous">&#8249;</button>` +
        `<button class="panel-hero-btn panel-hero-next"${heroIdx >= items.length - 1 ? ' disabled' : ''} aria-label="Next">&#8250;</button>`
      : '') +
    `</div>`;
}

function setupHeroImg(hero) {
  const heroEl = hero.querySelector('.panel-hero-img');
  heroEl.classList.remove('panel-hero-img--broken');
  heroEl.classList.add('loading');
  heroEl.onload  = () => heroEl.classList.remove('loading');
  // A broken image (banner guess 404ing, or — as with a video's poster — a genuinely dead
  // upstream Steam CDN asset) used to hide the whole `.panel-hero-main`, which also wiped
  // out the prev/next nav and, for videos, the play-button overlay and click target —
  // even though the video itself (or the full-res screenshot behind a broken thumb) still
  // plays/loads fine. Just mark the image broken and leave the rest of the hero working.
  heroEl.onerror = () => { heroEl.classList.remove('loading'); heroEl.classList.add('panel-hero-img--broken'); };
}

// ProtonDB's community-reported Linux/Steam Deck compatibility tiers, worst to best.
// Colors are our own (not scraped from protondb.com), just distinct + dark enough for
// white badge text: red (unplayable) through gold/platinum (flawless) plus a green
// "native" tier for games with an actual Linux port (no Proton layer needed at all).
// Tier names themselves come straight from ProtonDB's API (see lib/steam.js) and are
// already human-readable words — capitalized for display, not remapped through a label
// table, so a new tier ProtonDB introduces still renders (just without a custom color).
// No "pending" entry — extractProtonDb (lib/steam.js) already collapses that tier to null
// server-side, since "too few reports to rate yet" isn't a compatibility outcome worth a
// badge of its own; `pd` is simply absent for those games, same as one with no data at all.
const PROTON_TIER_COLORS = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// Compact review-count suffix for the reviews line, e.g. 465234 -> "465k", 2100000 -> "2.1m".
function fmtCompactCount(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Tags/genres/categories/developer-publisher used to each get their own "uppercase
// title + pill row" section — four near-identical blocks in a row. Merged into one
// cloud instead, kind distinguished by a small colored dot (+ a legend) rather than
// by which section a pill happens to sit in. `kind` picks the dot color/legend label;
// `dim` (may be null when tag-click filtering is disabled) is the actual click-filter
// dimension, kept separate from `kind` since developers/publishers share one visual
// kind but are two different filter dimensions.
const TAG_KIND_META = {
  tags: { label: 'Tag', color: '#d97757' },
  genres: { label: 'Genre', color: '#66c0f4' },
  categories: { label: 'Category', color: '#66c04f' },
  devpub: { label: 'Developer/Publisher', color: '#b892d6' },
};

function tagCloud(groups) {
  const present = groups.filter(gr => gr.items?.length);
  if (!present.length) return '';
  const seenKinds = new Set();
  const pillsHtml = present.flatMap(({ kind, dim, items }) => {
    const values = kind === 'tags' ? [...items] : [...items].sort((a, b) => a.localeCompare(b));
    seenKinds.add(kind);
    const dot = `<span class="panel-tag-dot" style="background:${TAG_KIND_META[kind].color}"></span>`;
    return values.map(v => {
      if (dim) {
        const active = panelOptions.isTagActive?.(dim, v) ? ' active' : '';
        return `<button class="panel-tag panel-tag-btn${active}" data-dim="${dim}" data-val="${esc(v)}">${dot}${esc(v)}</button>`;
      }
      return `<span class="panel-tag">${dot}${esc(v)}</span>`;
    });
  }).join('');
  const legendHtml = [...seenKinds].map(k =>
    `<span class="panel-tag-legend-item"><span class="panel-tag-dot" style="background:${TAG_KIND_META[k].color}"></span>${TAG_KIND_META[k].label}</span>`
  ).join('');
  return `<div class="panel-section panel-section--meta">
    <div class="panel-section-title">Tags &amp; details</div>
    <div class="panel-tags">${pillsHtml}</div>
    <div class="panel-tag-legend">${legendHtml}</div>
  </div>`;
}

// The glance strip: a fixed 2×2 grid (SteamDB+Metacritic, then HLTB+Linux/Deck) —
// every chip built from one template (a value, then a one-line caption) so the four
// read as one family. Each chip IS the link to its source; there's no separate
// "Links" section duplicating them. Only *evaluative* values (the two scores, the
// Linux/Deck tier) get semantic color — HLTB is a plain duration, not a judgment,
// so it stays neutral ink.
function glanceChip(href, value, color, caption) {
  const inner = `<span class="panel-glance-sub">
    <span class="panel-glance-num"${color ? ` style="color:${color}"` : ''}>${esc(String(value))}</span>
    <span class="panel-glance-val">${caption}</span>
  </span>`;
  return href
    ? `<a class="panel-glance-chip" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="panel-glance-chip panel-glance-chip--static">${inner}</div>`;
}

function glanceGrid(g) {
  if (g.loading) {
    return `<div class="panel-glance">${
      '<div class="panel-glance-chip panel-glance-chip--sk"><span class="sk" style="width:100%;height:32px;border-radius:6px"></span></div>'.repeat(4)
    }</div>`;
  }
  const r = g.details?.rating;
  const mc = g.details?.meta?.metacritic;
  const h = g.details?.hltb;
  const pd = g.details?.protondb;
  const steamdbUrl = `https://www.steamdb.info/app/${g.appid}/`;
  const protondbUrl = `https://www.protondb.com/app/${g.appid}`;

  if (!g.details) return '';

  // Every chip stays in the grid even when its source has no data for this game —
  // a missing SteamDB rating or ProtonDB tier is itself informative, and a chip that
  // vanishes instead makes the 2×2 grid reflow into a lopsided 3-chip layout. Each
  // still links out where a useful destination exists, same as the HLTB search fallback.
  const chips = [];
  if (r) {
    const pct = r.total ? Math.round(r.positive / r.total * 100) : 0;
    const steamdbRating = Math.round(computeSteamdbRating(r.positive, r.total));
    chips.push(glanceChip(steamdbUrl, steamdbRating, scoreColor(steamdbRating), `<b>SteamDB</b> · ${pct}% of ${fmtCompactCount(r.total)}`));
  } else {
    chips.push(glanceChip(steamdbUrl, '—', null, `<b>SteamDB</b> · no rating`));
  }
  if (mc) {
    chips.push(glanceChip(mc.url, mc.score, scoreColor(mc.score), `<b>Metacritic</b> · critic score`));
  } else {
    chips.push(glanceChip(null, '—', null, `<b>Metacritic</b> · no score`));
  }
  if (h?.id) {
    // A matched HLTB entry can still have no submitted completion times (all: null,
    // e.g. a very new/obscure game) — that's a real page with no data, not a failed
    // search, so it still links straight to the page rather than a generic search.
    const hltbUrl = `https://howlongtobeat.com/game/${h.id}`;
    chips.push(h.all
      ? glanceChip(hltbUrl, `${h.all}h`, null, `<b>HLTB</b> · all playstyles`)
      : glanceChip(hltbUrl, '—', null, `<b>HLTB</b> · no data`));
  } else {
    chips.push(glanceChip(`https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}`, '—', null, `<b>HLTB</b> · search`));
  }
  if (pd?.tier) {
    const color = PROTON_TIER_COLORS[pd.tier] || '#52525b';
    // Kept short (no "reports"/"confidence" words) — the glance chip's one-line caption
    // truncates rather than wraps, and "strong · 336" already reads fine without them.
    const detail = [pd.confidence, pd.total ? fmtCompactCount(pd.total) : ''].filter(Boolean).join(' · ');
    chips.push(glanceChip(protondbUrl, capitalize(pd.tier), color, `<b>Linux/Deck</b>${detail ? ' · ' + detail : ''}`));
  } else {
    chips.push(glanceChip(protondbUrl, '—', null, `<b>Linux/Deck</b> · no reports`));
  }
  return `<div class="panel-glance">${chips.join('')}</div>`;
}

function renderPanelBody(game) {
  const g = game;
  const h = g.details?.hltb;
  const meta = g.details?.meta;

  const storeUrl    = `https://store.steampowered.com/app/${g.appid}`;
  const itadUrl     = `https://isthereanydeal.com/steam/app/${g.appid}`;
  const releaseDate = meta?.releaseDate;
  const description = meta?.description;

  const ownersHtml = panelOptions.getOwnersHtml?.(g) ?? '';

  // The glance strip already carries HLTB's "All PlayStyles" number (see glanceGrid
  // above) — this is just the fuller Main/Extra/Completionist breakdown beneath it,
  // once, not a second copy of the headline figure.
  let hltbDetailHtml = '';
  if (!g.loading && h && (h.main || h.extra || h.completionist)) {
    hltbDetailHtml = `<div class="panel-section">
      <div class="panel-section-title">How Long To Beat — breakdown</div>
      <div class="panel-hltb">
        ${h.main ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Main Story</div><div class="panel-hltb-val">${fmtH(h.main)}</div></div>` : ''}
        ${h.extra ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Main + Extra</div><div class="panel-hltb-val">${fmtH(h.extra)}</div></div>` : ''}
        ${h.completionist ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Completionist</div><div class="panel-hltb-val">${fmtH(h.completionist)}</div></div>` : ''}
      </div>
    </div>`;
  }

  const tagDim = key => panelOptions.enableTagFilters ? key : null;
  const devs = meta?.developers || [];
  const pubs = meta?.publishers || [];
  const sameDevPub = devs.length > 0 && devs.length === pubs.length && devs.every((d, i) => d === pubs[i]);
  const cloudHtml = g.loading ? '' : tagCloud([
    { kind: 'tags', dim: tagDim('tags'), items: g.details?.tags },
    { kind: 'genres', dim: tagDim('genres'), items: meta?.genres },
    { kind: 'categories', dim: tagDim('categories'), items: meta?.categories },
    { kind: 'devpub', dim: tagDim('developers'), items: devs },
    ...(sameDevPub ? [] : [{ kind: 'devpub', dim: tagDim('publishers'), items: pubs }]),
  ]);

  const refreshBtn = (panelOptions.onRefresh && !g.loading) ? `
    <button type="button" class="panel-refresh-btn${panelRefreshing ? ' is-refreshing' : ''}"${panelRefreshing ? ' disabled' : ''}
      title="Refresh rating, HLTB &amp; store details for this game" aria-label="Refresh details">↻</button>` : '';

  // Only the title row (title/release date/icon-links) is wrapped in .panel-header-sticky
  // and stays pinned while scrolling — the hero (built into #panel-hero below) and the
  // glance grid scroll away with the rest of the body (description, HLTB breakdown,
  // owners, tag cloud). #panel-hero used to be a fixed sibling of #panel-body outside the
  // scroll container, which meant it (plus the glance grid) permanently ate into the
  // panel's visible height on short/mobile screens with no way to scroll it out of the
  // way. Rendering it as the first child here instead — and rebuilding it fresh via
  // buildPanelHero() below, same as before — lets it scroll away like everything else.
  document.getElementById('panel-body').innerHTML = `
    <div id="panel-hero" class="panel-hero"></div>
    <div class="panel-header-sticky">
      <div class="panel-title-row">
        <div>
          <div class="panel-title" id="panel-title">${esc(g.name)}</div>
          ${releaseDate ? `<div class="panel-release">${esc(releaseDate)}</div>` : ''}
        </div>
        <div class="panel-icon-links">
          <a class="panel-icon-link" href="${esc(storeUrl)}" target="_blank" rel="noopener" title="Steam Store" aria-label="Steam Store">🛒</a>
          <a class="panel-icon-link" href="${esc(itadUrl)}" target="_blank" rel="noopener" title="IsThereAnyDeal" aria-label="IsThereAnyDeal">$</a>
          ${refreshBtn}
        </div>
      </div>
    </div>
    ${glanceGrid(g)}
    ${description ? `<div class="panel-desc">${description}</div>` : ''}
    ${hltbDetailHtml}
    ${ownersHtml}
    ${cloudHtml}`;

  buildPanelHero();
}

function initHeroSwipe() {
  // Bound to #panel-body (stable across renders) rather than #panel-hero itself, which —
  // now that it's part of #panel-body's generated markup (see renderPanelBody) — is a
  // brand new DOM node after every render; a listener attached directly to it would stop
  // working (or, before the first panelOpen(), fail to attach at all) the moment the
  // panel re-renders. The `.panel-hero` check in touchstart scopes tracking to touches
  // that actually start on the hero, same as the old direct binding did implicitly.
  const hero = document.getElementById('panel-body');
  let startX = 0, startY = 0, tracking = false, decided = false, isHoriz = false;

  hero.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.panel-filmstrip') || !e.target.closest('.panel-hero')) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    tracking = true; decided = false; isHoriz = false;
  }, { passive: true });

  hero.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      isHoriz = Math.abs(dx) > Math.abs(dy) * 1.2;
      decided = true;
    }
    if (isHoriz) e.stopPropagation(); // don't let panel-close swipe fire
  }, { passive: true });

  hero.addEventListener('touchend', e => {
    if (!tracking || !isHoriz) { tracking = false; return; }
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 40) return;
    panelStepHero(dx < 0 ? 1 : -1);
  }, { passive: true });

  hero.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}

function initPanelSwipe() {
  const panel = document.getElementById('game-panel');
  let startX = 0, startY = 0, tracking = false, decided = false, horiz = false;

  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.panel-filmstrip')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    decided = false;
    horiz = false;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
      decided = true;
    }
    if (!horiz || dx <= 0) return;
    e.preventDefault();
    panel.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  function finish(clientX) {
    if (!tracking) return;
    tracking = false;
    const dx = clientX - startX;
    if (horiz && dx > 80) {
      panel.style.transition = 'transform 0.2s ease';
      panel.style.transform = 'translateX(100%)';
      setTimeout(() => {
        panelClose();
        panel.style.transition = '';
        panel.style.transform = '';
      }, 200);
    } else {
      if (panel.style.transform) {
        panel.style.transition = 'transform 0.25s ease';
        panel.style.transform = '';
        setTimeout(() => { panel.style.transition = ''; }, 250);
      } else {
        panel.style.transition = '';
      }
    }
  }

  panel.addEventListener('touchend', e => finish(e.changedTouches[0].clientX), { passive: true });
  panel.addEventListener('touchcancel', () => {
    tracking = false;
    panel.style.transition = 'transform 0.25s ease';
    panel.style.transform = '';
    setTimeout(() => { panel.style.transition = ''; }, 250);
  }, { passive: true });
}
