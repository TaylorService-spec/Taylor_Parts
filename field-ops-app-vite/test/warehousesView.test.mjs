// Inventory > Warehouses -- OFFLINE tests for the pure registry view helpers (house
// check()/passed convention). No Firebase/network. NOTE ON ELIGIBILITY: the governed receiving
// service is authoritative (full §3A governed validation + status === "ACTIVE"); this client view
// reports the stored governed STATUS only. isWarehouseActiveStatus is therefore a STATUS-level
// signal (status === "ACTIVE"), NOT a re-implementation of the governed resolver -- these tests
// assert exactly that scoping, not parity with what Receiving ultimately admits.
import assert from "node:assert/strict";
import {
  WAREHOUSE_STATUSES,
  isWarehouseActiveStatus,
  buildWarehousesView,
  summarizeWarehouses,
  filterWarehouses,
  countForWarehouseFilter,
  warehouseStatusLabel,
  warehouseStatusTone,
  WAREHOUSE_FILTERS,
  DEFAULT_WAREHOUSE_FILTER,
} from "../src/domain/warehousesView.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("warehousesView.test.mjs");

check("status mirror = the two governed values; labels avoid raw casing", () => {
  assert.deepEqual([...WAREHOUSE_STATUSES], ["ACTIVE", "INACTIVE"]);
  assert.equal(warehouseStatusLabel("ACTIVE"), "Active");
  assert.equal(warehouseStatusLabel("INACTIVE"), "Inactive");
  assert.equal(warehouseStatusLabel(null), "Unknown");
  assert.equal(warehouseStatusTone("ACTIVE"), "done");
  assert.equal(warehouseStatusTone("weird"), "muted");
});

check("isWarehouseActiveStatus is a STATUS-level signal (status === ACTIVE), NOT existence-primary", () => {
  assert.equal(isWarehouseActiveStatus({ status: "ACTIVE" }), true);
  // no status -> NOT active-by-status (Receiving rejects it; we do not infer active from absence)
  assert.equal(isWarehouseActiveStatus({ id: "w1" }), false);
  assert.equal(isWarehouseActiveStatus({ status: "INACTIVE" }), false);
  // a legacy `active:true` alone does NOT make it active-by-status (status is the authority)
  assert.equal(isWarehouseActiveStatus({ active: true }), false);
  assert.equal(isWarehouseActiveStatus(null), false);
  assert.equal(isWarehouseActiveStatus("x"), false);
});

const W = [
  { id: "w2", name: "North Depot", status: "ACTIVE" },
  { id: "w1", name: "Central", status: "ACTIVE" },
  { id: "w3", name: "Old Yard", status: "INACTIVE" },
  { id: "w5", name: "Ungoverned Shed" }, // no status -> ungoverned
  { name: "no-id" }, // malformed -> skipped
];

check("buildWarehousesView: skips malformed, sorts by name, keeps stored status (null when absent)", () => {
  const { rows } = buildWarehousesView(W);
  // by name: Central(w1), North Depot(w2), Old Yard(w3), Ungoverned Shed(w5)
  assert.deepEqual(rows.map((r) => r.id), ["w1", "w2", "w3", "w5"]);
  assert.equal(rows.find((r) => r.id === "w5").status, null);
});

check("summarizeWarehouses: total/active/inactive/ungoverned by governed status", () => {
  const { summary } = buildWarehousesView(W);
  assert.equal(summary.total, 4); // malformed skipped
  assert.equal(summary.active, 2); // w1, w2
  assert.equal(summary.inactive, 1); // w3
  assert.equal(summary.ungoverned, 1); // w5 (no status)
});
check("summarizeWarehouses: non-array -> zeroed, never throws", () => {
  assert.deepEqual(summarizeWarehouses(undefined), { total: 0, active: 0, inactive: 0, ungoverned: 0 });
});

check("filters: All default; Active/Inactive by status; unknown -> All; counts match", () => {
  const { rows } = buildWarehousesView(W);
  assert.equal(DEFAULT_WAREHOUSE_FILTER, "all");
  assert.equal(filterWarehouses(rows, "all").length, 4);
  assert.deepEqual(filterWarehouses(rows, "active").map((r) => r.id).sort(), ["w1", "w2"]);
  assert.deepEqual(filterWarehouses(rows, "inactive").map((r) => r.id), ["w3"]);
  assert.equal(filterWarehouses(rows, "bogus").length, 4); // unknown -> All, never hides everything
  for (const f of WAREHOUSE_FILTERS) assert.equal(countForWarehouseFilter(rows, f.key), filterWarehouses(rows, f.key).length);
});


check("a warehouse with no name renders an em dash, never its document id", () => {
  // DECISIONS #106: a missing name is not permission to display a record id. This view is
  // currently unreferenced, which is exactly why the defect survived -- dead code with a live
  // defect is a trap for whoever picks it up next.
  const view = buildWarehousesView([{ id: "w9", status: "ACTIVE" }]);
  assert.equal(view.rows[0].name, "—");
  assert.equal(view.rows[0].id, "w9");
});

console.log(`\n${passed} passed, 0 failed`);
