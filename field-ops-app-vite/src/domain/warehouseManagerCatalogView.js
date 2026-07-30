// Issue #100 — WarehouseManagerHome canonical Parts Catalog derivation (pure, offline-testable).
//
// Brings the Warehouse Manager surface onto the SAME canonical-first path PartsList (C1) and PartDetail
// (C2) already use: it composes the LIVE canonical `parts` read with the static compatibility catalog
// through the shared buildPartsCatalogRows() — canonical `parts` is the authoritative identity/metadata
// source; the static PARTS_CATALOG is ONLY the governed STATIC_FALLBACK input, never a parallel source of
// truth. It introduces NO new Parts source and does NOT retire the static catalog.
//
// Fail-closed by construction: a denied / unavailable / incomplete / not-fully-accounted canonical read
// yields a BLOCKED_* status with rows:[] — the surface must show a blocked message, NEVER the static 200
// presented as canonical and NEVER a silent static fallback. LOADING is distinct from BLOCKED.
//
// Pure: no Firebase, no network, no React, no clock/random, no input mutation.
import { buildPartsCatalogRows, isCatalogBlocked } from "./partsCatalogView.js";

/**
 * Compose the Warehouse Manager catalog view from a live canonical read + the static catalog.
 * @param {{ canonicalRead: ({status:string,rows?:Array}|null), staticCatalog: Array }} input
 *   canonicalRead === null  => LOADING (the one-shot read has not resolved yet).
 * @returns {{ status:string, rows:Array, loading:boolean, blocked:boolean, meta:object }}
 */
export function buildWarehouseCatalog(input = {}) {
  const { canonicalRead, staticCatalog } = input;
  if (canonicalRead == null) {
    return { status: "LOADING", rows: [], loading: true, blocked: false, meta: {} };
  }
  const composed = buildPartsCatalogRows({ canonicalRead, staticCatalog });
  const ready = composed.status === "READY";
  return {
    status: composed.status,
    rows: ready ? composed.rows : [],
    loading: false,
    blocked: isCatalogBlocked(composed.status),
    meta: composed.meta,
  };
}

/** Distinct, sorted categories from the composed rows, prefixed with "ALL". Empty rows => just ["ALL"]. */
export function catalogCategories(rows) {
  const set = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.category === "string" && r.category.length > 0) set.add(r.category);
  }
  return ["ALL", ...[...set].sort()];
}

/** Filter composed rows by category ("ALL" => all rows). Never mutates the input. */
export function filterCatalogRowsByCategory(rows, category) {
  const list = Array.isArray(rows) ? rows : [];
  return category === "ALL" ? list : list.filter((r) => r && r.category === category);
}

/** partId(sku) -> canonical display name map from composed rows (for name resolution without the static
 * catalog). Empty under LOADING/BLOCKED. Callers fall back to the static name then the raw id. */
export function nameBySku(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.sku === "string" && typeof r.name === "string") map.set(r.sku, r.name);
  }
  return map;
}
