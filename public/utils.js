'use strict';

// Extract username/ID from a pasted Steam profile URL
function normalizeInput(raw) {
  const mId  = raw.match(/steamcommunity\.com\/id\/([^/?\s]+)/);
  if (mId)  return mId[1];
  const mNum = raw.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (mNum) return mNum[1];
  return raw;
}

// SteamDB's current rating formula — they moved away from the Wilson score interval to this
// Bayesian shrinkage, specifically because Wilson's confidence-bound framing was hard to explain
// to users. It starts every game at a neutral 50% prior and lets the observed positive ratio
// pull it away as review volume grows — e.g. 90% positive over 100 reviews lands at 80%, not
// 90%, because 100 reviews still isn't much evidence. See
// https://github.com/SteamDatabase/steamdb.info-issues/issues/793.
// Returns the raw, unrounded value (0-100) — round only for display; sorting/grouping should
// use the full precision so games with the same rounded score still order deterministically.
function computeSteamdbRating(positive, total) {
  if (!total) return null;
  const p = positive / total;
  const weight = 2 ** -Math.log10(total + 1);
  return (p - (p - 0.5) * weight) * 100;
}

// Rough AAA/AA/Indie production-tier proxy. Steam's API has no direct budget/studio-size
// signal, so this leans on the only things that correlate with it at all: launch price
// (`priceInitial`, whole cents, USD — see isFree/priceInitial in lib/steam.js's
// extractAppDetails), review volume as a reach proxy, and Metacritic presence as a "got
// professional press coverage at all" signal. It's a heuristic, not fact — see CLAUDE.md's
// AAA/AA/Indie section for the tradeoffs and known misclassifications (cheap AAA
// remasters/rereleases, prestige-priced small-studio sim games, veteran-founded small studios
// with high polish — none of these have any data-side tell). Returns null, not a tier, when
// there isn't enough signal to guess at all (DLC — `isDlc` — or a priced game with no price
// data).
//
// DLC/expansion appids are skipped outright rather than scored on their own price: a $10
// expansion attached to a AAA base game would otherwise read as Indie. No parent-game lookup
// is attempted (that would mean fetching the base game's own rating/meta just for this), so
// DLC rows simply render blank in this column.
const AAA_PRICE_CENTS = 5000; // $50+ launch price
const AA_PRICE_CENTS = 2000;  // $20+ launch price — the AA/premium-indie overlap zone
const AA_REVIEW_THRESHOLD = 20000;         // needed (alongside AA-band price) to clear "just an expensive indie game"
const FREE_AAA_REVIEW_THRESHOLD = 200000;  // the only lever available for F2P titles, which have no price signal at all
function computeProductionTier({ isFree, priceInitial, reviewsTotal, hasMetacritic, isDlc } = {}) {
  if (isDlc) return null;
  const reviews = reviewsTotal ?? 0;
  if (isFree) return reviews >= FREE_AAA_REVIEW_THRESHOLD ? 'AAA' : 'Indie';
  if (priceInitial == null) return null;
  if (priceInitial >= AAA_PRICE_CENTS) return 'AAA';
  if (priceInitial >= AA_PRICE_CENTS) return (reviews >= AA_REVIEW_THRESHOLD || hasMetacritic) ? 'AA' : 'Indie';
  return 'Indie';
}

function scoreColor(n) {
  if (n == null) return 'var(--text1)';
  if (n >= 80) return '#57cbde';
  if (n >= 65) return '#a3cf4e';
  if (n >= 50) return '#e4a82e';
  return '#cc5050';
}

function fmtH(h) {
  if (!h) return '<span class="dim">—</span>';
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

// Format Steam playtime (minutes) as a compact string, e.g. "47m" or "12h". Returns '' for 0.
function fmtPlaytime(mins) {
  if (!mins) return '';
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
}

// Format a GetOwnedGames `rtime_last_played` Unix timestamp (seconds) as a plain ISO date
// (e.g. "2026-07-01") — same bare-date convention as the releaseDate/dateAdded table columns,
// rather than a relative "3 days ago" string. Returns '' for 0/missing (owned but never
// launched — a real, meaningful state, not absent data).
function fmtLastPlayed(epochSec) {
  if (!epochSec) return '';
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

function foldStr(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderScoreCell(game) {
  if (game.loading) return '<span class="sk"></span>';
  const r = game.details?.rating;
  return r
    ? `<div class="score-num" style="color:${scoreColor(r.score)}">${r.score}</div><div class="score-label">${esc(r.desc)}</div>`
    : '<span class="dim">—</span>';
}

function renderMainCell(game) {
  if (game.loading) return '<span class="sk sm"></span>';
  const h = game.details?.hltb;
  return h ? fmtH(h.main) : '<span class="dim">—</span>';
}

function renderExtraCell(game) {
  if (game.loading) return '<span class="sk sm"></span>';
  const h = game.details?.hltb;
  return h ? fmtH(h.extra) : '<span class="dim">—</span>';
}

if (typeof module !== 'undefined') module.exports = { normalizeInput, scoreColor, fmtH, fmtPlaytime, fmtLastPlayed, esc, foldStr, renderScoreCell, renderMainCell, renderExtraCell, computeSteamdbRating, computeProductionTier };
