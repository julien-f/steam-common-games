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
// pickRandomFrom() below is a generic "shuffle bag" usable by both pages.

let panelOptions = {};
let panelGame = null;
let heroIdx = 0;
let panelPrevFocus = null;

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

  document.getElementById('panel-hero').addEventListener('click', e => {
    const thumb = e.target.closest('.panel-film-item');
    if (thumb) { heroIdx = Number(thumb.dataset.idx); renderPanelHero(); return; }
    if (e.target.closest('.panel-hero-prev')) { panelStepHero(-1); return; }
    if (e.target.closest('.panel-hero-next')) { panelStepHero(1); return; }
    if (e.target.closest('.panel-hero-img')) openLightbox(panelGame, heroIdx);
  });
  document.getElementById('panel-hero').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.panel-hero-img')) { e.preventDefault(); openLightbox(panelGame, heroIdx); }
  });
  document.getElementById('panel-hero').addEventListener('wheel', e => {
    const strip = e.target.closest('.panel-filmstrip');
    if (!strip) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  document.getElementById('game-panel').addEventListener('click', e => {
    const btn = e.target.closest('.panel-tag-btn');
    if (!btn || !panelOptions.onTagClick) return;
    panelOptions.onTagClick(btn.dataset.dim, btn.dataset.val);
  });

  initPanelSwipe();
  initHeroSwipe();
}

function isPanelOpen() { return panelGame != null; }
function getPanelGame() { return panelGame; }

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

function panelClose() {
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
      <div class="panel-filmstrip">${items.map((item, i) =>
        `<button type="button" class="panel-film-item${i === heroIdx ? ' active' : ''}${item.type === 'video' ? ' is-video' : ''}" data-idx="${i}" aria-label="${i === 0 ? esc(panelGame.name) : (item.type === 'video' ? `Video ${i}` : `Screenshot ${i}`)}">` +
        `<img class="panel-film-thumb" src="${esc(item.thumb)}" alt="" loading="lazy">` +
        `</button>`
      ).join('')}</div>
    ` : ''}`;

  setupHeroImg(hero);
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
  const main = hero.querySelector('.panel-hero-main');
  if (main) main.style.display = '';
  const heroEl = hero.querySelector('.panel-hero-img');
  heroEl.classList.add('loading');
  heroEl.onload  = () => heroEl.classList.remove('loading');
  heroEl.onerror = () => { heroEl.closest('.panel-hero-main').style.display = 'none'; };
}

function tagSection(title, items, dim) {
  if (!items?.length) return '';
  const values = dim === 'tags' ? [...items] : [...items].sort((a, b) => a.localeCompare(b));
  return `<div class="panel-section panel-section--meta">
    <div class="panel-section-title">${title}</div>
    <div class="panel-tags">${values.map(v => {
      if (dim) {
        const active = panelOptions.isTagActive?.(dim, v) ? ' active' : '';
        return `<button class="panel-tag panel-tag-btn${active}" data-dim="${dim}" data-val="${esc(v)}">${esc(v)}</button>`;
      }
      return `<span class="panel-tag">${esc(v)}</span>`;
    }).join('')}</div>
  </div>`;
}

function renderPanelBody(game) {
  const g = game;
  const r = g.details?.rating;
  const h = g.details?.hltb;
  const meta = g.details?.meta;

  const storeUrl    = `https://store.steampowered.com/app/${g.appid}`;
  const steamdbUrl  = `https://www.steamdb.info/app/${g.appid}/`;
  const protondbUrl = `https://www.protondb.com/app/${g.appid}`;
  const itadUrl     = `https://isthereanydeal.com/steam/app/${g.appid}`;
  const releaseDate = meta?.releaseDate;
  const description = meta?.description;

  const ownersHtml = panelOptions.getOwnersHtml?.(g) ?? '';

  const mc = meta?.metacritic;
  let scoreHtml = '';
  if (g.loading) {
    scoreHtml = `<div class="panel-section">
      <div class="panel-section-title">Score</div>
      <span class="sk" style="width:64px;height:32px;border-radius:4px"></span>
    </div>`;
  } else if (r || mc) {
    const pct = r?.total ? Math.round(r.positive / r.total * 100) : 0;
    const wilsonHtml = r ? `
      <div class="panel-score-row">
        <div class="panel-score-num" style="color:${scoreColor(r.score)}">${r.score}</div>
        <div class="panel-score-desc">${esc(r.desc)}</div>
      </div>
      <div class="panel-reviews">${r.positive.toLocaleString()} of ${r.total.toLocaleString()} reviews positive (${pct}%)</div>` : '';
    const mcHtml = mc ? `
      <div class="panel-score-row panel-score-row--mc">
        <div class="panel-score-num panel-score-num--mc">${mc.score}</div>
        <div class="panel-score-desc">${mc.url ? `<a href="${esc(mc.url)}" target="_blank" rel="noopener">Metacritic ↗</a>` : 'Metacritic'}</div>
      </div>` : '';
    scoreHtml = `<div class="panel-section">
      <div class="panel-section-title">Score</div>
      ${wilsonHtml}
      ${mcHtml}
    </div>`;
  }

  let hltbHtml = '';
  let hltbSearchUrl = '';
  if (g.loading) {
    hltbHtml = `<div class="panel-section">
      <div class="panel-section-title">How Long To Beat</div>
      <span class="sk" style="width:140px"></span>
    </div>`;
  } else if (h) {
    const hltbUrl = h.id ? `https://howlongtobeat.com/game/${h.id}` : null;
    hltbHtml = `<div class="panel-section">
      <div class="panel-section-title">${hltbUrl ? `<a href="${esc(hltbUrl)}" target="_blank" rel="noopener">How Long To Beat ↗</a>` : 'How Long To Beat'}</div>
      <div class="panel-hltb">
        <div class="panel-hltb-item">
          <div class="panel-hltb-label">Main Story</div>
          <div class="panel-hltb-val">${fmtH(h.main)}</div>
        </div>
        <div class="panel-hltb-item">
          <div class="panel-hltb-label">Main + Extra</div>
          <div class="panel-hltb-val">${fmtH(h.extra)}</div>
        </div>
        ${h.completionist ? `<div class="panel-hltb-item">
          <div class="panel-hltb-label">Completionist</div>
          <div class="panel-hltb-val">${fmtH(h.completionist)}</div>
        </div>` : ''}
      </div>
    </div>`;
  } else if (g.details) {
    hltbSearchUrl = `https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}`;
  }

  const tagDim = key => panelOptions.enableTagFilters ? key : null;
  const tags = g.details?.tags;
  // Merge developer and publisher when identical
  const devs = meta?.developers || [];
  const pubs = meta?.publishers || [];
  const sameDevPub = devs.length > 0 && devs.length === pubs.length && devs.every((d, i) => d === pubs[i]);
  const metaHtml = g.loading ? '' : [
    tagSection('Tags', tags, tagDim('tags')),
    tagSection('Genres', meta?.genres, tagDim('genres')),
    tagSection('Categories', meta?.categories, tagDim('categories')),
    sameDevPub
      ? tagSection('Developer / Publisher', devs, tagDim('developers'))
      : [tagSection('Developer', devs, tagDim('developers')), tagSection('Publisher', pubs, tagDim('publishers'))].join(''),
  ].join('');

  document.getElementById('panel-body').innerHTML = `
    <div class="panel-title">${esc(g.name)}</div>
    ${releaseDate ? `<div class="panel-release">${esc(releaseDate)}</div>` : ''}
    ${description ? `<div class="panel-desc">${description}</div>` : ''}
    ${scoreHtml}
    ${hltbHtml}
    ${ownersHtml}
    ${metaHtml}
    <div class="panel-section panel-section--meta">
      <div class="panel-section-title">Links</div>
      <div class="panel-links">
        <a class="panel-link" href="${esc(storeUrl)}" target="_blank" rel="noopener">Steam Store</a>
        <a class="panel-link" href="${esc(steamdbUrl)}" target="_blank" rel="noopener">SteamDB</a>
        <a class="panel-link" href="${esc(protondbUrl)}" target="_blank" rel="noopener">ProtonDB</a>
        <a class="panel-link" href="${esc(itadUrl)}" target="_blank" rel="noopener">IsThereAnyDeal</a>
        ${hltbSearchUrl ? `<a class="panel-link" href="${esc(hltbSearchUrl)}" target="_blank" rel="noopener">HowLongToBeat</a>` : ''}
      </div>
    </div>`;

  buildPanelHero();
}

function initHeroSwipe() {
  const hero = document.getElementById('panel-hero');
  let startX = 0, startY = 0, tracking = false, decided = false, isHoriz = false;

  hero.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.panel-filmstrip')) return;
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
    if (e.touches.length !== 1) return;
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
