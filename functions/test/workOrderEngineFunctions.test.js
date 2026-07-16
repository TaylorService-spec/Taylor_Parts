// Issue #15 production-readiness closeout, part 2 -- integration tests
// proving the three Work Order Engine v1.2 Cloud Functions
// (createWorkOrder.ts/transitionWorkOrder.ts/updateWorkOrderExecutionData.ts)
// genuinely behave as documented in
// docs/deployment/issue-15-work-order-engine-deployment-manifest.md,
// against a live Firestore + Auth emulator. Confirmed gap this file
// closes: zero automated tests existed anywhere for these three
// Functions or their shared dependencies (callerContext.ts,
// woNumbering.ts, transitionEngine.ts -- transitionEngine.ts's own pure
// logic is separately covered by transitionEngine.test.mjs, no emulator
// needed there).
//
// Same pattern as functions/test/accessCommandCallables.test.js: each
// compiled onCall handler is invoked directly via its own `.run(request)`
// method (the standard way to unit-test a firebase-functions v2 onCall
// function without the HTTP layer), imported directly from its own
// compiled module (never via lib/index.js, which calls initializeApp()
// itself and would collide with this file's own admin.initializeApp()
// call below).
//
// Prerequisite: run against live Firestore + Auth emulators, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node --test test/workOrderEngineFunctions.test.js
//
// Never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { createWorkOrder } = require("../lib/createWorkOrder.js");
const { transitionWorkOrder } = require("../lib/transitionWorkOrder.js");
const { updateWorkOrderExecutionData } = require("../lib/updateWorkOrderExecutionData.js");

let uidCounter = 0;
function uid(label) {
  uidCounter += 1;
  return `${label}-${Date.now()}-${uidCounter}`;
}

function callRequest(data, authUid) {
  return { data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined };
}

async function assertHttpsErrorCode(promise, expectedCode) {
  try {
    await promise;
    assert.fail(`expected an HttpsError with code "${expectedCode}", but no error was thrown`);
  } catch (err) {
    assert.equal(err.code, expectedCode, `expected code "${expectedCode}", got "${err.code}": ${err.message}`);
    return err;
  }
}

async function seedUser(userUid, role, extra = {}) {
  await db.collection("users").doc(userUid).set({ role, ...extra });
}

async function seedWorkOrder(id, fields) {
  await db.collection("fieldops_wos").doc(id).set({
    woNumber: "WO-2026-000000",
    status: "CREATED",
    priority: 2,
    customerId: "cust-1",
    locationId: "loc-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...fields,
  });
}

// ===================== createWorkOrder =====================

test("createWorkOrder: unauthenticated call is rejected", async () => {
  await assertHttpsErrorCode(
    createWorkOrder.run(callRequest({ customerId: "c1", locationId: "l1", priority: 2, type: "SERVICE_CALL" }, undefined)),
    "unauthenticated",
  );
});

test("createWorkOrder: technician role is rejected (admin/dispatcher only)", async () => {
  const techUid = uid("cwo-tech");
  await seedUser(techUid, "technician", { technicianId: "tech-cwo-1" });
  await assertHttpsErrorCode(
    createWorkOrder.run(callRequest({ customerId: "c1", locationId: "l1", priority: 2, type: "SERVICE_CALL" }, techUid)),
    "permission-denied",
  );
});

test("createWorkOrder: missing customerId is rejected", async () => {
  const adminUid = uid("cwo-admin-missing-cust");
  await seedUser(adminUid, "admin");
  await assertHttpsErrorCode(
    createWorkOrder.run(callRequest({ locationId: "l1", priority: 2, type: "SERVICE_CALL" }, adminUid)),
    "invalid-argument",
  );
});

test("createWorkOrder: invalid priority is rejected", async () => {
  const adminUid = uid("cwo-admin-bad-priority");
  await seedUser(adminUid, "admin");
  await assertHttpsErrorCode(
    createWorkOrder.run(callRequest({ customerId: "c1", locationId: "l1", priority: 9, type: "SERVICE_CALL" }, adminUid)),
    "invalid-argument",
  );
});

test("createWorkOrder: neither type nor complaint is rejected", async () => {
  const adminUid = uid("cwo-admin-no-type-or-complaint");
  await seedUser(adminUid, "admin");
  await assertHttpsErrorCode(
    createWorkOrder.run(callRequest({ customerId: "c1", locationId: "l1", priority: 2 }, adminUid)),
    "invalid-argument",
  );
});

test("createWorkOrder: admin creates a real fieldops_wos doc with a WO-YYYY-###### number, and the year counter increments", async () => {
  const adminUid = uid("cwo-admin-happy");
  await seedUser(adminUid, "admin");
  const year = new Date().getFullYear();
  const counterBefore = await db.collection("counters").doc(`work_orders_${year}`).get();
  const seqBefore = counterBefore.exists ? counterBefore.data().sequence : 0;

  const result = await createWorkOrder.run(
    callRequest({ customerId: "c1", locationId: "l1", priority: 1, type: "SERVICE_CALL" }, adminUid),
  );
  assert.ok(result.id);
  assert.match(result.woNumber, new RegExp(`^WO-${year}-\\d{6}$`));

  const woSnap = await db.collection("fieldops_wos").doc(result.id).get();
  assert.ok(woSnap.exists);
  assert.equal(woSnap.data().status, "CREATED");
  assert.equal(woSnap.data().customerId, "c1");

  const counterAfter = await db.collection("counters").doc(`work_orders_${year}`).get();
  assert.equal(counterAfter.data().sequence, seqBefore + 1);
});

test("createWorkOrder: dispatcher may also create (not admin-only)", async () => {
  const dispatcherUid = uid("cwo-dispatcher");
  await seedUser(dispatcherUid, "dispatcher");
  const result = await createWorkOrder.run(
    callRequest({ customerId: "c1", locationId: "l1", priority: 3, complaint: "Leaking" }, dispatcherUid),
  );
  assert.ok(result.id);
});

// ===================== transitionWorkOrder =====================

test("transitionWorkOrder: unauthenticated call is rejected", async () => {
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: "wo-x", action: "MarkReady" }, undefined)),
    "unauthenticated",
  );
});

test("transitionWorkOrder: unknown action is rejected", async () => {
  const adminUid = uid("two-admin-unknown-action");
  await seedUser(adminUid, "admin");
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: "wo-x", action: "TeleportToMoon" }, adminUid)),
    "invalid-argument",
  );
});

test("transitionWorkOrder: nonexistent Work Order is rejected with not-found", async () => {
  const adminUid = uid("two-admin-not-found");
  await seedUser(adminUid, "admin");
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: "does-not-exist", action: "MarkReady" }, adminUid)),
    "not-found",
  );
});

test("transitionWorkOrder: invalid transition (skipping ahead) is rejected with failed-precondition", async () => {
  const adminUid = uid("two-admin-invalid-transition");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-invalid-transition");
  await seedWorkOrder(woId, { status: "CREATED" });
  // Close is only valid from COMPLETED, not CREATED.
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Close" }, adminUid)),
    "failed-precondition",
  );
});

test("transitionWorkOrder: technician cannot perform an admin/dispatcher-only action (role gate)", async () => {
  const techUid = uid("two-tech-role-gate");
  await seedUser(techUid, "technician", { technicianId: "tech-two-1" });
  const woId = uid("wo-role-gate");
  await seedWorkOrder(woId, { status: "CREATED" });
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "MarkReady" }, techUid)),
    "permission-denied",
  );
});

test("transitionWorkOrder: technician not assigned to this Work Order cannot Accept it (ownership gate)", async () => {
  const techUid = uid("two-tech-not-assigned");
  await seedUser(techUid, "technician", { technicianId: "tech-two-2" });
  const woId = uid("wo-not-assigned");
  await seedWorkOrder(woId, { status: "DISPATCHED", assignedTechId: "tech-two-someone-else" });
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Accept" }, techUid)),
    "permission-denied",
  );
});

test("transitionWorkOrder: Schedule without required fields is rejected", async () => {
  const adminUid = uid("two-admin-schedule-missing");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-schedule-missing");
  await seedWorkOrder(woId, { status: "READY_TO_DISPATCH" });
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Schedule" }, adminUid)),
    "invalid-argument",
  );
});

test("transitionWorkOrder: Dispatch without assignedTechId is rejected", async () => {
  const adminUid = uid("two-admin-dispatch-missing");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-dispatch-missing");
  await seedWorkOrder(woId, { status: "SCHEDULED" });
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Dispatch" }, adminUid)),
    "invalid-argument",
  );
});

test("transitionWorkOrder: admin MarkReady succeeds, status becomes READY_TO_DISPATCH", async () => {
  const adminUid = uid("two-admin-markready-happy");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-markready-happy");
  await seedWorkOrder(woId, { status: "CREATED" });
  const result = await transitionWorkOrder.run(
    callRequest({ workOrderId: woId, action: "MarkReady" }, adminUid),
  );
  assert.equal(result.status, "READY_TO_DISPATCH");
  const snap = await db.collection("fieldops_wos").doc(woId).get();
  assert.equal(snap.data().status, "READY_TO_DISPATCH");
});

test("transitionWorkOrder: admin Dispatch succeeds, sets assignedTechId and dispatchedAt", async () => {
  const adminUid = uid("two-admin-dispatch-happy");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-dispatch-happy");
  await seedWorkOrder(woId, { status: "SCHEDULED" });
  const result = await transitionWorkOrder.run(
    callRequest({ workOrderId: woId, action: "Dispatch", assignedTechId: "tech-dispatch-target" }, adminUid),
  );
  assert.equal(result.status, "DISPATCHED");
  const snap = await db.collection("fieldops_wos").doc(woId).get();
  assert.equal(snap.data().assignedTechId, "tech-dispatch-target");
  assert.ok(snap.data().dispatchedAt);
});

test("transitionWorkOrder: assigned technician Accept succeeds", async () => {
  const techUid = uid("two-tech-accept-happy");
  await seedUser(techUid, "technician", { technicianId: "tech-accept-happy" });
  const woId = uid("wo-accept-happy");
  await seedWorkOrder(woId, { status: "DISPATCHED", assignedTechId: "tech-accept-happy" });
  const result = await transitionWorkOrder.run(
    callRequest({ workOrderId: woId, action: "Accept" }, techUid),
  );
  assert.equal(result.status, "ACCEPTED");
});

test("transitionWorkOrder: COMPLETED cannot be Cancelled (spec: not cancellable once complete)", async () => {
  const adminUid = uid("two-admin-cancel-completed");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-cancel-completed");
  await seedWorkOrder(woId, { status: "COMPLETED" });
  await assertHttpsErrorCode(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Cancel" }, adminUid)),
    "failed-precondition",
  );
});

// ===================== updateWorkOrderExecutionData =====================

test("updateWorkOrderExecutionData: unauthenticated call is rejected", async () => {
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: "wo-x", executionNote: "note" }, undefined)),
    "unauthenticated",
  );
});

test("updateWorkOrderExecutionData: missing workOrderId is rejected", async () => {
  const techUid = uid("uwoed-missing-woid");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-1" });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ executionNote: "note" }, techUid)),
    "invalid-argument",
  );
});

test("updateWorkOrderExecutionData: neither qtyUsedUpdates nor executionNote is rejected", async () => {
  const techUid = uid("uwoed-neither");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-2" });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: "wo-x" }, techUid)),
    "invalid-argument",
  );
});

test("updateWorkOrderExecutionData: non-technician role is rejected", async () => {
  const adminUid = uid("uwoed-admin-rejected");
  await seedUser(adminUid, "admin");
  const woId = uid("wo-uwoed-admin");
  await seedWorkOrder(woId, { assignedTechId: "tech-someone" });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "note" }, adminUid)),
    "permission-denied",
  );
});

test("updateWorkOrderExecutionData: technician with no technicianId mapping is rejected", async () => {
  const techUid = uid("uwoed-no-mapping");
  await seedUser(techUid, "technician");
  const woId = uid("wo-uwoed-no-mapping");
  await seedWorkOrder(woId, { assignedTechId: "tech-someone" });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "note" }, techUid)),
    "failed-precondition",
  );
});

test("updateWorkOrderExecutionData: technician not assigned to this Work Order is rejected (ownership gate)", async () => {
  const techUid = uid("uwoed-not-assigned");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-not-assigned" });
  const woId = uid("wo-uwoed-not-assigned");
  await seedWorkOrder(woId, { assignedTechId: "tech-uwoed-someone-else" });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(callRequest({ workOrderId: woId, executionNote: "note" }, techUid)),
    "permission-denied",
  );
});

test("updateWorkOrderExecutionData: assigned technician appends an executionLog entry", async () => {
  const techUid = uid("uwoed-note-happy");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-note-happy" });
  const woId = uid("wo-uwoed-note-happy");
  await seedWorkOrder(woId, { assignedTechId: "tech-uwoed-note-happy" });
  const result = await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, executionNote: "Replaced compressor" }, techUid),
  );
  assert.ok(result.success);
  assert.ok(result.updatedFields.includes("executionLog"));
  const snap = await db.collection("fieldops_wos").doc(woId).get();
  const log = snap.data().executionLog;
  assert.ok(Array.isArray(log) && log.length === 1);
  assert.equal(log[0].note, "Replaced compressor");
  assert.equal(log[0].byTechnicianId, "tech-uwoed-note-happy");
});

test("updateWorkOrderExecutionData: unknown sku in qtyUsedUpdates is rejected", async () => {
  const techUid = uid("uwoed-unknown-sku");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-unknown-sku" });
  const woId = uid("wo-uwoed-unknown-sku");
  await seedWorkOrder(woId, { assignedTechId: "tech-uwoed-unknown-sku", inventorySnapshot: [] });
  await assertHttpsErrorCode(
    updateWorkOrderExecutionData.run(
      callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "not-planned", delta: 1 }] }, techUid),
    ),
    "invalid-argument",
  );
});

test("updateWorkOrderExecutionData: assigned technician increments qtyUsed for a planned part, floored at 0", async () => {
  const techUid = uid("uwoed-qty-happy");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-qty-happy" });
  const woId = uid("wo-uwoed-qty-happy");
  await seedWorkOrder(woId, {
    assignedTechId: "tech-uwoed-qty-happy",
    inventorySnapshot: [{ sku: "part-1", qtyUsed: 0 }],
  });
  const result = await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "part-1", delta: 3 }] }, techUid),
  );
  assert.ok(result.updatedFields.includes("inventorySnapshot"));
  let snap = await db.collection("fieldops_wos").doc(woId).get();
  assert.equal(snap.data().inventorySnapshot[0].qtyUsed, 3);

  // Delta below zero floors at 0, never goes negative.
  await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, qtyUsedUpdates: [{ sku: "part-1", delta: -10 }] }, techUid),
  );
  snap = await db.collection("fieldops_wos").doc(woId).get();
  assert.equal(snap.data().inventorySnapshot[0].qtyUsed, 0);
});

test("updateWorkOrderExecutionData: never touches status or assignedTechId (narrow write path, separate from transitionWorkOrder)", async () => {
  const techUid = uid("uwoed-narrow-scope");
  await seedUser(techUid, "technician", { technicianId: "tech-uwoed-narrow-scope" });
  const woId = uid("wo-uwoed-narrow-scope");
  await seedWorkOrder(woId, { status: "WORK_IN_PROGRESS", assignedTechId: "tech-uwoed-narrow-scope" });
  await updateWorkOrderExecutionData.run(
    callRequest({ workOrderId: woId, executionNote: "still working" }, techUid),
  );
  const snap = await db.collection("fieldops_wos").doc(woId).get();
  assert.equal(snap.data().status, "WORK_IN_PROGRESS");
  assert.equal(snap.data().assignedTechId, "tech-uwoed-narrow-scope");
});
