// OD-3 -- deterministic OFFLINE tests for the Work Order inventorySnapshot display helpers.
// The snapshot is the AUTHORITATIVE HISTORICAL source: a recorded name/category/unit is
// returned as-is (never overwritten by any catalog value), and missing/empty/malformed values
// degrade to the raw SKU (name) or a bounded neutral fallback (category "—", unit "unit(s)").
// These helpers perform NO catalog lookup by construction (they take only the snapshot item).
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  snapshotPartName,
  snapshotPartSku,
  snapshotPartCategory,
  snapshotPartUnit,
} from "../src/domain/workOrderInventorySnapshot.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("workOrderInventorySnapshot.test.mjs");

// ---- structural: the module performs NO catalog lookup ----------------------
check("no catalog import: the helper module never references the static/canonical catalog", () => {
  const src = fs.readFileSync(new URL("../src/domain/workOrderInventorySnapshot.js", import.meta.url), "utf8");
  assert.equal(/getCatalogItem|partsCatalog|fetchPartMasterList|partsCatalogView/.test(src), false);
});

// ---- snapshotPartName --------------------------------------------------------
check("snapshotPartName: a recorded snapshot name is returned as-is (authoritative)", () => {
  assert.equal(snapshotPartName({ name: "Hex Coupler (as recorded)", sku: "TST-9001" }), "Hex Coupler (as recorded)");
});
check("snapshotPartName: recorded name is used even if it differs from any current catalog value (no override)", () => {
  // there is no catalog arg -- by construction the historical recorded name always wins.
  assert.equal(snapshotPartName({ name: "OLD RECORDED NAME", sku: "TST-1001" }), "OLD RECORDED NAME");
});
check("snapshotPartName: missing / empty / malformed name -> raw SKU", () => {
  assert.equal(snapshotPartName({ sku: "TST-9001" }), "TST-9001");             // missing
  assert.equal(snapshotPartName({ name: "", sku: "TST-9001" }), "TST-9001");    // empty
  assert.equal(snapshotPartName({ name: null, sku: "TST-9001" }), "TST-9001");  // null
  assert.equal(snapshotPartName({ name: { any: "obj" }, sku: "TST-9001" }), "TST-9001"); // malformed non-string
  assert.equal(snapshotPartName({ name: 123, sku: "TST-9001" }), "TST-9001");   // malformed number
});
check("snapshotPartName: missing name AND missing/malformed sku -> empty string (never a catalog name)", () => {
  assert.equal(snapshotPartName({}), "");
  assert.equal(snapshotPartName({ name: "", sku: null }), "");
  assert.equal(snapshotPartName(null), "");
});

// ---- snapshotPartSku / category / unit --------------------------------------
check("snapshotPartSku: valid sku else empty", () => {
  assert.equal(snapshotPartSku({ sku: "TST-9001" }), "TST-9001");
  assert.equal(snapshotPartSku({ sku: "" }), "");
  assert.equal(snapshotPartSku({}), "");
});
check("snapshotPartCategory: valid recorded category else the neutral '—'", () => {
  assert.equal(snapshotPartCategory({ category: "Valves" }), "Valves");
  assert.equal(snapshotPartCategory({ category: "" }), "—");
  assert.equal(snapshotPartCategory({}), "—");
  assert.equal(snapshotPartCategory({ category: 5 }), "—");
});
check("snapshotPartUnit: valid recorded unit else the neutral 'unit(s)'", () => {
  assert.equal(snapshotPartUnit({ unit: "each" }), "each");
  assert.equal(snapshotPartUnit({ unit: "" }), "unit(s)");
  assert.equal(snapshotPartUnit({}), "unit(s)");
});

console.log(`\n${passed} passed, 0 failed`);
