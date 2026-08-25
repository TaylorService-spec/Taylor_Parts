import test from "node:test";
import assert from "node:assert/strict";
import { assembleWorkOrderReadinessContext } from "../lib/ai/workOrderReadinessContext.js";

const baseWorkOrder = {
  id: "raw-wo-id",
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "REPAIR",
  priority: "P2",
  assignedTechId: "tech-1",
  customerId: "customer-1",
  inventorySnapshot: [
    { partId: "part-1", name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2, qtyUsed: 0 },
    { partId: "part-2", name: "Seal Kit", sku: "S-100", qtyPlanned: 1, qtyUsed: 0 },
  ],
};

function balance(partId, available, state = "KNOWN") {
  const figure = state === "KNOWN"
    ? { state: "KNOWN", value: available }
    : { state, value: null };
  return {
    partId,
    onHand: figure,
    reserved: { state: "KNOWN", value: 0 },
    available: figure,
    onOrder: { state: "KNOWN", value: 0 },
    byLocation: [],
  };
}

function deps(overrides = {}) {
  const calls = { balances: 0, reservations: 0, reorders: 0 };
  const value = {
    calls,
    loadCaller: async () => ({ role: "dispatcher", technicianId: null }),
    loadWorkOrder: async () => ({ ...baseWorkOrder }),
    resolveInventoryBalanceAccess: async () => true,
    loadBalances: async () => {
      calls.balances += 1;
      return [balance("part-1", 5), balance("part-2", 0)];
    },
    loadReservationRows: async () => {
      calls.reservations += 1;
      return [
        { partId: "part-1", workOrderId: "raw-wo-id", type: "RESERVED", quantity: 1 },
        { partId: "part-1", workOrderId: "raw-wo-id", type: "CONSUMED", quantity: 1 },
        { partId: "part-2", workOrderId: "raw-wo-id", type: "RESERVED", quantity: 1 },
      ];
    },
    loadReorderRows: async () => {
      calls.reorders += 1;
      return [
        { partId: "part-2", workOrderId: "raw-wo-id", status: "PURCHASING_IN_PROGRESS" },
      ];
    },
    ...overrides,
  };
  return value;
}

test("dispatcher context joins governed balance, this-WO reservation and procurement evidence", async () => {
  const d = deps();
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    d,
  );

  assert.equal(result.subject.reference, "WO-2026-000873");
  assert.deepEqual(result.capabilities, { warehouse: true, truckInventory: false, purchasing: true });
  assert.equal(result.plannedParts.length, 2);
  assert.deepEqual(result.plannedParts[0], {
    name: "Scraper Blade Kit",
    sku: "X49463-3",
    qtyPlanned: 2,
    qtyUsed: 0,
    reservedForJob: 0,
    warehouse: { status: "KNOWN", available: 5 },
    truck: { status: "UNAVAILABLE" },
    procurement: { status: "NONE" },
  });
  assert.equal(result.plannedParts[1].reservedForJob, 1);
  assert.deepEqual(result.plannedParts[1].warehouse, { status: "KNOWN", available: 0 });
  assert.deepEqual(result.plannedParts[1].procurement, { status: "PENDING" });
  assert.deepEqual(result.limitations, ["TRUCK_INVENTORY_UNAVAILABLE"]);
  assert.equal(d.calls.balances, 1);
  assert.equal(d.calls.reservations, 1);
  assert.equal(d.calls.reorders, 1);
});

test("inventory balance denial does not read balance or reservation sources and returns unavailable warehouse", async () => {
  const d = deps({ resolveInventoryBalanceAccess: async () => false });
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    d,
  );

  assert.equal(result.capabilities.warehouse, false);
  assert.equal(d.calls.balances, 0);
  assert.equal(d.calls.reservations, 0);
  assert.deepEqual(result.plannedParts[0].warehouse, { status: "UNAVAILABLE" });
  assert.equal(result.plannedParts[0].reservedForJob, 0);
  assert.ok(result.limitations.includes("INVENTORY_BALANCE_NOT_AUTHORIZED"));
});

test("technician own-WO read does not widen procurement authority", async () => {
  const d = deps({
    loadCaller: async () => ({ role: "technician", technicianId: "tech-1" }),
  });
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    d,
  );

  assert.equal(result.capabilities.purchasing, false);
  assert.equal(d.calls.reorders, 0);
  assert.deepEqual(result.plannedParts[1].procurement, { status: "NONE" });
  assert.ok(result.limitations.includes("PROCUREMENT_READ_NOT_AUTHORIZED"));
});

test("technician cannot assemble another technician's Work Order", async () => {
  const d = deps({
    loadCaller: async () => ({ role: "technician", technicianId: "tech-2" }),
  });
  await assert.rejects(
    assembleWorkOrderReadinessContext(
      { principalUid: "user-1", workOrderId: "raw-wo-id" },
      d,
    ),
    (err) => err?.code === "AI_CAPABILITY_DENIED",
  );
  assert.equal(d.calls.balances, 0);
  assert.equal(d.calls.reservations, 0);
  assert.equal(d.calls.reorders, 0);
});

test("unknown or serialized quantity balance remains UNKNOWN, never zero", async () => {
  const d = deps({
    loadBalances: async () => [
      balance("part-1", null, "UNKNOWN"),
      balance("part-2", null, "NOT_COUNTED_BY_QUANTITY"),
    ],
  });
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    d,
  );
  assert.deepEqual(result.plannedParts[0].warehouse, { status: "UNKNOWN" });
  assert.deepEqual(result.plannedParts[1].warehouse, { status: "UNKNOWN" });
});

test("output never exposes internal Work Order, customer or part ids", async () => {
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    deps(),
  );
  const encoded = JSON.stringify(result);
  for (const raw of ["raw-wo-id", "customer-1", "part-1", "part-2", "tech-1"]) {
    assert.doesNotMatch(encoded, new RegExp(raw));
  }
});

test("capability resolver failure degrades warehouse instead of widening access", async () => {
  const d = deps({ resolveInventoryBalanceAccess: async () => { throw new Error("resolver unavailable"); } });
  const result = await assembleWorkOrderReadinessContext(
    { principalUid: "user-1", workOrderId: "raw-wo-id" },
    d,
  );
  assert.equal(result.capabilities.warehouse, false);
  assert.equal(d.calls.balances, 0);
  assert.equal(d.calls.reservations, 0);
});
