'use strict';

// Extract username/ID from a pasted Steam profile URL
function normalizeInput(raw) {
  const mId  = raw.match(/steamcommunity\.com\/id\/([^/?\s]+)/);
  if (mId)  return mId[1];
  const mNum = raw.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (mNum) return mNum[1];
  return raw;
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

if (typeof module !== 'undefined') module.exports = { normalizeInput, scoreColor, fmtH, fmtPlaytime, esc, foldStr, renderScoreCell, renderMainCell, renderExtraCell };
