// M9/H19 remediation -- EMULATOR regression proving every applied transitionWorkOrder call now stages its
// own "transitionWorkOrder" Audit Event, inside the SAME transaction as the fieldops_wos status write, not
// only Complete-on-a-Sales-Order-linked Work Order (that path already had its own SEPARATE
// salesOrderFulfillmentWriteBack event -- see salesOrderFulfillmentWriteBackEmulator.test.mjs -- which is
// about the SO write-back, not a substitute for a record of the Work Order transition itself).
//
// Before this fix, transitionWorkOrder.ts had exactly ONE stageAuditEvent call site, gated on
// `if (soWriteBack)`, so Schedule/Dispatch/Accept/Travel/Arrive/WorkStart/Cancel/Hold/Close and
// Complete-without-an-SO-link wrote fieldops_wos.status with NO audit event at all. These tests assert an
// actual `auditEvents` row exists -- with the right action/targetType/targetId/outcome/actorUid -- for a
// representative set of transitions (Dispatch, Cancel, Complete-without-an-SO-link), not merely that the
// callable returned successfully (a weak assertion that would still pass even if audit staging were deleted
// entirely).
//
// Same harness as functions/test/transitionWorkOrderConcurrency.test.mjs: the compiled onCall handler is
// invoked directly via `.run(request)` against a live Firestore emulator.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/transitionWorkOrderAuditTrail.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { transitionWorkOrder } = await import("../lib/transitionWorkOrder.js");

const WOS = "fieldops_wos";
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

async function seedUser(uid, role, extra = {}) {
  await db.collection(USERS).doc(uid).set({ role, ...extra });
}

async function seedWorkOrder(woId, fields) {
  await db.collection(WOS).doc(woId).set({
    woNumber: "WO-2026-000000",
    priority: 2,
    customerId: "cust-1",
    locationId: "loc-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...fields,
  });
}

async function auditRowsFor(woId) {
  const snap = await db
    .collection(AUDIT)
    .where("action", "==", "transitionWorkOrder")
    .where("targetId", "==", woId)
    .get();
  return snap.docs.map((d) => d.data());
}

test("AUDIT TRAIL: Dispatch stages a transitionWorkOrder Audit Event with correct actor/target/outcome", async () => {
  const adminUid = id("audit-admin-dispatch");
  await seedUser(adminUid, "admin");
  const woId = id("wo-audit-dispatch");
  await seedWorkOrder(woId, { status: "SCHEDULED" });

  const techId = id("tech-audit-dispatch");
  const result = await transitionWorkOrder.run(
    callRequest({ workOrderId: woId, action: "Dispatch", assignedTechId: techId }, adminUid),
  );
  assert.equal(result.status, "DISPATCHED");

  const rows = await auditRowsFor(woId);
  assert.equal(rows.length, 1, "exactly one transitionWorkOrder Audit Event for this Dispatch");
  const row = rows[0];
  assert.equal(row.actorUid, adminUid);
  assert.equal(row.targetType, "workOrder");
  assert.equal(row.targetId, woId);
  assert.equal(row.outcome, "applied");
  assert.match(row.summary, /Dispatch/);
  assert.match(row.summary, /SCHEDULED/);
  assert.match(row.summary, /DISPATCHED/);
  assert.ok(row.at, "audit row carries a server timestamp");
});

test("AUDIT TRAIL: Cancel stages a transitionWorkOrder Audit Event with correct actor/target/outcome", async () => {
  const adminUid = id("audit-admin-cancel");
  await seedUser(adminUid, "admin");
  const woId = id("wo-audit-cancel");
  await seedWorkOrder(woId, { status: "CREATED" });

  const result = await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Cancel" }, adminUid));
  assert.equal(result.status, "CANCELLED");

  const rows = await auditRowsFor(woId);
  assert.equal(rows.length, 1, "exactly one transitionWorkOrder Audit Event for this Cancel");
  const row = rows[0];
  assert.equal(row.actorUid, adminUid);
  assert.equal(row.targetType, "workOrder");
  assert.equal(row.targetId, woId);
  assert.equal(row.outcome, "applied");
  assert.match(row.summary, /Cancel/);
});

test("AUDIT TRAIL: Complete WITHOUT a linked Sales Order stages a transitionWorkOrder Audit Event " +
  "(the defect: this path previously wrote status with no audit trail at all)", async () => {
  const techUid = id("audit-tech-complete");
  const technicianId = id("audit-tech-id-complete");
  await seedUser(techUid, "technician", { technicianId });
  const woId = id("wo-audit-complete-no-so");
  // Deliberately NO salesOrderId field -- this is the branch the pre-fix code's single, soWriteBack-gated
  // stageAuditEvent call site never reached.
  await seedWorkOrder(woId, { status: "WORK_IN_PROGRESS", assignedTechId: technicianId });

  const result = await transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Complete" }, techUid));
  assert.equal(result.status, "COMPLETED");

  const rows = await auditRowsFor(woId);
  assert.equal(rows.length, 1, "exactly one transitionWorkOrder Audit Event for this Complete-without-SO");
  const row = rows[0];
  assert.equal(row.actorUid, techUid);
  assert.equal(row.targetType, "workOrder");
  assert.equal(row.targetId, woId);
  assert.equal(row.outcome, "applied");
  assert.match(row.summary, /Complete/);

  // No linked Sales Order -> no separate salesOrderFulfillmentWriteBack event either (that event is about
  // the SO write-back specifically, and must not fire when there is no SO to write back to).
  const soWriteBackRows = await db
    .collection(AUDIT)
    .where("action", "==", "salesOrderFulfillmentWriteBack")
    .where("targetId", "==", woId)
    .get();
  assert.equal(soWriteBackRows.size, 0);
});

test("AUDIT TRAIL: a REJECTED transition (invalid state) stages no Audit Event", async () => {
  const adminUid = id("audit-admin-rejected");
  await seedUser(adminUid, "admin");
  const woId = id("wo-audit-rejected");
  await seedWorkOrder(woId, { status: "COMPLETED" });

  await assert.rejects(
    transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Cancel" }, adminUid)),
    (err) => err.code === "failed-precondition",
  );

  const rows = await auditRowsFor(woId);
  assert.equal(rows.length, 0, "a rejected (never-applied) transition writes no Audit Event");
});
