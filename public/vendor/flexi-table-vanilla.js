import { DEFAULT_LABELS as ge, toggleCollapse as ue, toggleGroupBy as be, toggleFilter as xe, toggleSort as ye, getSortIndex as le, getSortIcon as se, computeStringValues as he, processData as me, searchData as ke, calcTotalPages as $e, paginateData as ve, groupData as we, countActiveFilters as Se, computeAggregate as Ce } from "@vates/flexi-table-core";
const Le = `
:root{--color-background-primary:#fff;--color-background-secondary:#f7f6f3;--color-background-info:#e6f1fb;--color-background-warning:#faeeda;--color-text-primary:#1a1916;--color-text-secondary:#6b6a66;--color-text-tertiary:#9b9a96;--color-text-info:#185fa5;--color-text-warning:#854f0b;--color-border-secondary:#dddcd8;--color-border-tertiary:#eeedea;--color-border-info:#b8d6f5;--color-border-warning:#f0d4a8}
@media(prefers-color-scheme:dark){:root{--color-background-primary:#141413;--color-background-secondary:#1e1d1b;--color-background-info:#0d2640;--color-background-warning:#2a1900;--color-text-primary:#e8e7e4;--color-text-secondary:#9b9a96;--color-text-tertiary:#6b6a66;--color-text-info:#5b9fe0;--color-text-warning:#e8a040;--color-border-secondary:#333230;--color-border-tertiary:#252422;--color-border-info:#1a4070;--color-border-warning:#4a2c00}}
[data-theme=dark]{--color-background-primary:#141413;--color-background-secondary:#1e1d1b;--color-background-info:#0d2640;--color-background-warning:#2a1900;--color-text-primary:#e8e7e4;--color-text-secondary:#9b9a96;--color-text-tertiary:#6b6a66;--color-text-info:#5b9fe0;--color-text-warning:#e8a040;--color-border-secondary:#333230;--color-border-tertiary:#252422;--color-border-info:#1a4070;--color-border-warning:#4a2c00}
[data-theme=light]{--color-background-primary:#fff;--color-background-secondary:#f7f6f3;--color-background-info:#e6f1fb;--color-background-warning:#faeeda;--color-text-primary:#1a1916;--color-text-secondary:#6b6a66;--color-text-tertiary:#9b9a96;--color-text-info:#185fa5;--color-text-warning:#854f0b;--color-border-secondary:#dddcd8;--color-border-tertiary:#eeedea;--color-border-info:#b8d6f5;--color-border-warning:#f0d4a8}
.ft{font-family:inherit;font-size:14px;color:var(--color-text-primary,#1a1916)}
.ft-toolbar{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:0.5px solid var(--color-border-tertiary,#eeedea);flex-wrap:wrap}
.ft-stats{margin-left:auto;font-size:12px;color:var(--color-text-secondary,#6b6a66)}
.ft-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:none;border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:6px;font-size:13px;cursor:pointer;color:var(--color-text-primary,#1a1916);font-family:inherit;line-height:1}
.ft-btn--active{background:var(--color-background-secondary,#f7f6f3)}
.ft-dd-wrap{position:relative}
.ft-dd{position:absolute;top:calc(100% + 4px);left:0;z-index:100;background:var(--color-background-primary,#fff);border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);min-width:180px}
.ft-dd-section{padding:6px 14px 2px;font-size:11px;color:var(--color-text-tertiary,#9b9a96);font-weight:500;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.ft-dd-sublabel{font-size:12px;margin-bottom:4px;color:var(--color-text-secondary,#6b6a66)}
.ft-dd-item{display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:13px;color:var(--color-text-primary,#1a1916);cursor:default}
.ft-dd-item--click{cursor:pointer}
.ft-dd-item--click:hover{background:var(--color-background-secondary,#f7f6f3)}
.ft-dd-footer{padding:4px 14px 6px}
.ft-clear-btn{font-size:12px;background:none;border:none;color:var(--color-text-secondary,#6b6a66);cursor:pointer;padding:0;font-family:inherit}
.ft-sort-idx{width:18px;font-size:11px;color:var(--color-text-tertiary,#9b9a96);font-weight:500;flex-shrink:0}
.ft-sort-icon{font-size:15px;color:var(--color-border-secondary,#dddcd8)}
.ft-sort-icon--active{color:var(--color-text-primary,#1a1916)}
.ft-range-input{width:80px;padding:3px 6px;font-size:12px;border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:4px;font-family:inherit;background:transparent;color:inherit}
.ft-range-sep{color:var(--color-text-tertiary,#9b9a96);font-size:12px}
.ft-chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0 0}
.ft-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--color-background-secondary,#f7f6f3);border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:12px;font-size:12px;color:var(--color-text-secondary,#6b6a66)}
.ft-chip--filter{background:var(--color-background-info,#e6f1fb);color:var(--color-text-info,#185fa5);border-color:var(--color-border-info,#b8d6f5)}
.ft-chip--group{background:var(--color-background-warning,#faeeda);color:var(--color-text-warning,#854f0b);border-color:var(--color-border-warning,#f0d4a8)}
.ft-chip-x{cursor:pointer;margin-left:2px}
.ft-table-wrap{overflow-x:auto;border:0.5px solid var(--color-border-tertiary,#eeedea);border-radius:8px;margin-top:12px}
.ft-table{width:100%;border-collapse:collapse;font-size:13px}
.ft-th{padding:8px 12px;text-align:left;font-weight:500;font-size:12px;background:var(--color-background-secondary,#f7f6f3);color:var(--color-text-secondary,#6b6a66);border-bottom:0.5px solid var(--color-border-tertiary,#eeedea);white-space:nowrap;user-select:none;cursor:pointer}
.ft-th--no-sort{cursor:default}
.ft-th-inner{display:inline-flex;align-items:center;gap:4px}
.ft-td{padding:8px 12px;border-bottom:0.5px solid var(--color-border-tertiary,#eeedea);color:var(--color-text-primary,#1a1916);vertical-align:middle}
.ft-tr--odd .ft-td{background:var(--color-background-secondary,#f7f6f3)}
.ft-tr--selected .ft-td{background:var(--color-background-info,#e6f1fb)}
.ft-group-row{background:var(--color-background-secondary,#f7f6f3);font-weight:500;font-size:12px;color:var(--color-text-secondary,#6b6a66);cursor:pointer}
.ft-group-td{padding:6px 12px;border-bottom:0.5px solid var(--color-border-tertiary,#eeedea)}
.ft-group-sep{margin:0 4px;opacity:.4}
.ft-group-colname{margin-right:4px;opacity:.6}
.ft-group-count{margin-left:10px;font-weight:400;opacity:.6}
.ft-pagination{display:flex;align-items:center;gap:6px;padding:10px 2px;justify-content:flex-end;flex-wrap:wrap}
.ft-page-btn{padding:4px 9px;background:none;border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:4px;cursor:pointer;font-size:13px;color:var(--color-text-primary,#1a1916);font-family:inherit;line-height:1}
.ft-page-btn:disabled{opacity:.35;cursor:default}
.ft-page-info{font-size:12px;color:var(--color-text-secondary,#6b6a66);padding:0 6px}
.ft-page-select{padding:4px 6px;font-size:12px;border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:4px;background:transparent;color:inherit;font-family:inherit;cursor:pointer}
.ft-rows-per-page{font-size:12px;color:var(--color-text-secondary,#6b6a66);margin-left:10px}
.ft-search-input{padding:4px 8px;font-size:13px;border:0.5px solid var(--color-border-secondary,#dddcd8);border-radius:6px;background:transparent;color:inherit;font-family:inherit;min-width:160px}
.ft-agg-row{font-size:12px;font-weight:500;color:var(--color-text-secondary,#6b6a66);background:var(--color-background-secondary,#f7f6f3)}
.ft-agg-td{padding:4px 12px;border-bottom:0.5px solid var(--color-border-tertiary,#eeedea)}
`, Ae = {
  columns: "Columns",
  columnsSection: "Display",
  sort: "Sort",
  sortSection: "Columns to sort",
  clearSorts: "× Clear sorts",
  filter: "Filter",
  numericRanges: "Numeric ranges",
  min: "Min",
  max: "Max",
  clearFilters: "× Clear filters",
  group: "Group",
  groupSection: "Group by",
  clearGroups: "× Clear groups",
  clearAll: "× Clear all",
  rowCount: (e, n) => `${e} / ${n} row${n !== 1 ? "s" : ""}`,
  groupCount: (e) => ` · ${e} group${e !== 1 ? "s" : ""}`,
  groupLabel: (e) => `Group ${e}`,
  rowsInGroup: (e) => `${e} row${e !== 1 ? "s" : ""}`,
  rowsPerPage: "Rows per page",
  pageOf: (e, n) => `Page ${e} of ${n}`,
  search: "Search…"
}, Ge = {
  columns: "Colonnes",
  columnsSection: "Affichage",
  sort: "Trier",
  sortSection: "Colonnes à trier",
  clearSorts: "× Effacer les tris",
  filter: "Filtrer",
  numericRanges: "Plages numériques",
  min: "Min",
  max: "Max",
  clearFilters: "× Effacer les filtres",
  group: "Grouper",
  groupSection: "Grouper par",
  clearGroups: "× Effacer les groupes",
  clearAll: "× Tout effacer",
  rowCount: (e, n) => `${e} / ${n} ligne${n > 1 ? "s" : ""}`,
  groupCount: (e) => ` · ${e} groupe${e > 1 ? "s" : ""}`,
  groupLabel: (e) => `Groupe ${e}`,
  rowsInGroup: (e) => `${e} ligne${e > 1 ? "s" : ""}`,
  rowsPerPage: "Lignes par page",
  pageOf: (e, n) => `Page ${e} sur ${n}`,
  search: "Rechercher…"
}, Pe = {
  columns: "Columnas",
  columnsSection: "Visualización",
  sort: "Ordenar",
  sortSection: "Columnas a ordenar",
  clearSorts: "× Borrar orden",
  filter: "Filtrar",
  numericRanges: "Rangos numéricos",
  min: "Mín",
  max: "Máx",
  clearFilters: "× Borrar filtros",
  group: "Agrupar",
  groupSection: "Agrupar por",
  clearGroups: "× Borrar grupos",
  clearAll: "× Borrar todo",
  rowCount: (e, n) => `${e} / ${n} fila${n !== 1 ? "s" : ""}`,
  groupCount: (e) => ` · ${e} grupo${e !== 1 ? "s" : ""}`,
  groupLabel: (e) => `Grupo ${e}`,
  rowsInGroup: (e) => `${e} fila${e !== 1 ? "s" : ""}`,
  rowsPerPage: "Filas por página",
  pageOf: (e, n) => `Página ${e} de ${n}`,
  search: "Buscar…"
}, Fe = {
  columns: "Spalten",
  columnsSection: "Anzeige",
  sort: "Sortieren",
  sortSection: "Zu sortierende Spalten",
  clearSorts: "× Sortierung löschen",
  filter: "Filtern",
  numericRanges: "Zahlenbereiche",
  min: "Min",
  max: "Max",
  clearFilters: "× Filter löschen",
  group: "Gruppieren",
  groupSection: "Gruppieren nach",
  clearGroups: "× Gruppen löschen",
  clearAll: "× Alles löschen",
  rowCount: (e, n) => `${e} / ${n} Zeile${n !== 1 ? "n" : ""}`,
  groupCount: (e) => ` · ${e} Gruppe${e !== 1 ? "n" : ""}`,
  groupLabel: (e) => `Gruppe ${e}`,
  rowsInGroup: (e) => `${e} Zeile${e !== 1 ? "n" : ""}`,
  rowsPerPage: "Zeilen pro Seite",
  pageOf: (e, n) => `Seite ${e} von ${n}`,
  search: "Suchen…"
}, Ie = {
  columns: "Colunas",
  columnsSection: "Exibição",
  sort: "Ordenar",
  sortSection: "Colunas para ordenar",
  clearSorts: "× Limpar ordenação",
  filter: "Filtrar",
  numericRanges: "Intervalos numéricos",
  min: "Mín",
  max: "Máx",
  clearFilters: "× Limpar filtros",
  group: "Agrupar",
  groupSection: "Agrupar por",
  clearGroups: "× Limpar grupos",
  clearAll: "× Limpar tudo",
  rowCount: (e, n) => `${e} / ${n} linha${n !== 1 ? "s" : ""}`,
  groupCount: (e) => ` · ${e} grupo${e !== 1 ? "s" : ""}`,
  groupLabel: (e) => `Grupo ${e}`,
  rowsInGroup: (e) => `${e} linha${e !== 1 ? "s" : ""}`,
  rowsPerPage: "Linhas por página",
  pageOf: (e, n) => `Página ${e} de ${n}`,
  search: "Pesquisar…"
};
let ce = !1;
function Ee() {
  if (ce || typeof document > "u") return;
  ce = !0;
  const e = document.createElement("style");
  e.dataset.ftStyles = "", e.textContent = Le, document.head.appendChild(e);
}
function o(e) {
  return String(e ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function N(e, n, D) {
  return `<div class="ft-dd-wrap">${n}${e ? `<div class="ft-dd">${D()}</div>` : ""}</div>`;
}
function Me(e, n) {
  Ee();
  let D = n.data, m = n.columns;
  const { rowKey: V, selectable: R = !1, onSelectionChange: Q } = n, f = { ...ge, ...n.labels };
  let u = [], L = {}, z = {}, g = [], _ = /* @__PURE__ */ new Set(), w = 1, q = n.defaultPageSize ?? 0, Z = new Set(n.defaultVisibleColumns ?? m.map((s) => s.key)), v = /* @__PURE__ */ new Set(), S = null, j = "", y = [], H = [], M = 1, A = 1;
  function ie() {
    const s = he(D, m);
    y = me(
      ke(D, j, m),
      L,
      z,
      u
    ), M = $e(y.length, q), A = Math.min(w, Math.max(1, M));
    const p = ve(y, A, q);
    H = we(p, g);
    const c = m.filter((x) => Z.has(x.key) && !g.includes(x.key)), P = Se(L, z), h = y.filter((x) => v.has(x));
    return { stringValueMap: s, activeColumns: c, activeFilterCount: P, selectedRows: h };
  }
  function de(s, p) {
    const c = Ce(s, p);
    return c == null ? "" : s.format ? o(s.format(c)) : o(String(c));
  }
  function U(s, p) {
    const c = s[p.key];
    return p.format ? o(p.format(c)) : o(c != null ? String(c) : "");
  }
  function G() {
    var re, ae, ne;
    const s = document.activeElement, p = s && e.contains(s) ? s.dataset.focusKey ?? null : null, c = s instanceof HTMLInputElement ? s.selectionStart : null, P = s instanceof HTMLInputElement ? s.selectionEnd : null, { stringValueMap: h, activeColumns: x, activeFilterCount: E, selectedRows: K } = ie(), B = y.length > 0 && K.length === y.length, T = K.length > 0 && !B, i = u.length > 0 || E > 0 || g.length > 0 || j !== "", k = x.some((t) => t.aggregate !== void 0), $ = m.filter((t) => t.type === "number" && t.filterable !== !1), Y = m.filter(
      (t) => t.type !== "number" && t.type !== "date" && t.filterable !== !1
    ), I = m.filter((t) => t.groupable === !0);
    let r = '<div class="ft">';
    if (r += '<div class="ft-toolbar">', r += N(
      S === "cols",
      `<button class="ft-btn${S === "cols" ? " ft-btn--active" : ""}" data-action="toggle-dd" data-dd="cols">${o(f.columns)}</button>`,
      () => {
        let t = `<div class="ft-dd-section">${o(f.columnsSection)}</div>`;
        for (const a of m)
          t += `<label class="ft-dd-item"><input type="checkbox" data-action="toggle-col" data-key="${o(a.key)}"${Z.has(a.key) ? " checked" : ""}> ${o(a.label)}</label>`;
        return t;
      }
    ), r += N(
      S === "sort",
      `<button class="ft-btn${u.length > 0 ? " ft-btn--active" : ""}" data-action="toggle-dd" data-dd="sort">${o(f.sort)}${u.length > 0 ? ` <span class="ft-chip">${u.length}</span>` : ""}</button>`,
      () => {
        let t = `<div class="ft-dd-section">${o(f.sortSection)}</div>`;
        for (const a of m) {
          const l = le(u, a.key);
          t += `<div class="ft-dd-item ft-dd-item--click" data-action="toggle-sort" data-key="${o(a.key)}"><span class="ft-sort-idx">${l ?? ""}</span><span style="flex:1">${o(a.label)}</span><span class="ft-sort-icon${l ? " ft-sort-icon--active" : ""}">${se(u, a.key)}</span></div>`;
        }
        return u.length > 0 && (t += `<div class="ft-dd-footer"><button class="ft-clear-btn" data-action="clear-sorts">${o(f.clearSorts)}</button></div>`), t;
      }
    ), (Y.length > 0 || $.length > 0) && (r += N(
      S === "filter",
      `<button class="ft-btn${E > 0 ? " ft-btn--active" : ""}" data-action="toggle-dd" data-dd="filter">${o(f.filter)}${E > 0 ? ` <span class="ft-chip">${E}</span>` : ""}</button>`,
      () => {
        var a;
        let t = '<div style="max-height:380px;overflow-y:auto;min-width:240px">';
        for (const l of Y) {
          t += `<div class="ft-dd-section">${o(l.label)}</div>`;
          for (const b of h[l.key] ?? [])
            t += `<label class="ft-dd-item"><input type="checkbox" data-action="toggle-filter" data-key="${o(l.key)}" data-value="${o(b)}"${(a = L[l.key]) != null && a.has(b) ? " checked" : ""}> ${o(b)}</label>`;
        }
        if ($.length > 0) {
          t += `<div class="ft-dd-section">${o(f.numericRanges)}</div>`;
          for (const l of $) {
            const b = z[l.key];
            t += `<div style="padding:4px 14px 8px"><div class="ft-dd-sublabel">${o(l.label)}</div>`, t += '<div style="display:flex;gap:6px;align-items:center">', t += `<input type="number" class="ft-range-input" placeholder="${o(f.min)}" value="${o((b == null ? void 0 : b.min) ?? "")}" data-action="range-min" data-key="${o(l.key)}" data-focus-key="rmin-${o(l.key)}">`, t += '<span class="ft-range-sep">–</span>', t += `<input type="number" class="ft-range-input" placeholder="${o(f.max)}" value="${o((b == null ? void 0 : b.max) ?? "")}" data-action="range-max" data-key="${o(l.key)}" data-focus-key="rmax-${o(l.key)}">`, t += "</div></div>";
          }
        }
        return E > 0 && (t += `<div class="ft-dd-footer"><button class="ft-clear-btn" data-action="clear-filters">${o(f.clearFilters)}</button></div>`), t += "</div>", t;
      }
    )), I.length > 0 && (r += N(
      S === "group",
      `<button class="ft-btn${g.length > 0 ? " ft-btn--active" : ""}" data-action="toggle-dd" data-dd="group">${o(f.group)}${g.length > 0 ? ` <span class="ft-chip">${g.length}</span>` : ""}</button>`,
      () => {
        let t = `<div class="ft-dd-section">${o(f.groupSection)}</div>`;
        for (const a of I) {
          const l = g.indexOf(a.key);
          t += `<div class="ft-dd-item ft-dd-item--click" data-action="toggle-group" data-key="${o(a.key)}"><span class="ft-sort-idx">${l >= 0 ? l + 1 : ""}</span><span style="flex:1">${o(a.label)}</span>${g.includes(a.key) ? "<span>✓</span>" : ""}</div>`;
        }
        return g.length > 0 && (t += `<div class="ft-dd-footer"><button class="ft-clear-btn" data-action="clear-groups">${o(f.clearGroups)}</button></div>`), t;
      }
    )), r += `<input type="text" class="ft-search-input" placeholder="${o(f.search)}" value="${o(j)}" data-action="search" data-focus-key="search">`, i && (r += `<button class="ft-btn" data-action="clear-all" style="margin-left:4px">${o(f.clearAll)}</button>`), r += `<span class="ft-stats">${o(f.rowCount(y.length, D.length))}${g.length > 0 ? o(f.groupCount(H.length)) : ""}</span>`, r += "</div>", i) {
      r += '<div class="ft-chips">';
      for (const t of u)
        r += `<span class="ft-chip">${u.indexOf(t) + 1}. ${o(((re = m.find((a) => a.key === t.key)) == null ? void 0 : re.label) ?? t.key)} ${t.dir === "asc" ? "↑" : "↓"} <span class="ft-chip-x" data-action="remove-sort" data-key="${o(t.key)}">×</span></span>`;
      for (const [t, a] of Object.entries(L))
        a.size && (r += `<span class="ft-chip ft-chip--filter">${o(((ae = m.find((l) => l.key === t)) == null ? void 0 : ae.label) ?? t)}: ${o([...a].join(", "))} <span class="ft-chip-x" data-action="clear-filter-key" data-key="${o(t)}">×</span></span>`);
      for (let t = 0; t < g.length; t++) {
        const a = g[t];
        r += `<span class="ft-chip ft-chip--group">${o(f.groupLabel(t + 1))}: ${o(((ne = m.find((l) => l.key === a)) == null ? void 0 : ne.label) ?? a)} <span class="ft-chip-x" data-action="remove-group" data-key="${o(a)}">×</span></span>`;
      }
      r += "</div>";
    }
    r += '<div class="ft-table-wrap"><table class="ft-table"><thead><tr>', R && (r += `<th class="ft-th ft-th--no-sort" style="width:36px"><input type="checkbox" data-action="select-all"${B ? " checked" : ""}></th>`), g.length > 0 && (r += '<th class="ft-th ft-th--no-sort" style="width:28px"></th>');
    for (const t of x) {
      const a = le(u, t.key);
      r += `<th class="ft-th"${t.width ? ` style="width:${t.width}px"` : ""} data-action="toggle-sort" data-key="${o(t.key)}"><span class="ft-th-inner">${o(t.label)} <span class="ft-sort-icon${a ? " ft-sort-icon--active" : ""}">${a ? `${a}${se(u, t.key)}` : "↕"}</span></span></th>`;
    }
    r += "</tr></thead><tbody>";
    const oe = new Map(y.map((t, a) => [t, a]));
    for (const { key: t, rows: a } of H)
      if (t !== null) {
        const l = _.has(t), b = a.length > 0 && a.every((d) => v.has(d));
        r += `<tr class="ft-group-row" data-action="toggle-group-collapse" data-gkey="${o(t)}">`, R && (r += `<td class="ft-group-td" style="width:36px" data-no-collapse><input type="checkbox" data-action="toggle-group-select" data-gkey="${o(t)}"${b ? " checked" : ""}></td>`), r += `<td class="ft-group-td" style="width:28px">${l ? "▶" : "▼"}</td>`, r += `<td class="ft-group-td" colspan="${x.length}">`;
        for (let d = 0; d < g.length; d++) {
          const C = g[d], F = m.find((O) => O.key === C);
          d > 0 && (r += '<span class="ft-group-sep"> › </span>'), r += `<span class="ft-group-colname">${o((F == null ? void 0 : F.label) ?? C)}:</span> `, r += F ? U(a[0], F) : o(String(a[0][C] ?? ""));
        }
        if (r += ` <span class="ft-group-count">${o(f.rowsInGroup(a.length))}</span></td></tr>`, k) {
          r += '<tr class="ft-agg-row">', R && (r += '<td class="ft-agg-td" style="width:36px"></td>'), r += '<td class="ft-agg-td" style="width:28px"></td>';
          for (const d of x)
            r += `<td class="ft-agg-td">${de(d, a)}</td>`;
          r += "</tr>";
        }
        if (!l)
          for (let d = 0; d < a.length; d++) {
            const C = a[d], F = oe.get(C) ?? -1, O = v.has(C), J = `ft-tr${O ? " ft-tr--selected" : d % 2 !== 0 ? " ft-tr--odd" : ""}`, pe = V ? String(C[V] ?? d) : d;
            r += `<tr class="${J}" data-row-key="${o(pe)}">`, R && (r += `<td class="ft-td" style="width:36px"><input type="checkbox" data-action="toggle-row-select" data-proc-idx="${F}"${O ? " checked" : ""}></td>`), r += '<td class="ft-td" style="width:28px"></td>';
            for (const fe of x)
              r += `<td class="ft-td">${U(C, fe)}</td>`;
            r += "</tr>";
          }
      } else
        for (let l = 0; l < a.length; l++) {
          const b = a[l], d = oe.get(b) ?? -1, C = v.has(b), F = `ft-tr${C ? " ft-tr--selected" : l % 2 !== 0 ? " ft-tr--odd" : ""}`, O = V ? String(b[V] ?? l) : l;
          r += `<tr class="${F}" data-row-key="${o(O)}">`, R && (r += `<td class="ft-td" style="width:36px"><input type="checkbox" data-action="toggle-row-select" data-proc-idx="${d}"${C ? " checked" : ""}></td>`);
          for (const J of x)
            r += `<td class="ft-td">${U(b, J)}</td>`;
          r += "</tr>";
        }
    if (r += "</tbody></table></div>", q > 0) {
      r += '<div class="ft-pagination">', r += `<button class="ft-page-btn" data-action="page-first"${A === 1 ? " disabled" : ""}>«</button>`, r += `<button class="ft-page-btn" data-action="page-prev"${A === 1 ? " disabled" : ""}>‹</button>`, r += `<span class="ft-page-info">${o(f.pageOf(A, M))}</span>`, r += `<button class="ft-page-btn" data-action="page-next"${A >= M ? " disabled" : ""}>›</button>`, r += `<button class="ft-page-btn" data-action="page-last"${A >= M ? " disabled" : ""}>»</button>`, r += `<span class="ft-rows-per-page">${o(f.rowsPerPage)}:</span>`, r += '<select class="ft-page-select" data-action="set-page-size">';
      for (const t of [10, 20, 50, 100])
        r += `<option value="${t}"${q === t ? " selected" : ""}>${t}</option>`;
      r += "</select></div>";
    }
    if (r += "</div>", e.innerHTML = r, R) {
      if (T) {
        const t = e.querySelector('[data-action="select-all"]');
        t && (t.indeterminate = !0);
      }
      for (const { key: t, rows: a } of H) {
        if (t === null) continue;
        if (!a.every((d) => v.has(d)) && a.some((d) => v.has(d))) {
          for (const d of e.querySelectorAll(
            '[data-action="toggle-group-select"]'
          ))
            if (d.dataset.gkey === t) {
              d.indeterminate = !0;
              break;
            }
        }
      }
    }
    if (p) {
      for (const t of e.querySelectorAll("[data-focus-key]"))
        if (t.dataset.focusKey === p) {
          t.focus(), t instanceof HTMLInputElement && c !== null && t.setSelectionRange(c, P ?? c);
          break;
        }
    }
  }
  function W(s) {
    const p = s.target, c = p.closest("[data-action]");
    if (S !== null && !p.closest(".ft-dd-wrap") && (S = null, !c)) {
      G();
      return;
    }
    if (!c) return;
    const P = c.dataset.action, h = c.dataset.key ?? "", x = c.dataset.dd ?? "", E = c.dataset.value ?? "", K = c.dataset.gkey ?? "", B = parseInt(c.dataset.procIdx ?? "-1", 10);
    let T = !1;
    switch (P) {
      case "toggle-dd":
        S = S === x ? null : x;
        break;
      case "toggle-sort":
        u = ye(u, h);
        break;
      case "remove-sort":
        u = u.filter((i) => i.key !== h);
        break;
      case "toggle-col": {
        const i = new Set(Z);
        i.has(h) ? i.size > 1 && i.delete(h) : i.add(h), Z = i;
        break;
      }
      case "toggle-filter":
        L = xe(L, h, E), w = 1;
        break;
      case "toggle-group":
        g = be(g, h);
        break;
      case "remove-group":
        g = g.filter((i) => i !== h);
        break;
      case "toggle-group-collapse":
        p.closest("[data-no-collapse]") || (_ = ue(_, K));
        break;
      case "clear-sorts":
        u = [];
        break;
      case "clear-filters":
        L = {}, z = {}, w = 1;
        break;
      case "clear-groups":
        g = [], _ = /* @__PURE__ */ new Set();
        break;
      case "clear-filter-key":
        L = { ...L, [h]: /* @__PURE__ */ new Set() }, w = 1;
        break;
      case "clear-all":
        u = [], L = {}, z = {}, g = [], _ = /* @__PURE__ */ new Set(), w = 1, j = "", S = null;
        break;
      case "select-all": {
        const i = new Set(v);
        y.length > 0 && y.every(($) => i.has($)) ? y.forEach(($) => i.delete($)) : y.forEach(($) => i.add($)), v = i, T = !0;
        break;
      }
      case "toggle-row-select": {
        if (B >= 0 && B < y.length) {
          const i = y[B], k = new Set(v);
          k.has(i) ? k.delete(i) : k.add(i), v = k, T = !0;
        }
        break;
      }
      case "toggle-group-select": {
        const i = H.find((k) => k.key === K);
        if (i) {
          const k = i.rows, $ = new Set(v);
          k.length > 0 && k.every((I) => $.has(I)) ? k.forEach((I) => $.delete(I)) : k.forEach((I) => $.add(I)), v = $, T = !0;
        }
        break;
      }
      case "page-first":
        w = 1;
        break;
      case "page-prev":
        w = Math.max(1, A - 1);
        break;
      case "page-next":
        w = Math.min(M, A + 1);
        break;
      case "page-last":
        w = M;
        break;
      default:
        return;
    }
    G(), T && (Q == null || Q(y.filter((i) => v.has(i))));
  }
  function X(s) {
    var x, E;
    const p = s.target, c = p.dataset.action;
    if (c === "search") {
      j = p.value, w = 1, G();
      return;
    }
    if (c !== "range-min" && c !== "range-max") return;
    const P = p.dataset.key ?? "", h = c === "range-min" ? "min" : "max";
    z = {
      ...z,
      [P]: {
        min: ((x = z[P]) == null ? void 0 : x.min) ?? "",
        max: ((E = z[P]) == null ? void 0 : E.max) ?? "",
        [h]: p.value
      }
    }, w = 1, G();
  }
  function ee(s) {
    const p = s.target;
    p.dataset.action === "set-page-size" && (q = Number(p.value), w = 1, G());
  }
  function te(s) {
    S !== null && !s.composedPath().includes(e) && (S = null, G());
  }
  return e.addEventListener("click", W), e.addEventListener("input", X), e.addEventListener("change", ee), document.addEventListener("click", te), G(), {
    setData(s) {
      D = s, G();
    },
    setColumns(s) {
      m = s, G();
    },
    destroy() {
      e.removeEventListener("click", W), e.removeEventListener("input", X), e.removeEventListener("change", ee), document.removeEventListener("click", te), e.innerHTML = "";
    }
  };
}
export {
  Fe as LABELS_DE,
  Ae as LABELS_EN,
  Pe as LABELS_ES,
  Ge as LABELS_FR,
  Ie as LABELS_PT,
  Me as createFlexiTable
};
