// CUSTOMER 1 — physical consumption, end to end, against the Firestore emulator.
//
// Every earlier suite proves a piece in isolation. This one proves the thing that was actually
// broken: a technician records usage, and the stock stops being offered to someone else.
//
// receive 5 → consume 2 → on-hand 3, and Sales Order availability sees 3.
//
// Requires the Firestore emulator. Never touches production.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

if (admin.apps.length === 0) admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { updateWorkOrderExecutionData } = require("../lib/updateWorkOrderExecutionData.js");
const { sumLedgerEligibleOnHand } = require("../lib/fulfillment/fulfillmentAvailability.js");

const runId = Date.now();
let seq = 0;
// FILE-SCOPED ids. `runId` is Date.now(), and a sibling suite in the same `node --test` process uses
// the same scheme with its own counter — so two files starting in the same millisecond can mint the
// SAME document id and silently overwrite each other. That is exactly what happened in CI: this
// suite seeded fieldops_wos/WO-<ms>-1 with one part, the idempotency suite seeded the same id with
// another, and the second call reported "No planned part with sku A".
//
// The tag makes a cross-file collision impossible rather than merely unlikely.
const FILE_TAG = "pce";
const id = (p) => `${p}-${FILE_TAG}-${runId}-${(seq += 1)}`;
const callRequest = (data, uid) => ({ data, auth: { uid, token: {} }, rawRequest: {} });

async function seedTech(uid, technicianId) {
  await db.collection("users").doc(uid).set({ role: "technician", technicianId });
}
async function seedWorkOrder(woId, technicianId, snapshot) {
  await db.collection("fieldops_wos").doc(woId).set({
    id: woId, status: "WORK_IN_PROGRESS", assignedTechId: technicianId, inventorySnapshot: snapshot,
  });
}
async function seedWarehouse(warehouseId, name = "Test Warehouse") {
  await db.collection("warehouses").doc(warehouseId).set({ name, status: "ACTIVE" });
}
/** A governed physical receipt, exactly as receiving writes one. */
async function receive(partId, qty, warehouseId) {
  const key = id("recv");
  await db.collection("inventory_transactions").doc(key).set({
    type: "RECEIVED", partId, quantity: qty,
    location: { type: "WAREHOUSE", locationId: warehouseId },
    sourceObject: { type: "RECEIVING_ORDER", id: key },
    actor: { kind: "USER", id: "seed" }, occurredAt: runId,
    idempotencyKey: key, trackingMode: "NONE", schemaVersion: 2,
  });
}
async function transfer(partId, qty, fromWarehouseId, toMobileId) {
  for (const [type, location] of [
    ["TRANSFER_OUT", { type: "WAREHOUSE", locationId: fromWarehouseId }],
    ["TRANSFER_IN", { type: "MOBILE", locationId: toMobileId }],
  ]) {
    const key = id("xfer");
    await db.collection("inventory_transactions").doc(key).set({
      type, partId, quantity: qty, location,
      sourceObject: { type: "TRANSFER_ORDER", id: key },
      actor: { kind: "USER", id: "seed" }, occurredAt: runId,
      idempotencyKey: key, trackingMode: "NONE", schemaVersion: 2,
    });
  }
}
/** On-hand exactly as Sales Order availability derives it, from the same single ledger. */
async function onHandAt(partId, locationIds) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  const rows = snap.docs.map((d) => d.data());
  return sumLedgerEligibleOnHand(rows, new Set(locationIds));
}
/** Truck on-hand — MOBILE is invisible to the warehouse derivation, so it is summed per its own rules. */
async function mobileOnHand(partId, locationId) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  return snap.docs.map((d) => d.data())
    .filter((r) => r.location?.type === "MOBILE" && r.location?.locationId === locationId)
    .reduce((n, r) => {
      if (r.type === "TRANSFER_IN" || r.type === "RECEIVED" || r.type === "RETURNED") return n + r.quantity;
      if (r.type === "TRANSFER_OUT" || r.type === "SCRAPPED") return n - r.quantity;
      if (r.type === "ADJUSTED" || r.type === "WORK_ORDER_CONSUMPTION") return n + r.quantity;
      return n;
    }, 0);
}

// ══════════════════════════ THE CUSTOMER 1 PROOF ══════════════════════════

test("WAREHOUSE: receive 5, consume 2 → on-hand 3, and Sales Order availability sees 3", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh, "Phoenix Warehouse");
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  assert.equal(await onHandAt(part, [wh]), 5, "the defect's starting point");

  const r = await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId,
      qtyUsedUpdates: [{ sku: part, delta: 2 }],
      consumptionSources: [{ sku: part, locationId: wh }],
      idempotencyKey: id("k"),
    }, uid),
  );
  assert.equal(r.success, true);

  // THE DEFECT, CLOSED. Before this chain the answer here was 5.
  assert.equal(await onHandAt(part, [wh]), 3, "consumed stock left the shelf");
  const wo = (await db.collection("fieldops_wos").doc(woId).get()).data();
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 2, "and the usage was recorded");
});

test("a RETRY decrements once — usage and stock cannot drift apart", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  const req = callRequest({
    workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }],
    consumptionSources: [{ sku: part, locationId: wh }], idempotencyKey: id("k"),
  }, uid);
  await updateWorkOrderExecutionData.run(req);
  await updateWorkOrderExecutionData.run(req);
  assert.equal(await onHandAt(part, [wh]), 3, "3, not 1 — the retry replayed");
});

test("NO SOURCE: usage is refused, qtyUsed unchanged, and no movement is written", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);

  await assert.rejects(
    updateWorkOrderExecutionData.run(
      callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }], idempotencyKey: id("k") }, uid),
    ),
    (e) => /Select where this part came from/.test(e.message),
  );
  // Nothing moved, and nothing was recorded — a refusal is not a partial success.
  assert.equal(await onHandAt(part, [wh]), 5);
  const wo = (await db.collection("fieldops_wos").doc(woId).get()).data();
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 0, "qtyUsed unchanged");
});

test("MOBILE: consuming from the truck does NOT decrement the warehouse a second time", async () => {
  // The double-subtraction hazard, end to end. The transfer already took 3 off the shelf.
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh"), truckLoc = id("truckloc");
  const truckId = id("truck");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await db.collection("trucks").doc(truckId).set({
    truckId, locationId: truckLoc, status: "ACTIVE", assignedDriverEmployeeId: tech, displayLabel: "Truck 7",
  });
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  await transfer(part, 3, wh, truckLoc);
  assert.equal(await onHandAt(part, [wh]), 2, "the transfer decremented the warehouse once");
  assert.equal(await mobileOnHand(part, truckLoc), 3);

  await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }],
      consumptionSources: [{ sku: part, locationId: truckLoc }], idempotencyKey: id("k"),
    }, uid),
  );

  assert.equal(await onHandAt(part, [wh]), 2, "STILL 2 — never 0. Stock on the shelf was not erased.");
  assert.equal(await mobileOnHand(part, truckLoc), 1, "the truck went 3 → 1");
});

test("PICK DEFAULT: a placement resolves the source with no explicit selection", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  await db.collection("bin_placements").doc(id("place")).set({
    warehouseId: wh, partId: part, quantity: 5, pickedForWorkOrderId: woId, binCode: "STAGE-1",
  });
  // Pick itself moved nothing.
  assert.equal(await onHandAt(part, [wh]), 5);

  await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }], idempotencyKey: id("k") }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 3, "resolved from the pick, decremented once");
});

test("PICK AMBIGUITY: two warehouses refuse, and an explicit source then succeeds", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT");
  const whA = id("whA"), whB = id("whB");
  await seedWarehouse(whA, "Phoenix");
  await seedWarehouse(whB, "Tucson");
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, whA);
  await receive(part, 5, whB);
  for (const wh of [whA, whB]) {
    await db.collection("bin_placements").doc(id("place")).set({
      warehouseId: wh, partId: part, quantity: 5, pickedForWorkOrderId: woId, binCode: "STAGE",
    });
  }

  await assert.rejects(
    updateWorkOrderExecutionData.run(
      callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }], idempotencyKey: id("k") }, uid),
    ),
    (e) => /picked from more than one place/i.test(e.message),
    "never chooses the first",
  );

  await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }],
      consumptionSources: [{ sku: part, locationId: whB }], idempotencyKey: id("k2"),
    }, uid),
  );
  assert.equal(await onHandAt(part, [whB]), 3, "the chosen warehouse decremented");
  assert.equal(await onHandAt(part, [whA]), 5, "the other did not");
});

test("EXPLICIT OVERRIDES A PICK: picked at the warehouse, used off the truck", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh"), truckLoc = id("truckloc");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await db.collection("trucks").doc(id("truck")).set({
    locationId: truckLoc, status: "ACTIVE", assignedDriverEmployeeId: tech, displayLabel: "Truck 7",
  });
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  await transfer(part, 3, wh, truckLoc);
  const placementId = id("place");
  await db.collection("bin_placements").doc(placementId).set({
    warehouseId: wh, partId: part, quantity: 5, pickedForWorkOrderId: woId, binCode: "STAGE-1",
  });

  await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }],
      consumptionSources: [{ sku: part, locationId: truckLoc }], idempotencyKey: id("k"),
    }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 2, "the picked warehouse was NOT decremented");
  assert.equal(await mobileOnHand(part, truckLoc), 1, "the truck was");
  // The placement is history, not something the override rewrote.
  const placement = (await db.collection("bin_placements").doc(placementId).get()).data();
  assert.equal(placement.warehouseId, wh, "the pick record is preserved exactly");
});

test("CORRECTION: a decrement restores to the ORIGINAL source, once", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 5, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 2 }],
      consumptionSources: [{ sku: part, locationId: wh }], idempotencyKey: id("k"),
    }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 3);

  // No source is supplied, and none is needed — the reversal follows the original lineage.
  const correction = callRequest({
    workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: -1 }], idempotencyKey: id("c"),
  }, uid);
  await updateWorkOrderExecutionData.run(correction);
  assert.equal(await onHandAt(part, [wh]), 4, "1 restored to the warehouse it left");

  await updateWorkOrderExecutionData.run(correction);
  assert.equal(await onHandAt(part, [wh]), 4, "a retry does not restore twice");

  // Both events survive: history is additive, never rewritten.
  const rows = (await db.collection("inventory_transactions").where("partId", "==", part).get()).docs
    .map((d) => d.data()).filter((r) => r.type === "WORK_ORDER_CONSUMPTION");
  assert.equal(rows.length, 2, "the consumption and its correction both remain");
  assert.deepEqual(rows.map((r) => r.quantity).sort((a, b) => a - b), [-2, 1]);
});



test("a decrement is CAPPED at what was physically consumed — never more, never refused", async () => {
  // The distinction this proves: qtyUsed may have been recorded BEFORE this authority existed, so a
  // decrement can legitimately exceed the physical consumption on record. Refusing would make
  // pre-authority usage uneditable; capping reverses what exists and lets the rest be an ordinary
  // qtyUsed correction. The invariant that matters holds either way: stock is never conjured.
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 9, qtyUsed: 0 }]);
  await receive(part, 5, wh);
  await updateWorkOrderExecutionData.run(
    callRequest({
      workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: 1 }],
      consumptionSources: [{ sku: part, locationId: wh }], idempotencyKey: id("k"),
    }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 4, "1 consumed");

  await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: -5 }], idempotencyKey: id("c") }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 5, "restored exactly the 1 consumed — not 5");
  const wo = (await db.collection("fieldops_wos").doc(woId).get()).data();
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 0, "and qtyUsed floors at 0");
});

test("a decrement with NO physical consumption at all still corrects qtyUsed, moving no stock", async () => {
  // The pre-authority case in its pure form.
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), part = id("PRT"), wh = id("wh");
  await seedWarehouse(wh);
  await seedTech(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: part, partId: part, qtyPlanned: 9, qtyUsed: 3 }]);
  await receive(part, 5, wh);
  await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: part, delta: -1 }], idempotencyKey: id("c") }, uid),
  );
  assert.equal(await onHandAt(part, [wh]), 5, "no stock moved — there was no physical consumption to reverse");
  const wo = (await db.collection("fieldops_wos").doc(woId).get()).data();
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 2, "but the historical record was corrected");
});
