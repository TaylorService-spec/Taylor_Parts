// Governed Supplier picker -- OFFLINE tests for the pure selection helpers. Only ACTIVE governed
// suppliers are selectable; INACTIVE/ungoverned excluded; a bare string is never selectable.
import assert from "node:assert/strict";
import { selectableActiveSuppliers, rankSupplierMatches, isSelectableSupplier } from "../src/domain/supplierPicker.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("supplierPicker.test.mjs");

const RAW = [
  { id: "s1", name: "Acme Supply", status: "ACTIVE", vendorNumber: "V-1" },
  { id: "s2", name: "Beta Parts", status: "INACTIVE" },                 // inactive -> not selectable
  { id: "s3", name: "Acme Tools", status: "ACTIVE" },
  { id: "s4", name: "Legacy Vendor" },                                   // no status -> ungoverned -> excluded
  { name: "no-id" },                                                     // malformed -> skipped
];

check("selectableActiveSuppliers: only ACTIVE governed rows, name-sorted; excludes inactive/ungoverned/malformed", () => {
  const rows = selectableActiveSuppliers(RAW);
  assert.deepEqual(rows.map((r) => r.id), ["s1", "s3"]); // Acme Supply, Acme Tools (name-sorted); s2 inactive, s4 ungoverned, malformed skipped
  assert.ok(rows.every((r) => r.status === "ACTIVE"));
  assert.deepEqual(selectableActiveSuppliers(undefined), []); // never throws
});

check("rankSupplierMatches: name/vendor substring, bounded; empty query returns all (bounded)", () => {
  const rows = selectableActiveSuppliers(RAW);
  assert.deepEqual(rankSupplierMatches(rows, "tools").results.map((r) => r.id), ["s3"]);
  assert.deepEqual(rankSupplierMatches(rows, "v-1").results.map((r) => r.id), ["s1"]); // vendor number match
  assert.equal(rankSupplierMatches(rows, "").results.length, 2); // empty query -> all active
  assert.equal(rankSupplierMatches(rows, "zzz").results.length, 0);
  assert.equal(rankSupplierMatches(rows, "acme", 1).results.length, 1); // bounded to limit
});

check("isSelectableSupplier: ACTIVE entity with a name only; rejects string/inactive/null", () => {
  assert.equal(isSelectableSupplier({ id: "s1", name: "Acme", status: "ACTIVE" }), true);
  assert.equal(isSelectableSupplier({ id: "s2", name: "Beta", status: "INACTIVE" }), false);
  assert.equal(isSelectableSupplier({ status: "ACTIVE" }), false); // no name
  assert.equal(isSelectableSupplier("Acme"), false); // a bare string is never a governed selection
  assert.equal(isSelectableSupplier(null), false);
});

console.log(`\n${passed} passed, 0 failed`);
