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

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (typeof module !== 'undefined') module.exports = { normalizeInput, scoreColor, fmtH, esc };
