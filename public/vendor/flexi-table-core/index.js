import { LABELS_EN as k, LABELS_DE as w, LABELS_EN as D, LABELS_ES as B, LABELS_FR as O, LABELS_PT as C } from "./locales.js";
function g(t, n, e, r) {
  let i = [...t];
  for (const [u, o] of Object.entries(n))
    o.size > 0 && (i = i.filter((a) => o.has(String(a[u] ?? ""))));
  for (const [u, o] of Object.entries(e))
    o.min !== "" && (i = i.filter((a) => Number(a[u]) >= Number(o.min))), o.max !== "" && (i = i.filter((a) => Number(a[u]) <= Number(o.max)));
  return r.length > 0 && i.sort((u, o) => {
    for (const { key: a, dir: l } of r) {
      const f = u[a], s = o[a];
      let c = 0;
      if (typeof f == "number" && typeof s == "number" ? c = f - s : c = String(f ?? "").localeCompare(String(s ?? "")), c !== 0) return l === "asc" ? c : -c;
    }
    return 0;
  }), i;
}
function m(t, n) {
  if (n.length === 0) return [{ key: null, rows: t }];
  const e = {};
  for (const r of t) {
    const i = n.map((u) => String(r[u] ?? "")).join(" › ");
    e[i] || (e[i] = []), e[i].push(r);
  }
  return Object.entries(e).map(([r, i]) => ({ key: r, rows: i }));
}
function d(t, n) {
  const e = {}, r = n.filter(
    (i) => i.type !== "number" && i.type !== "date" && i.filterable !== !1
  );
  for (const i of r) {
    const u = [...new Set(t.map((o) => String(o[i.key] ?? "")))];
    e[i.key] = u.sort();
  }
  return e;
}
function p(t, n) {
  const e = t.find((r) => r.key === n);
  return e ? e.dir === "asc" ? t.map((r) => r.key === n ? { ...r, dir: "desc" } : r) : t.filter((r) => r.key !== n) : [...t, { key: n, dir: "asc" }];
}
function S(t, n, e) {
  const r = new Set(t[n] ?? []);
  return r.has(e) ? r.delete(e) : r.add(e), { ...t, [n]: r };
}
function h(t, n) {
  return t.includes(n) ? t.filter((e) => e !== n) : [...t, n];
}
function L(t, n) {
  const e = new Set(t);
  return e.has(n) ? e.delete(n) : e.add(n), e;
}
function b(t, n) {
  const e = t.find((r) => r.key === n);
  return e ? e.dir === "asc" ? "↑" : "↓" : "↕";
}
function x(t, n) {
  const e = t.findIndex((r) => r.key === n);
  return e >= 0 ? e + 1 : null;
}
function E(t, n, e) {
  if (e <= 0) return t;
  const r = (n - 1) * e;
  return t.slice(r, r + e);
}
function A(t, n) {
  return n <= 0 ? 1 : Math.max(1, Math.ceil(t / n));
}
function N(t, n, e) {
  if (!n) return t;
  const r = n.toLowerCase();
  return t.filter(
    (i) => e.some((u) => {
      const o = i[u.key];
      return (u.format ? u.format(o) : o != null ? String(o) : "").toLowerCase().includes(r);
    })
  );
}
function v(t, n) {
  if (!t.aggregate) return;
  if (typeof t.aggregate == "function") return t.aggregate(n);
  if (t.aggregate === "count") return n.length;
  const e = n.map((r) => Number(r[t.key])).filter((r) => !isNaN(r));
  if (e.length !== 0)
    switch (t.aggregate) {
      case "sum":
        return e.reduce((r, i) => r + i, 0);
      case "avg":
        return e.reduce((r, i) => r + i, 0) / e.length;
      case "min":
        return Math.min(...e);
      case "max":
        return Math.max(...e);
    }
}
function y(t, n) {
  return Object.values(t).filter((e) => e.size > 0).length + Object.values(n).filter((e) => e.min !== "" || e.max !== "").length;
}
export {
  k as DEFAULT_LABELS,
  w as LABELS_DE,
  D as LABELS_EN,
  B as LABELS_ES,
  O as LABELS_FR,
  C as LABELS_PT,
  A as calcTotalPages,
  v as computeAggregate,
  d as computeStringValues,
  y as countActiveFilters,
  b as getSortIcon,
  x as getSortIndex,
  m as groupData,
  E as paginateData,
  g as processData,
  N as searchData,
  L as toggleCollapse,
  S as toggleFilter,
  h as toggleGroupBy,
  p as toggleSort
};
