// Purchasing > Suppliers -- OFFLINE tests for the pure registry view helpers (house
// check()/passed convention). No Firebase/network. The workspace reports the stored governed
// STATUS (ACTIVE/INACTIVE) and honestly surfaces legacy/ungoverned docs; these tests assert exactly
// that scoping (a client status read, not a re-run of the backend governed validator).
import assert from "node:assert/strict";
import {
  SUPPLIER_STATUSES,
  buildSuppliersView,
  summarizeSuppliers,
  filterSuppliers,
  countForSupplierFilter,
  supplierStatusLabel,
  supplierStatusTone,
  SUPPLIER_FILTERS,
  DEFAULT_SUPPLIER_FILTER,
} from "../src/domain/suppliersView.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("suppliersView.test.mjs");

check("status mirror = the two governed values; labels avoid raw casing; ungoverned is explicit", () => {
  assert.deepEqual([...SUPPLIER_STATUSES], ["ACTIVE", "INACTIVE"]);
  assert.equal(supplierStatusLabel("ACTIVE"), "Active");
  assert.equal(supplierStatusLabel("INACTIVE"), "Inactive");
  assert.equal(supplierStatusLabel(null), "Ungoverned"); // missing status is named honestly, not "Unknown/Active"
  assert.equal(supplierStatusTone("ACTIVE"), "done");
  assert.equal(supplierStatusTone("INACTIVE"), "muted");
  assert.equal(supplierStatusTone(null), "warn"); // ungoverned draws the eye
  assert.equal(supplierStatusTone("weird"), "warn");
});

const S = [
  { id: "s2", name: "North Vendor", status: "ACTIVE", vendorNumber: "V-2", email: "n@v.test" },
  { id: "s1", name: "Acme Supply", status: "ACTIVE", phone: "555-1000" }, // no email -> contact falls to phone
  { id: "s3", name: "Old Vendor", status: "INACTIVE", contactName: "Pat" }, // no email/phone -> contactName
  { id: "s5", name: "Legacy Demo Co", contactEmail: "legacy@demo.test", leadTimeDays: 7 }, // no status -> ungoverned; legacy fields ignored by view
  { name: "no-id" }, // malformed -> skipped
];

check("buildSuppliersView: skips malformed, sorts by name, status null when absent, contact preference order", () => {
  const { rows } = buildSuppliersView(S);
  // by name: Acme Supply(s1), Legacy Demo Co(s5), North Vendor(s2), Old Vendor(s3)
  assert.deepEqual(rows.map((r) => r.id), ["s1", "s5", "s2", "s3"]);
  const s1 = rows.find((r) => r.id === "s1");
  assert.equal(s1.contact, "555-1000"); // email absent -> phone
  assert.equal(s1.vendorNumber, null); // absent -> null (rendered as em dash by the workspace)
  assert.equal(rows.find((r) => r.id === "s3").contact, "Pat"); // -> contactName
  assert.equal(rows.find((r) => r.id === "s2").contact, "n@v.test"); // email wins
  assert.equal(rows.find((r) => r.id === "s5").status, null); // ungoverned
});

check("summarizeSuppliers: total/active/inactive/ungoverned by governed status", () => {
  const { summary } = buildSuppliersView(S);
  assert.equal(summary.total, 4); // malformed skipped
  assert.equal(summary.active, 2); // s1, s2
  assert.equal(summary.inactive, 1); // s3
  assert.equal(summary.ungoverned, 1); // s5 (no status)
});
check("summarizeSuppliers: non-array -> zeroed, never throws", () => {
  assert.deepEqual(summarizeSuppliers(undefined), { total: 0, active: 0, inactive: 0, ungoverned: 0 });
});

check("filters: All default; Active/Inactive/Ungoverned buckets; unknown -> All; counts match", () => {
  const { rows } = buildSuppliersView(S);
  assert.equal(DEFAULT_SUPPLIER_FILTER, "all");
  assert.equal(filterSuppliers(rows, "all").length, 4);
  assert.deepEqual(filterSuppliers(rows, "active").map((r) => r.id).sort(), ["s1", "s2"]);
  assert.deepEqual(filterSuppliers(rows, "inactive").map((r) => r.id), ["s3"]);
  assert.deepEqual(filterSuppliers(rows, "ungoverned").map((r) => r.id), ["s5"]);
  assert.equal(filterSuppliers(rows, "bogus").length, 4); // unknown -> All, never hides everything
  for (const f of SUPPLIER_FILTERS) assert.equal(countForSupplierFilter(rows, f.key), filterSuppliers(rows, f.key).length);
});

console.log(`\n${passed} passed, 0 failed`);
