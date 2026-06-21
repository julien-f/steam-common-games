'use strict';

const FILTER_DIMS = [
  { key: 'tags',       label: 'Tag',       param: 'tag'   },
  { key: 'genres',     label: 'Genre',     param: 'genre' },
  { key: 'categories', label: 'Category',  param: 'cat'   },
  { key: 'developers', label: 'Developer', param: 'dev'   },
  { key: 'publishers', label: 'Publisher', param: 'pub'   },
];

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

if (typeof module !== 'undefined') module.exports = { FILTER_DIMS, parseUrlState };
