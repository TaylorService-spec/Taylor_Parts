// Issue #100 — offline tests for the WarehouseManagerHome canonical Parts Catalog view-model. No Firebase,
// no network, no DOM: pure composition + fail-closed behavior. Proves the Warehouse Manager surface reads
// canonical `parts` as primary (static only as STATIC_FALLBACK) and NEVER shows static-as-canonical on a
// denied/unavailable/incomplete canonical read.
import assert from "node:assert/strict";
import {
  buildWarehouseCatalog,
  catalogCategories,
  filterCatalogRowsByCategory,
  nameBySku,
} from "../src/domain/warehouseManagerCatalogView.js";

let passed = 0;
const ok = (n, f) => { f(); passed += 1; console.log(`  ok - ${n}`); };
console.log("warehouseManagerCatalogView.test.mjs");

// Minimal fully-accounted fixture: two static SKUs, both matched by canonical partId == sku => CANONICAL_MATCH.
const staticCatalog = [
  { sku: "TST-9001", name: "Static Name A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 42 },
  { sku: "TST-9002", name: "Static Name B", category: "Fittings", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 7 },
];
const canonicalRows = [
  { partId: "TST-9001", name: "Canonical Name A", category: "Valves", stockingUnit: "each" },
  { partId: "TST-9002", name: "Canonical Name B", category: "Fittings", stockingUnit: "each" },
];
const okRead = { status: "OK", rows: canonicalRows };

// ---- LOADING ----
ok("null canonicalRead => LOADING (not blocked), rows []", () => {
  const c = buildWarehouseCatalog({ canonicalRead: null, staticCatalog });
  assert.equal(c.status, "LOADING");
  assert.equal(c.loading, true);
  assert.equal(c.blocked, false);
  assert.deepEqual(c.rows, []);
});

// ---- READY (canonical-first) ----
ok("OK canonical read composes READY canonical-first rows; NAME is canonical, warehouseQty static-fallback", () => {
  const c = buildWarehouseCatalog({ canonicalRead: okRead, staticCatalog });
  assert.equal(c.status, "READY");
  assert.equal(c.blocked, false);
  assert.equal(c.loading, false);
  assert.equal(c.rows.length, 2);
  const a = c.rows.find((r) => r.sku === "TST-9001");
  assert.equal(a.name, "Canonical Name A", "identity/name is canonical, not the static name");
  assert.equal(a.category, "Valves");
  assert.equal(a.warehouseQty, 42, "warehouseQty is the static baseline (STATIC_FALLBACK)");
  assert.equal(a.identityState, "CANONICAL_MATCH");
});

// ---- FAIL-CLOSED: canonical read denied/unavailable/incomplete => BLOCKED, rows [] (never static-as-canonical) ----
for (const [label, read, expected] of [
  ["PERMISSION_DENIED", { status: "PERMISSION_DENIED" }, "BLOCKED_PERMISSION"],
  ["UNAVAILABLE", { status: "UNAVAILABLE" }, "BLOCKED_UNAVAILABLE"],
  ["unknown status", { status: "WEIRD" }, "BLOCKED_INCOMPLETE_INPUT"],
  ["OK but rows missing", { status: "OK" }, "BLOCKED_INCOMPLETE_INPUT"],
]) {
  ok(`canonical ${label} => ${expected}, blocked, rows [] (never the static catalog)`, () => {
    const c = buildWarehouseCatalog({ canonicalRead: read, staticCatalog });
    assert.equal(c.status, expected);
    assert.equal(c.blocked, true);
    assert.deepEqual(c.rows, [], "a failed canonical read NEVER yields the static 200 as rows");
  });
}

ok("OK canonical read but static catalog missing/empty => BLOCKED_INCOMPLETE_INPUT (fail closed)", () => {
  assert.equal(buildWarehouseCatalog({ canonicalRead: okRead, staticCatalog: [] }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(buildWarehouseCatalog({ canonicalRead: okRead, staticCatalog: undefined }).blocked, true);
});

ok("incomplete accounting (a static sku with no canonical match, not an approved exclusion) => BLOCKED, never a partial list", () => {
  const extraStatic = staticCatalog.concat([{ sku: "TST-9999", name: "Orphan", category: "X", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }]);
  const c = buildWarehouseCatalog({ canonicalRead: okRead, staticCatalog: extraStatic });
  assert.equal(c.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.deepEqual(c.rows, []);
});

// ---- category + filter + name helpers ----
ok("catalogCategories: distinct sorted + ALL prefix; ignores null/empty categories", () => {
  const rows = [{ sku: "a", category: "Valves" }, { sku: "b", category: "Fittings" }, { sku: "c", category: "Valves" }, { sku: "d", category: null }];
  assert.deepEqual(catalogCategories(rows), ["ALL", "Fittings", "Valves"]);
  assert.deepEqual(catalogCategories([]), ["ALL"]);
  assert.deepEqual(catalogCategories(null), ["ALL"]);
});
ok("filterCatalogRowsByCategory: ALL returns all; a category filters; never mutates", () => {
  const rows = [{ sku: "a", category: "Valves" }, { sku: "b", category: "Fittings" }];
  assert.equal(filterCatalogRowsByCategory(rows, "ALL").length, 2);
  assert.deepEqual(filterCatalogRowsByCategory(rows, "Valves").map((r) => r.sku), ["a"]);
  const before = rows.slice();
  filterCatalogRowsByCategory(rows, "Valves");
  assert.deepEqual(rows, before);
});
ok("nameBySku: maps canonical rows sku->name", () => {
  const m = nameBySku([{ sku: "TST-9001", name: "Canonical Name A" }]);
  assert.equal(m.get("TST-9001"), "Canonical Name A");
  assert.equal(m.has("nope"), false);
});

console.log(`\n${passed} passed, 0 failed`);
