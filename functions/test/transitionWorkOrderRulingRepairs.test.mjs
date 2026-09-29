// Controller rulings DQ-014 and DQ-015 (2026-09-28) on the retirement-only transitionWorkOrder callable.
//
// DQ-014 -- Dispatch enforces the EXISTING placement invariants against the technician it actually sends
// the job to: the technician exists, carries a governed status, and has no blocked time (PTO) over the
// Work Order's window. The same collections Schedule already reads; nothing new.
//
// DQ-015 -- the technician's governed Complete EMITS the SERVICE-line fulfillment acceptance when its
// established prerequisites hold (sole service Work Order, a SERVICE line this Work Order references,
// remaining quantity), idempotently, and never prematurely.
//
// Harness: the compiled onCall handler invoked via `.run(request)` against a live Firestore emulator, as
// transitionWorkOrderReassignment.test.mjs does.

import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();
const { transitionWorkOrder } = await import("../lib/transitionWorkOrder.js");

let n = 0;
const id = (p) => `${p}-${Date.now()}-${(n += 1)}`;
const call = (data, uid) => ({ data, auth: { uid, token: {} } });
const HOUR = 3_600_000;

async function dispatcher() {
  const uid = id("u-disp");
  await db.collection("users").doc(uid).set({ role: "dispatcher" });
  return uid;
}
async function technicianDoc(techId, status = "available") {
  await db.collection("fieldops_technicians").doc(techId).set({ status, name: techId });
}
async function scheduledWo(techId, startMs) {
  const woId = id("wo");
  await db.collection("fieldops_wos").doc(woId).set({
    id: woId, status: "SCHEDULED", scheduledTechId: techId,
    scheduledStart: admin.firestore.Timestamp.fromMillis(startMs),
    scheduledEnd: admin.firestore.Timestamp.fromMillis(startMs + 2 * HOUR),
  });
  return woId;
}
const statusOf = async (woId) => (await db.collection("fieldops_wos").doc(woId).get()).data();

// ─────────────────────────────── DQ-014 ───────────────────────────────

test("DQ-014: Dispatch to a technician id that names NO technician is refused, and nothing moves", async () => {
  const uid = await dispatcher();
  const start = Date.now() + 30 * 24 * HOUR;
  const woId = await scheduledWo(id("ghost"), start);
  await assert.rejects(transitionWorkOrder.run(call({ workOrderId: woId, action: "Dispatch", assignedTechId: id("ghost-2"), reassignReason: "x" }, uid)),
    /No technician exists/);
  const wo = await statusOf(woId);
  assert.equal(wo.status, "SCHEDULED");
  assert.equal(wo.assignedTechId, undefined);
});

test("DQ-014: Dispatch to a technician with no governed status is refused", async () => {
  const uid = await dispatcher();
  const tech = id("tech-bad");
  await technicianDoc(tech, "retired-somehow");
  const woId = await scheduledWo(tech, Date.now() + 31 * 24 * HOUR);
  await assert.rejects(transitionWorkOrder.run(call({ workOrderId: woId, action: "Dispatch", assignedTechId: tech }, uid)),
    /no governed status/);
  assert.equal((await statusOf(woId)).status, "SCHEDULED");
});

test("DQ-014: Dispatch (and H20 reassignment) onto a technician's blocked time (PTO) is refused", async () => {
  const uid = await dispatcher();
  const scheduled = id("tech-a");
  const onPto = id("tech-pto");
  await technicianDoc(scheduled);
  await technicianDoc(onPto);
  const start = Date.now() + 32 * 24 * HOUR;
  await db.collection("technician_blocked_time").doc(id("blk")).set({
    technicianId: onPto, kind: "PTO", startMillis: start - HOUR, endMillis: start + HOUR,
  });
  const woId = await scheduledWo(scheduled, start);
  await assert.rejects(transitionWorkOrder.run(call({ workOrderId: woId, action: "Dispatch", assignedTechId: onPto, reassignReason: "cover" }, uid)),
    /PTO blocked time/);
  assert.equal((await statusOf(woId)).status, "SCHEDULED");
  // The ordinary same-technician dispatch of an eligible, unblocked technician still succeeds.
  const ok = await transitionWorkOrder.run(call({ workOrderId: woId, action: "Dispatch", assignedTechId: scheduled }, uid));
  assert.equal(ok.status, "DISPATCHED");
});

test("DQ-014: blocked time OUTSIDE the window does not refuse, and a window already begun is not 'in the past'", async () => {
  const uid = await dispatcher();
  const tech = id("tech-late");
  await technicianDoc(tech);
  const start = Date.now() - HOUR; // the job's window started an hour ago: dispatching late is ordinary
  await db.collection("technician_blocked_time").doc(id("blk")).set({
    technicianId: tech, kind: "PTO", startMillis: start + 5 * HOUR, endMillis: start + 9 * HOUR,
  });
  const woId = await scheduledWo(tech, start);
  const r = await transitionWorkOrder.run(call({ workOrderId: woId, action: "Dispatch", assignedTechId: tech }, uid));
  assert.equal(r.status, "DISPATCHED");
});

// ─────────────────────────────── DQ-015 ───────────────────────────────

async function technician() {
  const uid = id("u-tech");
  const techId = id("tech");
  await db.collection("users").doc(uid).set({ role: "technician", technicianId: techId });
  return { uid, techId };
}
async function soWithService({ serviceWorkOrderIds, lines }) {
  const soId = id("so");
  await db.collection("sales_orders").doc(soId).set({ id: soId, state: "IN_FULFILLMENT", serviceWorkOrderIds, lines });
  return soId;
}
async function wipWo(woId, techId, soId, salesOrderLineRefs) {
  await db.collection("fieldops_wos").doc(woId).set({
    id: woId, status: "WORK_IN_PROGRESS", assignedTechId: techId, salesOrderId: soId, salesOrderLineRefs,
  });
}
const soLines = async (soId) => (await db.collection("sales_orders").doc(soId).get()).data();

test("DQ-015: Complete by the assigned technician EMITS the SERVICE acceptance for the sole service Work Order", async () => {
  const { uid, techId } = await technician();
  const woId = id("wo-svc");
  const soId = await soWithService({ serviceWorkOrderIds: [woId], lines: [{ kind: "SERVICE", ref: "SVC-1", lineId: "L1", orderedQty: 2, fulfilledQty: 0 }] });
  await wipWo(woId, techId, soId, [{ ref: "SVC-1", kind: "SERVICE", orderedQty: 2, allocatedQty: 0, lineId: "L1" }]);
  const r = await transitionWorkOrder.run(call({ workOrderId: woId, action: "Complete" }, uid));
  assert.equal(r.status, "COMPLETED");
  const so = await soLines(soId);
  assert.equal(so.lines[0].fulfilledQty, 2, "the whole remaining SERVICE quantity is accepted, no declaration needed");
  assert.equal(so.state, "FULFILLED", "and the Sales Order auto-advances when every line is fulfilled");
  const audit = await db.collection("auditEvents").where("targetId", "==", soId).where("action", "==", "salesOrderFulfillmentWriteBack").get();
  assert.equal(audit.size, 1);

  // IDEMPOTENT: a retried / replayed Complete is refused before any write-back.
  await assert.rejects(transitionWorkOrder.run(call({ workOrderId: woId, action: "Complete" }, uid)), /Invalid transition/);
  assert.equal((await soLines(soId)).lines[0].fulfilledQty, 2, "never accepted twice");
  const again = await db.collection("auditEvents").where("targetId", "==", soId).where("action", "==", "salesOrderFulfillmentWriteBack").get();
  assert.equal(again.size, 1);
});

test("DQ-015: NO premature acceptance -- another technician, an earlier action, or an ambiguous SO accepts nothing", async () => {
  const { uid, techId } = await technician();
  const other = await technician();
  const woId = id("wo-svc");
  const soId = await soWithService({ serviceWorkOrderIds: [woId], lines: [{ kind: "SERVICE", ref: "SVC-1", orderedQty: 1, fulfilledQty: 0 }] });
  await wipWo(woId, techId, soId, [{ ref: "SVC-1", kind: "SERVICE", orderedQty: 1, allocatedQty: 0 }]);
  // Another technician cannot Complete this job, so nothing is accepted.
  await assert.rejects(transitionWorkOrder.run(call({ workOrderId: woId, action: "Complete" }, other.uid)), /may not perform/);
  assert.equal((await soLines(soId)).lines[0].fulfilledQty, 0);

  // An AMBIGUOUS Sales Order (two service Work Orders) derives nothing: the share is not known.
  const wo2 = id("wo-svc-2");
  const ambiguous = await soWithService({ serviceWorkOrderIds: [wo2, id("wo-other")], lines: [{ kind: "SERVICE", ref: "SVC-9", orderedQty: 2, fulfilledQty: 0 }] });
  await wipWo(wo2, techId, ambiguous, [{ ref: "SVC-9", kind: "SERVICE", orderedQty: 2, allocatedQty: 0 }]);
  assert.equal((await transitionWorkOrder.run(call({ workOrderId: wo2, action: "Complete" }, uid))).status, "COMPLETED");
  assert.equal((await soLines(ambiguous)).lines[0].fulfilledQty, 0, "an ambiguous share is never guessed");

  // EQUIPMENT_MODEL lines are NOT derived: their prerequisite (a recorded installation) is not read here.
  const wo3 = id("wo-eq");
  const eq = await soWithService({ serviceWorkOrderIds: [wo3], lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 1, fulfilledQty: 0 }] });
  await wipWo(wo3, techId, eq, [{ ref: "C713", kind: "EQUIPMENT_MODEL", orderedQty: 1, allocatedQty: 1 }]);
  await transitionWorkOrder.run(call({ workOrderId: wo3, action: "Complete" }, uid));
  assert.equal((await soLines(eq)).lines[0].fulfilledQty, 0);

  // A line already fully fulfilled is left alone (no overage, Complete not blocked).
  const wo4 = id("wo-full");
  const full = await soWithService({ serviceWorkOrderIds: [wo4], lines: [{ kind: "SERVICE", ref: "SVC-2", orderedQty: 1, fulfilledQty: 1 }] });
  await wipWo(wo4, techId, full, [{ ref: "SVC-2", kind: "SERVICE", orderedQty: 1, allocatedQty: 0 }]);
  assert.equal((await transitionWorkOrder.run(call({ workOrderId: wo4, action: "Complete" }, uid))).status, "COMPLETED");
  assert.equal((await soLines(full)).lines[0].fulfilledQty, 1);
});

test("DQ-015: an explicit technician declaration still overrides the derived SERVICE acceptance", async () => {
  const { uid, techId } = await technician();
  const woId = id("wo-svc");
  const soId = await soWithService({ serviceWorkOrderIds: [woId], lines: [{ kind: "SERVICE", ref: "SVC-3", orderedQty: 3, fulfilledQty: 0 }] });
  await wipWo(woId, techId, soId, [{ ref: "SVC-3", kind: "SERVICE", orderedQty: 3, allocatedQty: 0 }]);
  await transitionWorkOrder.run(call({ workOrderId: woId, action: "Complete", fulfillmentAccepted: [{ kind: "SERVICE", ref: "SVC-3", qty: 1 }] }, uid));
  const so = await soLines(soId);
  assert.equal(so.lines[0].fulfilledQty, 1);
  assert.equal(so.state, "IN_FULFILLMENT");
});
