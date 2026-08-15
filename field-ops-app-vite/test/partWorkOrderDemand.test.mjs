// Part -> Work Order Demand projection -- OFFLINE tests. The through-line: derive demand rows purely from
// the Work Order's own inventorySnapshot, never fabricate a quantity, suppress duplicates, and exclude
// terminal Work Orders (a finished/dead job no longer needs the part) while still counting the exclusion.
import assert from "node:assert/strict";
import { buildPartWorkOrderDemand } from "../src/domain/partWorkOrderDemand.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
console.log("partWorkOrderDemand.test.mjs");

check("one part needed by multiple Work Orders -> one row per Work Order", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [
      { id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 2 }] },
      { id: "wo2", status: "DISPATCHED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.workOrderId).sort(), ["wo1", "wo2"]);
});

check("planned but unused -> qtyUsed known 0, remaining == qtyPlanned", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 3, qtyUsed: 0 }] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qtyPlanned, 3);
  assert.equal(rows[0].qtyUsed, 0);
  assert.equal(rows[0].remaining, 3);
});

check("partial consumption -> remaining is mathematically derived, never negative", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "WORK_IN_PROGRESS", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 5, qtyUsed: 2 }] }],
  });
  assert.equal(rows[0].qtyPlanned, 5);
  assert.equal(rows[0].qtyUsed, 2);
  assert.equal(rows[0].remaining, 3);
});

check("over-consumption never yields a negative remaining", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "WORK_IN_PROGRESS", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 2, qtyUsed: 5 }] }],
  });
  assert.equal(rows[0].remaining, 0);
});

check("terminal Work Orders (COMPLETED/CLOSED/CANCELLED) are excluded from demand rows but counted", () => {
  const { rows, excludedTerminalCount } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [
      { id: "wo1", status: "COMPLETED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] },
      { id: "wo2", status: "CLOSED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] },
      { id: "wo3", status: "CANCELLED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] },
      { id: "wo4", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workOrderId, "wo4");
  assert.equal(excludedTerminalCount, 3);
});

check("duplicate Work Order ids in the input are suppressed to a single row", () => {
  const wo = { id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 2 }] };
  const { rows } = buildPartWorkOrderDemand({ partId: "P-1", workOrders: [wo, { ...wo }] });
  assert.equal(rows.length, 1);
});

check("multiple snapshot rows for the same part on one Work Order are summed, not duplicated", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [
      {
        id: "wo1",
        status: "SCHEDULED",
        inventorySnapshot: [
          { partId: "P-1", qtyPlanned: 2, qtyUsed: 1 },
          { partId: "P-1", qtyPlanned: 1, qtyUsed: 0 },
        ],
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qtyPlanned, 3);
  assert.equal(rows[0].qtyUsed, 1);
});

check("no-demand empty state: no Work Order carries this part -> empty rows, no fabricated match", () => {
  const { rows, excludedTerminalCount, malformedCount } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-2", qtyPlanned: 4 }] }],
  });
  assert.deepEqual(rows, []);
  assert.equal(excludedTerminalCount, 0);
  assert.equal(malformedCount, 0);
});

check("malformed snapshot rows do not crash and never fabricate a quantity", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [
      {
        id: "wo1",
        status: "SCHEDULED",
        inventorySnapshot: [null, "garbage", 42, { partId: "P-1" /* no qty fields at all */ }, { partId: "P-1", qtyPlanned: "two" }],
      },
    ],
  });
  assert.equal(rows.length, 1);
  // Neither qty field could be confirmed as a number anywhere in the snapshot -> both stay UNKNOWN (null),
  // never coerced to 0.
  assert.equal(rows[0].qtyPlanned, null);
  assert.equal(rows[0].qtyUsed, null);
  assert.equal(rows[0].remaining, null);
});

check("a malformed inventorySnapshot (not an array) is UNKNOWN for this Work Order, not a crash", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "SCHEDULED", inventorySnapshot: "not-an-array" }],
  });
  assert.deepEqual(rows, []);
});

check("rows lacking a canonical partId are never matched to this part (honest, not a guessed identity)", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [{ id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ sku: "SKU-1", qtyPlanned: 5 }] }],
  });
  assert.deepEqual(rows, []);
});

check("a malformed Work Order entry is skipped and counted, never throws", () => {
  const { rows, malformedCount } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [null, "garbage", { status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] } /* no id */],
  });
  assert.deepEqual(rows, []);
  assert.equal(malformedCount, 3); // null, the bare string, and the id-less object all fail to read as a Work Order
});

check("no partId argument -> empty result, not a scan of every Work Order", () => {
  const { rows } = buildPartWorkOrderDemand({ partId: null, workOrders: [{ id: "wo1", status: "SCHEDULED" }] });
  assert.deepEqual(rows, []);
});

check("carries woNumber/customer/site/scheduled-date context through when present on the Work Order", () => {
  const { rows } = buildPartWorkOrderDemand({
    partId: "P-1",
    workOrders: [
      {
        id: "wo1",
        woNumber: "WO-2026-000123",
        status: "SCHEDULED",
        customerId: "cust-1",
        locationId: "loc-1",
        scheduledStart: { toMillis: () => 1234 },
        inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }],
      },
    ],
  });
  assert.equal(rows[0].woNumber, "WO-2026-000123");
  assert.equal(rows[0].customerId, "cust-1");
  assert.equal(rows[0].locationId, "loc-1");
  assert.equal(rows[0].scheduledStart.toMillis(), 1234);
});

console.log(`${passed} passed`);
