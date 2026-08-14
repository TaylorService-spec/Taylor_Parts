// Emulator integration test for the updateWorkOrderExecutionData idempotency guard (Track A / stress-run #1).
//
// Same harness as functions/test/completeAssignedJob.test.js: the compiled onCall handler is invoked directly
// via `.run(request)` with a fabricated `request.auth`, against a LIVE Firestore emulator. Proves the core
// invariant the pure workOrderExecutionMath.test.mjs cannot (it is I/O): a retry carrying the SAME
// idempotencyKey is a no-op replay -- the additive qtyUsed delta and the arrayUnion execution-log append are
// each applied exactly once.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/updateWorkOrderExecutionDataIdempotency.test.js
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { updateWorkOrderExecutionData } = require("../lib/updateWorkOrderExecutionData.js");

const USERS = "users";
const WOS = "fieldops_wos";
const AUDIT = "auditEvents";

let counter = 0;
const id = (label) => `${label}-${Date.now()}-${(counter += 1)}`;

function callRequest(data, uid) {
  return { data, auth: uid !== undefined ? { uid, token: {} } : undefined };
}

async function seedTechUser(uid, technicianId) {
  await db.collection(USERS).doc(uid).set({ role: "technician", technicianId });
}
async function seedWorkOrder(woId, technicianId, snapshot) {
  await db.collection(WOS).doc(woId).set({
    woNumber: woId,
    status: "IN_PROGRESS",
    assignedTechId: technicianId,
    inventorySnapshot: snapshot,
  });
}
const readWO = async (woId) => (await db.collection(WOS).doc(woId).get()).data();

test("same idempotencyKey twice -> qtyUsed applied ONCE and replayed:true on the retry", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), key = id("key");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);

  const first = await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1 }], idempotencyKey: key }, uid),
  );
  assert.equal(first.success, true);
  assert.notEqual(first.replayed, true, "first application is not a replay");
  assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 1);

  const retry = await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1 }], idempotencyKey: key }, uid),
  );
  assert.equal(retry.replayed, true, "retry with same key is a no-op replay");
  assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 1, "qtyUsed must NOT double-count on retry");
});

test("same idempotencyKey twice -> executionLog appended exactly once", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO"), key = id("key");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);

  await updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "did the thing", idempotencyKey: key }, uid));
  await updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "did the thing", idempotencyKey: key }, uid));
  const log = (await readWO(woId)).executionLog || [];
  assert.equal(log.length, 1, "one durable log entry, not a duplicate per retry");
});

test("a DIFFERENT idempotencyKey applies again (distinct logical operations are not collapsed)", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);

  await updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1 }], idempotencyKey: id("k") }, uid));
  await updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1 }], idempotencyKey: id("k") }, uid));
  assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 2);
});

test("keyless legacy call still applies (deploy-safe) and writes no idempotency marker", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);

  const r = await updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1 }] }, uid));
  assert.equal(r.success, true);
  assert.notEqual(r.replayed, true);
  assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 1);
  const markers = await db.collection(AUDIT).where("action", "==", "updateWorkOrderExecutionData").where("targetId", "==", woId).get();
  assert.equal(markers.size, 0, "no key -> no audit/idempotency marker (legacy behavior preserved)");
});

test("empty idempotencyKey is rejected (would collapse distinct calls to one marker)", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);
  await assert.rejects(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "x", idempotencyKey: "   " }, uid)),
    (err) => err.code === "invalid-argument",
  );
});

for (const badDelta of [NaN, Infinity, -Infinity]) {
  test(`non-finite delta (${String(badDelta)}) is rejected with invalid-argument`, async () => {
    const uid = id("uid"), tech = id("tech"), woId = id("WO");
    await seedTechUser(uid, tech);
    await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 0 }]);
    await assert.rejects(
      updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: badDelta }] }, uid)),
      (err) => err.code === "invalid-argument",
    );
    assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 0, "rejected call must not have written qtyUsed");
  });
}

test("a delta that would exceed qtyPlanned is clamped, not persisted unbounded", async () => {
  const uid = id("uid"), tech = id("tech"), woId = id("WO");
  await seedTechUser(uid, tech);
  await seedWorkOrder(woId, tech, [{ sku: "A", qtyUsed: 8, qtyPlanned: 10 }]);

  const r = await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "A", delta: 1000 }] }, uid),
  );
  assert.equal(r.success, true);
  assert.equal((await readWO(woId)).inventorySnapshot[0].qtyUsed, 10, "qtyUsed must clamp at qtyPlanned (10), never persist unbounded");
});

for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
  test(`terminal ${status} Work Order rejects execution-data writes`, async () => {
    const uid = id("uid"), tech = id("tech"), woId = id("WO");
    await seedTechUser(uid, tech);
    await db.collection(WOS).doc(woId).set({ woNumber: woId, status, assignedTechId: tech, inventorySnapshot: [{ sku: "A", qtyUsed: 0 }] });
    await assert.rejects(
      updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "late edit" }, uid)),
      (err) => err.code === "failed-precondition",
    );
  });
}
