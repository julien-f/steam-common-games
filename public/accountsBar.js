'use strict';

// Shared by the comparison page (app.js) and the Library Explorer (library.js): renders
// the "accounts bar" of resolved-account chips under a search form, plus a locally
// remembered "recent searches" row above it. Loaded as a plain global script (like
// utils.js/panel.js), not a module, so both pages' classic <script>s can call straight
// into it — depends on the global `esc()` from utils.js, so load this after utils.js.

// personastate values per Steam's docs: 0 Offline, 1 Online, 2 Busy, 3 Away, 4 Snooze,
// 5 Looking to trade, 6 Looking to play. `gameextrainfo` (present while in-game) takes
// priority over all of these for the status dot/tooltip.
const ACCOUNT_STATE_LABELS = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];

// The identity (avatar + name, linking out to the profile) is its own <a> nested inside
// the chip <div> rather than the whole chip being one big link — the chip also holds a
// <button> (per-account refresh), and interactive content nested inside an <a> is
// invalid HTML / fights click-target handling.
function accountChipHtml(p, countLabel) {
  const name = esc(p.personaname || p.steamid);
  const safeUrl = /^https?:\/\//i.test(p.profileurl || '') ? p.profileurl : '';
  const safeAvatar = /^https?:\/\//i.test(p.avatarmedium || '') ? p.avatarmedium : '';
  const isPrivate = p.communityvisibilitystate !== undefined && p.communityvisibilitystate !== 3;
  const count = typeof p.gameCount === 'number' ? p.gameCount : p.itemCount;

  // `personastate`/`gameextrainfo` come from the same `player:` cache entry as everything
  // else on the chip, which sits on the library cache tier (LIBRARY_CACHE_TTL_MINUTES,
  // default 6h — see CLAUDE.md) — a TTL sized for library/wishlist contents, not
  // second-to-second presence. The dot is real data, just not live, so the tooltip says
  // "as of this search" rather than implying a real-time status a 6h-old cache can't back up.
  const statusClass = p.gameextrainfo ? 'ingame' : p.personastate ? 'online' : 'offline';
  const statusLabel = p.gameextrainfo
    ? `Playing ${p.gameextrainfo}`
    : (ACCOUNT_STATE_LABELS[p.personastate] || 'Offline');
  const statusTitle = `${statusLabel} (as of this search)`;

  const identityInner = `
    <span class="account-avatar-wrap">
      ${safeAvatar ? `<img class="account-avatar" src="${esc(safeAvatar)}" alt="" width="28" height="28">` : ''}
      <span class="account-status account-status-${statusClass}" title="${esc(statusTitle)}"></span>
    </span>
    <span class="account-meta">
      <span class="account-name">${name}</span>
      ${typeof count === 'number' ? `<span class="account-count">${count.toLocaleString()} ${countLabel}</span>` : ''}
    </span>
  `;
  const identity = safeUrl
    ? `<a class="account-identity" href="${esc(safeUrl)}" target="_blank" rel="noopener">${identityInner}</a>`
    : `<span class="account-identity">${identityInner}</span>`;

  return `
    <div class="account-chip">
      ${identity}
      ${isPrivate ? '<span class="account-private" title="Profile is private — results for this account may be empty or incomplete">🔒 Private</span>' : ''}
      <button type="button" class="account-refresh-btn" data-steamid="${esc(p.steamid)}"
        title="Refresh just this account">↻</button>
    </div>
  `;
}

// Flat row of chips — one group's worth of accounts (the Library Explorer's single
// Family group, or the comparison page when there's only one slot).
function renderAccountChips(containerEl, players, countLabel) {
  if (!players || players.length === 0) { containerEl.hidden = true; containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = players.map(p => accountChipHtml(p, countLabel)).join('');
  containerEl.hidden = false;
}

// Chips clustered into labelled groups — the comparison page's per-slot view, since a
// search there can compare several separate slots (each possibly itself a multi-account
// Family). `groups`: [{ label, players }]. `label` is omitted (no heading rendered) for
// a single-group search, where per-slot labeling would just be noise.
function renderAccountChipsGrouped(containerEl, groups, countLabel) {
  const nonEmpty = (groups || []).filter(g => g.players && g.players.length > 0);
  if (nonEmpty.length === 0) { containerEl.hidden = true; containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = nonEmpty.map(g => `
    <div class="slot-accounts">
      ${g.label ? `<span class="slot-label">${esc(g.label)}</span>` : ''}
      ${g.players.map(p => accountChipHtml(p, countLabel)).join('')}
    </div>
  `).join('');
  containerEl.hidden = false;
}

// Delegated rather than per-chip, since chips are wholesale replaced on every render.
// `onRefresh(steamid, btnEl)` is responsible for re-running the search with that one
// account force-refreshed and re-rendering the bar (which naturally resets the button).
function bindAccountRefresh(containerEl, onRefresh) {
  containerEl.addEventListener('click', e => {
    const btn = e.target.closest('.account-refresh-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⋯';
    onRefresh(btn.dataset.steamid, btn);
  });
}

// ── Recent searches (localStorage) ──────────────────────────────────────────
// Purely a client-side convenience — never sent to the server. `storageKey` namespaces
// the list per page (the two pages' searches aren't interchangeable: a Library Explorer
// search is one Family group, a comparison-page search is a whole set of slots). Each
// entry is `{ id, players, data }` — `id` is a canonicalized identifier used to dedupe/
// remove/reload; `data` is whatever the host page needs to replay the search (a plain
// identifier string for the Library Explorer, a whole slots array for the comparison
// page) and is never inspected here. `players` is a lightweight display snapshot
// (steamid/personaname/avatarmedium) — always **one array per slot/group**, even for a
// single-group search, so recentChipHtml below always knows slot boundaries: a Library
// Explorer search (or a one-slot comparison-page search) passes a one-element array.
// Without that grouping, a comparison of two 2-account Families and a plain 4-account
// comparison would render as the exact same "A + B + C + D" label.

const MAX_RECENTS = 10;

function loadRecents(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // corrupt/blocked storage — behave as if there's no history
  }
}

function saveRecents(storageKey, list) {
  try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch { /* storage full/blocked — drop silently */ }
}

// Moves this search to the front, refreshing its cached display data, rather than
// appending a duplicate. `groups`: array of slot groups, each an array of player objects.
function addRecent(storageKey, id, groups, data) {
  const snapshot = (groups || []).map(g => (g || []).map(p => ({
    steamid: p.steamid, personaname: p.personaname, avatarmedium: p.avatarmedium,
  })));
  const rest = loadRecents(storageKey).filter(r => r.id !== id);
  rest.unshift({ id, players: snapshot, data });
  saveRecents(storageKey, rest.slice(0, MAX_RECENTS));
}

function removeRecent(storageKey, id) {
  saveRecents(storageKey, loadRecents(storageKey).filter(r => r.id !== id));
}

// "+" joins accounts merged within one slot/group, ", " separates distinct slots/groups —
// same convention as the accounts bar's own "N accounts merged" labeling, so a Family
// merge and a multi-player comparison never look identical here either. Each element of
// `entry.players` is normalized to a group array (`Array.isArray(g) ? g : [g]`) rather than
// assumed to already be one — entries written before this grouping existed have a flat
// array of player objects, not an array of groups, and this is the only thing standing
// between reading one of those out of localStorage and a hard crash on every page load.
function recentChipHtml(entry) {
  const groups = (entry.players || []).map(g => Array.isArray(g) ? g : [g]);
  const label = esc(groups.length
    ? groups.map(g => g.map(p => p.personaname || p.steamid).join(' + ')).join(', ')
    : entry.id);
  const avatarUrl = groups[0]?.[0]?.avatarmedium;
  const safeAvatar = /^https?:\/\//i.test(avatarUrl || '') ? avatarUrl : '';
  return `
    <span class="recent-chip">
      <button type="button" class="recent-chip-btn" data-id="${esc(entry.id)}" title="Load ${label}">
        ${safeAvatar ? `<img class="recent-chip-avatar" src="${esc(safeAvatar)}" alt="">` : ''}
        ${label}
      </button>
      <button type="button" class="recent-chip-remove" data-id="${esc(entry.id)}" title="Remove from recent">×</button>
    </span>
  `;
}

function renderRecentsBar(containerEl, storageKey) {
  const recents = loadRecents(storageKey);
  if (recents.length === 0) { containerEl.hidden = true; containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = `
    <span class="recents-label">Recent:</span>
    ${recents.map(recentChipHtml).join('')}
    <button type="button" class="recents-clear">Clear</button>
  `;
  containerEl.hidden = false;
}

// `onLoad(data)` replays a remembered search; re-rendering the bar after removal/clear
// is handled here since it's always the same follow-up regardless of the host page.
function bindRecentsBar(containerEl, storageKey, onLoad) {
  containerEl.addEventListener('click', e => {
    const loadBtn = e.target.closest('.recent-chip-btn');
    if (loadBtn) {
      const entry = loadRecents(storageKey).find(r => r.id === loadBtn.dataset.id);
      if (entry) onLoad(entry.data);
      return;
    }
    const removeBtn = e.target.closest('.recent-chip-remove');
    if (removeBtn) { removeRecent(storageKey, removeBtn.dataset.id); renderRecentsBar(containerEl, storageKey); return; }
    if (e.target.closest('.recents-clear')) { saveRecents(storageKey, []); renderRecentsBar(containerEl, storageKey); }
  });
}
