'use strict';

const FILTER_DIMS = [
  { key: 'tags',       label: 'Tag',       param: 'tag'   },
  { key: 'genres',     label: 'Genre',     param: 'genre' },
  { key: 'categories', label: 'Category',  param: 'cat'   },
  { key: 'developers', label: 'Developer', param: 'dev'   },
  { key: 'publishers', label: 'Publisher', param: 'pub'   },
];

// Canonical query-param order shared by every URL-writing function on both pages. Applying
// this before every pushState/replaceState means the same logical state always serializes to
// the same URL string regardless of the order its pieces happened to be set/mutated in —
// otherwise e.g. opening a game before vs. after adding a tag filter would leave `game` in a
// different position, making two visits to an identical state look like different history
// entries and cluttering the query string with no benefit.
const PARAM_ORDER = ['u', 'tab', 'sort', 'game', 'shot', 'name', ...FILTER_DIMS.map(d => d.param), 'view', 'wview'];

function reorderUrlParams(params) {
  const ordered = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    for (const v of params.getAll(key)) ordered.append(key, v);
  }
  // Anything not in PARAM_ORDER (forward-compat/unknown params) keeps its relative order,
  // appended after every known param.
  for (const [key, value] of params) {
    if (!PARAM_ORDER.includes(key)) ordered.append(key, value);
  }
  return ordered;
}

function parseUrlState(search) {
  const params = new URLSearchParams(search);
  const slots = params.getAll('u')
    .map(s => s.split(',').map(v => v.trim()).filter(Boolean));
  const sortParam = params.get('sort');
  return {
    slots,
    game:       Number(params.get('game')) || null,
    shot:       params.get('shot'),
    sort:       sortParam ? {
      col: sortParam.startsWith('-') ? sortParam.slice(1) : sortParam,
      dir: sortParam.startsWith('-') ? -1 : 1,
    } : null,
    nameFilter: params.get('name') ?? '',
    filters:    Object.fromEntries(FILTER_DIMS.map(d => [d.key, params.getAll(d.param)])),
  };
}

if (typeof module !== 'undefined') module.exports = { FILTER_DIMS, parseUrlState, reorderUrlParams };
