// Part↔Supplier projections -- OFFLINE tests for the pure projection contract (the cost-exposure crux).
// Proves: fail-closed without inventory.catalog.read; relationship projection carries relationship+
// operational but NEVER cost; cost projection adds cost ONLY when inventory.catalog.cost.read is present;
// cost can never be inferred through the relationship projection.
import assert from "node:assert/strict";
import {
  projectPartSupplierItem, projectPartSupplierItems, COST_FIELDS,
} from "../lib/partMaster/partSupplierItemProjections.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partSupplierItemProjections.test.mjs");

const RAW = {
  partId: "P-1", supplierId: "SUP-A", supplierSku: "SKU-9", status: "ACTIVE", preferred: true,
  leadTimeDays: 7, availability: "AVAILABLE", minOrderQty: "5", orderMultiple: "5", purchaseUnit: "CASE",
  cost: "12.50", currency: "USD", contractStart: "2026-01-01", contractEnd: "2026-12-31", lastVerifiedAt: "x",
};

check("fail-closed: no catalog.read -> null projection (no relationship, no cost)", () => {
  assert.equal(projectPartSupplierItem(RAW, { catalogRead: false, costRead: false }), null);
  assert.equal(projectPartSupplierItem(RAW, { catalogRead: false, costRead: true }), null); // costRead alone never bypasses
  assert.equal(projectPartSupplierItem(RAW, undefined), null);
  assert.deepEqual(projectPartSupplierItems([RAW, RAW], { catalogRead: false, costRead: true }), []);
});

check("relationship projection (catalog.read only): relationship+operational, NEVER any cost field", () => {
  const p = projectPartSupplierItem(RAW, { catalogRead: true, costRead: false });
  assert.equal(p.tier, "relationship");
  assert.equal(p.fields.supplierId, "SUP-A");
  assert.equal(p.fields.supplierSku, "SKU-9");
  assert.equal(p.fields.preferred, true);
  assert.equal(p.fields.leadTimeDays, 7);
  assert.equal(p.fields.availability, "AVAILABLE");
  for (const c of COST_FIELDS) assert.ok(!(c in p.fields), `relationship projection leaked cost field ${c}`);
});

check("cost projection (catalog.read AND cost.read): adds cost/commercial fields", () => {
  const p = projectPartSupplierItem(RAW, { catalogRead: true, costRead: true });
  assert.equal(p.tier, "cost");
  assert.equal(p.fields.cost, "12.50");
  assert.equal(p.fields.currency, "USD");
  assert.equal(p.fields.contractStart, "2026-01-01");
  assert.equal(p.fields.supplierId, "SUP-A"); // still carries relationship+operational
  assert.equal(p.fields.leadTimeDays, 7);
});

check("list projection drops nothing under authority; malformed row -> empty fields, never crash", () => {
  const list = projectPartSupplierItems([RAW, null, "x"], { catalogRead: true, costRead: false });
  assert.equal(list.length, 3);
  assert.equal(list[0].fields.supplierId, "SUP-A");
  assert.deepEqual(list[1].fields, {}); // null row -> empty projection, not a crash
});

console.log(`\n${passed} passed, 0 failed`);
