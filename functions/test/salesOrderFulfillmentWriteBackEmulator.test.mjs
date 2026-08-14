// P1.1 (Sales->Cash fulfillment spine) -- EMULATOR regression for transitionWorkOrder.ts's Complete-action
// write-back to a linked Sales Order's `lines[].fulfilledQty`. Unlike createServiceForSalesOrder (gated by
// the still-inactive `salesOrder.service` capability), transitionWorkOrder's Complete action is ROLE-gated
// (technician + own-assignment, via ACTION_PERMISSIONS in transitionEngine.ts) -- no capability activation
// needed, so this exercises the real, deployed-shape onCall handler end-to-end, same harness as
// functions/test/transitionWorkOrderConcurrency.test.mjs: the compiled onCall handler is invoked directly via
// `.run(request)` against a live Firestore emulator.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts (this session: port 8201, see
//   firebase.json's temporary override)
//   (after `npm run build`) node --test test/salesOrderFulfillmentWriteBackEmulator.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8201";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { transitionWorkOrder } = await import("../lib/transitionWorkOrder.js");

const WOS = "fieldops_wos";
const SOS = "sales_orders";
const USERS = "users";
const AUDIT = "auditEvents";

let counter = 0;
function id(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

function callRequest(data, uid) {
  return { data, auth: uid !== undefined ? { uid, token: {} } : undefined };
}

async function seedTechnician(uid, technicianId) {
  await db.collection(USERS).doc(uid).set({ role: "technician", technicianId });
}

async function seedWorkOrder(woId, fields) {
  await db.collection(WOS).doc(woId).set({ id: woId, ...fields });
}

async function seedSalesOrder(soId, fields) {
  await db.collection(SOS).doc(soId).set({ id: soId, ...fields });
}

test("Complete on an SO-linked WO keys PART fulfillment by partId rather than sku and auto-advances when fully fulfilled", async () => {
  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);

  const soId = id("so");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [
      { kind: "PART", ref: "P-1", orderedQty: 4, allocatedQty: 4, fulfilledQty: 0 },
    ],
  });

  const woId = id("wo");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    salesOrderId: soId,
    inventorySnapshot: [
      { sku: "IPN-1", partId: "P-1", qtyPlanned: 6, qtyUsed: 4 },
    ],
  });

  const result = await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  assert.equal(result.status, "COMPLETED");

  const soSnap = await db.collection(SOS).doc(soId).get();
  const partLine = soSnap.data().lines.find((l) => l.kind === "PART" && l.ref === "P-1");
  assert.equal(partLine.fulfilledQty, 4, "PART line fulfilledQty accumulates against partId, not sku");
  assert.equal(soSnap.data().state, "FULFILLED", "a fully fulfilled IN_FULFILLMENT Sales Order auto-advances");

  // Traceability: a salesOrderFulfillmentWriteBack Audit Event was staged (not the idempotency gate).
  const auditSnap = await db.collection(AUDIT).where("action", "==", "salesOrderFulfillmentWriteBack").where("targetId", "==", soId).get();
  assert.equal(auditSnap.empty, false, "an Audit Event must be staged for the write-back");
});

test("Complete accepts qtyPlanned as PART fulfillment when the tech recorded no qtyUsed (missing-part-stall fix)", async () => {
  // Owner-ratified Option A: reaching Complete -- a role-gated, terminal, governed transition -- IS the
  // governed act that accepts planned usage as actual unless the tech recorded otherwise. Without this,
  // consumeParts (inventoryService.ts) still consumes qtyUsed ?? qtyPlanned from inventory, but the SO
  // write-back credited zero fulfilledQty, wedging the Sales Order in IN_FULFILLMENT forever with no way
  // to backfill usage after a terminal Complete.
  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);

  const soId = id("so-planned");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [{ kind: "PART", ref: "P-PLANNED", orderedQty: 3, allocatedQty: 3, fulfilledQty: 0 }],
  });

  const woId = id("wo-planned");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-PLANNED", partId: "P-PLANNED", qtyPlanned: 3 }],
  });

  await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  const soSnap = await db.collection(SOS).doc(soId).get();
  assert.equal(soSnap.data().lines[0].fulfilledQty, 3, "completion accepts qtyPlanned as actual when qtyUsed was never recorded");
  assert.equal(soSnap.data().state, "FULFILLED", "allLinesFulfilled auto-advances the SO");
});

test("Complete honors a recorded qtyUsed over qtyPlanned for PART fulfillment", async () => {
  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);

  const soId = id("so-recorded");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [{ kind: "PART", ref: "P-RECORDED", orderedQty: 5, allocatedQty: 5, fulfilledQty: 0 }],
  });

  const woId = id("wo-recorded");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-RECORDED", partId: "P-RECORDED", qtyPlanned: 5, qtyUsed: 2 }],
  });

  await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  const soSnap = await db.collection(SOS).doc(soId).get();
  assert.equal(soSnap.data().lines[0].fulfilledQty, 2, "a recorded qtyUsed overrides qtyPlanned even though it is lower");
  assert.equal(soSnap.data().state, "IN_FULFILLMENT", "not all lines fulfilled -- no auto-advance");
});

test("Complete accumulates additively across two separate Work Orders on the SAME Sales Order line", async () => {
  const soId = id("so-multi");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [{ kind: "PART", ref: "P-2", orderedQty: 10, allocatedQty: 10, fulfilledQty: 0 }],
  });

  const tech1Uid = id("u-tech");
  const tech1Id = id("tech");
  await seedTechnician(tech1Uid, tech1Id);
  const wo1Id = id("wo");
  await seedWorkOrder(wo1Id, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: tech1Id,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-2", partId: "P-2", qtyUsed: 3 }],
  });
  await transitionWorkOrder.run(callRequest({ workOrderId: wo1Id, action: "Complete" }, tech1Uid));

  const tech2Uid = id("u-tech");
  const tech2Id = id("tech");
  await seedTechnician(tech2Uid, tech2Id);
  const wo2Id = id("wo");
  await seedWorkOrder(wo2Id, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: tech2Id,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-2", partId: "P-2", qtyUsed: 2 }],
  });
  await transitionWorkOrder.run(callRequest({ workOrderId: wo2Id, action: "Complete" }, tech2Uid));

  const soSnap = await db.collection(SOS).doc(soId).get();
  const line = soSnap.data().lines.find((l) => l.ref === "P-2");
  assert.equal(line.fulfilledQty, 5, "3 + 2 additive across two Work Orders, never overwritten");
});

test("explicit fulfillmentAccepted cannot override governed PART usage", async () => {
  const soId = id("so-override");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [{ kind: "PART", ref: "P-3", orderedQty: 10, allocatedQty: 5, fulfilledQty: 0 }],
  });

  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);
  const woId = id("wo");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-3", partId: "P-3", qtyUsed: 4 }], // derived value would be 4
  });

  await assert.rejects(
    transitionWorkOrder.run(
    callRequest(
      { workOrderId: woId, action: "Complete", fulfillmentAccepted: [{ ref: "P-3", kind: "PART", qty: 5 }] },
      techUid
    )
    ),
    (err) => err.code === "invalid-argument",
  );

  const soSnap = await db.collection(SOS).doc(soId).get();
  const line = soSnap.data().lines.find((l) => l.ref === "P-3");
  assert.equal(line.fulfilledQty, 0, "rejected client PART acceptance cannot write fulfillment");
});

test("explicit SERVICE acceptance remains functional", async () => {
  const soId = id("so-service");
  await seedSalesOrder(soId, { state: "IN_FULFILLMENT", lines: [{ kind: "SERVICE", ref: "SVC-1", orderedQty: 1, fulfilledQty: 0 }] });
  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);
  const woId = id("wo-service");
  await seedWorkOrder(woId, { status: "WORK_IN_PROGRESS", assignedTechId: techId, salesOrderId: soId });
  await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete", fulfillmentAccepted: [{ kind: "SERVICE", ref: "SVC-1", qty: 1 }] }, techUid));
  const soSnap = await db.collection(SOS).doc(soId).get();
  assert.equal(soSnap.data().lines[0].fulfilledQty, 1);
  assert.equal(soSnap.data().state, "FULFILLED");
});

test("Complete on a NON-SO-linked WO writes no sales_orders doc (fully no-op)", async () => {
  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);

  const woId = id("wo-standalone");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    inventorySnapshot: [{ sku: "IPN-9", qtyUsed: 1 }],
    // no salesOrderId
  });

  const auditBefore = await db.collection(AUDIT).where("action", "==", "salesOrderFulfillmentWriteBack").get();
  const result = await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  assert.equal(result.status, "COMPLETED");

  const auditAfter = await db.collection(AUDIT).where("action", "==", "salesOrderFulfillmentWriteBack").get();
  assert.equal(auditAfter.size, auditBefore.size, "no write-back Audit Event for a non-SO-linked Work Order");
});

test("retry Complete on an already-COMPLETED WO -> failed-precondition, fulfilledQty unchanged", async () => {
  const soId = id("so-retry");
  await seedSalesOrder(soId, {
    state: "IN_FULFILLMENT",
    lines: [{ kind: "PART", ref: "P-4", orderedQty: 10, allocatedQty: 5, fulfilledQty: 0 }],
  });

  const techUid = id("u-tech");
  const techId = id("tech");
  await seedTechnician(techUid, techId);
  const woId = id("wo-retry");
  await seedWorkOrder(woId, {
    status: "WORK_IN_PROGRESS",
    assignedTechId: techId,
    salesOrderId: soId,
    inventorySnapshot: [{ sku: "IPN-4", partId: "P-4", qtyUsed: 4 }],
  });

  await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  const soAfterFirst = await db.collection(SOS).doc(soId).get();
  assert.equal(soAfterFirst.data().lines.find((l) => l.ref === "P-4").fulfilledQty, 4);

  await assert.rejects(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid)),
    (err) => {
      assert.equal(err.code, "failed-precondition");
      return true;
    }
  );

  const soAfterRetry = await db.collection(SOS).doc(soId).get();
  assert.equal(
    soAfterRetry.data().lines.find((l) => l.ref === "P-4").fulfilledQty,
    4,
    "fulfilledQty must NOT change on a rejected retry"
  );
});
