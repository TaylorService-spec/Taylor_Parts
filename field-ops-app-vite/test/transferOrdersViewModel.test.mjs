// Enterprise Inventory -- EI-P1c-2. Deterministic pure unit tests for the Operations
// Transfer-Orders view-model builder (src/modules/operations/transferOrdersViewModel.js).
// Input is a list of { docId, data } pairs (authoritative doc id kept separate from the
// stored data). Proves: legacy + generalized normalization via the merged adapter,
// WAREHOUSE label resolution (raw-id fallback, never fabricated), raw locationId for
// non-warehouse types, stored-id conflicts + other invalid records counted-not-rendered,
// deterministic order, purity.
//
// Run: node test/transferOrdersViewModel.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { buildTransferOrdersView } from "../src/modules/operations/transferOrdersViewModel.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const WAREHOUSES = [{ id: "WH-1", name: "Main Warehouse" }, { id: "WH-2", name: "Satellite" }];
// A { docId, data } pair.
const doc = (docId, data) => ({ docId, data });

ok("legacy record -> WAREHOUSE endpoints with resolved names, no quantity", () => {
  const { rows, hiddenInvalidCount } = buildTransferOrdersView(
    [doc("TO-1", { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", quantity: 9, status: "COMPLETED" })],
    WAREHOUSES,
  );
  assert.equal(hiddenInvalidCount, 0);
  assert.deepEqual(rows, [{
    transferOrderId: "TO-1", partId: "PART-1", status: "COMPLETED",
    origin: { type: "WAREHOUSE", locationId: "WH-1", label: "Main Warehouse" },
    destination: { type: "WAREHOUSE", locationId: "WH-2", label: "Satellite" },
  }]);
  assert.equal("quantity" in rows[0], false);
});

ok("generalized WAREHOUSE->MOBILE: warehouse name resolved; MOBILE keeps raw locationId", () => {
  const { rows } = buildTransferOrdersView(
    [doc("TO-2", { partId: "PART-1", origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "MOBILE", locationId: "TRUCK-7" }, status: "IN_TRANSIT" })],
    WAREHOUSES,
  );
  assert.deepEqual(rows[0].origin, { type: "WAREHOUSE", locationId: "WH-1", label: "Main Warehouse" });
  assert.deepEqual(rows[0].destination, { type: "MOBILE", locationId: "TRUCK-7", label: "TRUCK-7" });
});

ok("unknown warehouse id falls back to the raw id (never fabricated)", () => {
  const { rows } = buildTransferOrdersView(
    [doc("TO-3", { partId: "PART-1", fromWarehouseId: "WH-UNKNOWN", toWarehouseId: "WH-2", status: "REQUESTED" })],
    WAREHOUSES,
  );
  assert.equal(rows[0].origin.label, "WH-UNKNOWN");
});

ok("VENDOR/CUSTOMER/BIN types carry raw locationId + type preserved", () => {
  const { rows } = buildTransferOrdersView(
    [doc("TO-4", { partId: "PART-1", origin: { type: "VENDOR", locationId: "VEND-9" }, destination: { type: "CUSTOMER", locationId: "CUST-3" }, status: "REQUESTED" })],
    WAREHOUSES,
  );
  assert.deepEqual(rows[0].origin, { type: "VENDOR", locationId: "VEND-9", label: "VEND-9" });
  assert.deepEqual(rows[0].destination, { type: "CUSTOMER", locationId: "CUST-3", label: "CUST-3" });
});

ok("a conflicting stored data.id is hidden and counted (never overrides the doc id)", () => {
  const { rows, hiddenInvalidCount } = buildTransferOrdersView(
    [doc("REAL", { id: "OTHER", partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" })],
    WAREHOUSES,
  );
  assert.deepEqual(rows, []);
  assert.equal(hiddenInvalidCount, 1);
  // A matching stored id (or none) is fine and uses the authoritative doc id.
  assert.equal(buildTransferOrdersView([doc("REAL", { id: "REAL", partId: "P", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" })], WAREHOUSES).rows[0].transferOrderId, "REAL");
});

ok("invalid/contradictory records are counted, never rendered", () => {
  const { rows, hiddenInvalidCount } = buildTransferOrdersView(
    [
      doc("TO-VALID", { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }),
      doc("TO-BADSTATUS", { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "PENDING" }),
      doc("TO-VIRTUAL", { partId: "PART-1", origin: { type: "VIRTUAL", locationId: "V" }, destination: { type: "WAREHOUSE", locationId: "WH-2" }, status: "REQUESTED" }),
      doc("TO-SAME", { partId: "PART-1", origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "WAREHOUSE", locationId: "WH-1" }, status: "REQUESTED" }),
      doc("TO-INCOMPLETE", { partId: "PART-1", fromWarehouseId: "WH-1", status: "REQUESTED" }),
      doc("TO-DISAGREE", { partId: "PART-1", origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "MOBILE", locationId: "TRUCK-7" }, fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }),
      null,
      "nope",
      { docId: "", data: { partId: "P", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" } }, // empty docId -> invalid
    ],
    WAREHOUSES,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transferOrderId, "TO-VALID");
  assert.equal(hiddenInvalidCount, 8);
});

ok("empty / non-array input -> no rows, no hidden", () => {
  assert.deepEqual(buildTransferOrdersView([], WAREHOUSES), { rows: [], hiddenInvalidCount: 0 });
  assert.deepEqual(buildTransferOrdersView(undefined, WAREHOUSES), { rows: [], hiddenInvalidCount: 0 });
  assert.deepEqual(buildTransferOrdersView(null, null), { rows: [], hiddenInvalidCount: 0 });
});

ok("rows are sorted deterministically by transferOrderId", () => {
  const { rows } = buildTransferOrdersView(
    [
      doc("TO-3", { partId: "P", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }),
      doc("TO-1", { partId: "P", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }),
      doc("TO-2", { partId: "P", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }),
    ],
    WAREHOUSES,
  );
  assert.deepEqual(rows.map((r) => r.transferOrderId), ["TO-1", "TO-2", "TO-3"]);
});

ok("does not mutate inputs", () => {
  const docs = [doc("TO-1", { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" })];
  const warehouses = [{ id: "WH-1", name: "Main Warehouse" }, { id: "WH-2", name: "Satellite" }];
  const sd = structuredClone(docs), sw = structuredClone(warehouses);
  buildTransferOrdersView(docs, warehouses);
  assert.deepEqual(docs, sd);
  assert.deepEqual(warehouses, sw);
});

console.log(`\n${passed} passed`);
