// Emulator E2E harness -- shared test kit.
//
// WHY THIS EXISTS: a large read-only review found 62 of the 84 deployed callables have NEVER been
// invoked by any test or scout, because they mutate and no safe, reusable place existed to run them
// end-to-end. This module is that place: start-independent helpers for seeding a minimal governed
// dataset, authenticating as a chosen persona (the SAME users/{uid}.role model getCallerContext.ts
// reads -- this codebase's callables do not use custom claims for role, see callerContext.ts),
// invoking a callable's exported onCall handler directly (the established pattern in this repo --
// see functions/test/receivingCallablesEmulator.test.mjs -- NOT a live HTTPS round-trip), and
// asserting on the resulting Firestore documents (Work Order, ledger, audit).
//
// EMULATOR ONLY. Every helper here talks to the Firestore emulator via the Admin SDK. Nothing in
// this file, or any file that imports it, may run against a live Firebase project -- see
// functions/test/e2e/README.md for the full harness contract and how to add the next chain.
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

// Fallback only -- when this file's importing test is run directly (not through
// `firebase emulators:exec`, which sets these itself), default to the same
// 127.0.0.1:8080 / demo project convention every other emulator test in this repo uses.
// See functions/test/e2e/README.md's "gotchas" section for why these three lines matter:
// the emulator loads firestore.rules from the CWD's branch, so run this from THIS worktree's root.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? `127.0.0.1:${process.env.E2E_FIRESTORE_PORT ?? "8080"}`;
// GCLOUD_PROJECT deliberately defaults to the SANDBOX project id, not "taylor-parts" (which
// environmentCapabilityOverrides.ts's embedded registry maps to role:"production" -> an
// unconditional EMPTY override set). Using the sandbox id here is what lets this harness exercise
// setWorkOrderPartsPlan's real governed capability gate (workOrder.parts.plan, catalog active:false,
// sandbox-activated) through its REAL resolveEffectiveAccess() path -- not a test-only bypass -- while
// still being pure emulator-local Firestore data with no path to any live project.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? "eos-platform-sandbox";

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

export const db = admin.firestore();

// A per-process-run id prefix so concurrent/repeated runs (and the multiple test FILES this suite's
// runner spawns as separate processes) never collide on the same document id.
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let seq = 0;
export function nextId(prefix) {
  seq += 1;
  return `${prefix}-${RUN_ID}-${seq}`;
}

// ---- check() harness -- mirrors functions/test/receivingCallablesEmulator.test.mjs's own pattern so
// this suite's output/exit-code contract is identical to the rest of the repo's emulator tests. ----
export function makeCheckRunner(label) {
  let passed = 0;
  let failed = 0;
  async function check(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS: ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL: ${name}`);
      console.error(err);
    }
  }
  function summarize() {
    console.log(`\n${label}: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
  return { check, summarize };
}

// ---- Personas -- a users/{uid} doc is the ENTIRE identity model getCallerContext.ts reads. No Auth
// emulator user, no custom claims: every callable in this chain resolves role/technicianId straight
// from Firestore, so seeding this doc IS "authenticating as a persona" for these callables. ----
export async function seedAdmin() {
  const uid = nextId("admin");
  await db.collection("users").doc(uid).set({ role: "admin" });
  return uid;
}

export async function seedDispatcher() {
  const uid = nextId("dispatcher");
  await db.collection("users").doc(uid).set({ role: "dispatcher" });
  return uid;
}

// technicianId is a SEPARATE identifier from uid (PT-001's mapping) -- transitionWorkOrder.ts /
// updateWorkOrderExecutionData.ts compare wo.assignedTechId against caller.technicianId, never uid.
export async function seedTechnician(technicianId = nextId("tech")) {
  const uid = nextId("technician");
  await db.collection("users").doc(uid).set({ role: "technician", technicianId });
  return { uid, technicianId };
}

// The GOVERNED TECHNICIAN RECORD, which is a different thing from the persona above.
//
// `seedTechnician` writes users/{uid} -- the identity a callable resolves a ROLE from. This writes
// fieldops_technicians/{technicianId} -- the record the business schedules work ONTO.
//
// UPDATED FOR ND-24. This comment used to say Chain 1 never needed the record, because
// "transitionWorkOrder's Schedule/Dispatch check for overlaps and double-booking but never check that
// the technician exists at all" -- and then described that asymmetry as deliberate. It was not
// deliberate; it was the defect, and this comment was an accurate description of it. Schedule now
// runs the same placement policy the change commands run, so a Work Order can only be placed onto a
// technician that EXISTS and carries a governed status.
//
// Practical consequence for anyone writing a test here: seeding a technician PERSONA is no longer
// enough to schedule. Use `seedTechnicianWithRecord` unless the test is specifically about what
// happens when the record is missing.
//
// Dispatch is a separate question and is unchanged -- it assigns rather than places, and ND-24 did
// not widen to it.
export async function seedTechnicianRecord(technicianId = nextId("tech"), status = "available") {
  await db.collection("fieldops_technicians").doc(technicianId).set({
    id: technicianId,
    name: `E2E ${technicianId}`,
    status,
  });
  return technicianId;
}

/** A persona AND the governed record it schedules against -- what the Scheduling commands need. */
export async function seedTechnicianWithRecord({ status = "available" } = {}) {
  const { uid, technicianId } = await seedTechnician();
  await seedTechnicianRecord(technicianId, status);
  return { uid, technicianId };
}

// ---- Reading the Scheduling domain's own collections back ----
// Deliberately Admin-SDK reads: firestore.rules denies ALL client read on both of these, so a test
// asserting through a client SDK would be asserting the Rules, not the command. Rules coverage for
// these collections belongs in the Rules regression lane, not here.
export async function workingAvailabilityDoc(technicianId) {
  const snap = await db.collection("technician_working_availability").doc(technicianId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function blockedTimeDocs(technicianId) {
  const snap = await db.collection("technician_blocked_time").where("technicianId", "==", technicianId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Drive a Work Order to SCHEDULED through the REAL governed chain -- createWorkOrder, then
 * transitionWorkOrder MarkReady, then Schedule.
 *
 * Deliberately not a hand-authored `{ status: "SCHEDULED" }` document. A fixture written straight to
 * Firestore would let a test pass against a Work Order the real commands could never have produced,
 * which is the failure mode this whole harness exists to avoid (see README item 6).
 */
export async function createScheduledWorkOrder({
  adminUid,
  dispatcherUid,
  technicianId,
  startMillis,
  endMillis,
  customerId = "cust-sched-e2e",
  locationId = "loc-sched-e2e",
} = {}) {
  const { createWorkOrder } = await import("../../../lib/createWorkOrder.js");
  const { transitionWorkOrder } = await import("../../../lib/transitionWorkOrder.js");

  const created = await createWorkOrder.run(
    callReq(adminUid, {
      customerId,
      locationId,
      priority: 3,
      type: "SERVICE_CALL",
      idempotencyKey: nextId("idem"),
    }),
  );
  const workOrderId = created.id;
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" }));
  await transitionWorkOrder.run(
    callReq(dispatcherUid, {
      workOrderId,
      action: "Schedule",
      scheduledStart: startMillis,
      scheduledEnd: endMillis,
      scheduledTechId: technicianId,
    }),
  );
  return workOrderId;
}

// ---- Part Master ----
// Real deployed governed dataset flow: setWorkOrderPartsPlan resolves partId -> canonical
// internalPartNumber (sku) through parts/{partId}; inventoryService.ts's ledger baseline
// (getAvailableQuantity) is keyed by that SAME sku against the hardcoded PARTS_CATALOG rows in
// src/data/partsCatalog.ts. A plan line only reserves/consumes real stock if its sku matches one of
// those rows -- CATALOG_SKUS below are real rows from that file, chosen for their warehouseQty.
export const CATALOG_SKUS = {
  // { sku, warehouseQty } straight from functions/src/data/partsCatalog.ts.
  COMPRESSOR: { sku: "TST-1003", warehouseQty: 20 },
  BELT: { sku: "TST-1010", warehouseQty: 4 },
};

export async function seedPart({ sku, name = "Test Part" } = CATALOG_SKUS.COMPRESSOR) {
  const partId = nextId("part");
  await db.collection("parts").doc(partId).set({
    partId,
    internalPartNumber: sku,
    name,
    status: "ACTIVE",
    stockingUnit: "EACH",
    controlType: "STANDARD",
    stockingClass: "STOCKED",
    version: 1,
    createdAt: Timestamp.now(),
    createdBy: "e2e-harness",
    updatedAt: Timestamp.now(),
    updatedBy: "e2e-harness",
  });
  return partId;
}

// ---- Governed capability grant: workOrder.parts.plan ----
// Grants the durable WORK_ORDER_PARTS_PLANNER_ROLE (governedBusinessRoles.ts, id
// "workOrderPartsPlanner") to `uid` via a real roleAssignments doc -- the SAME mechanism a
// production grant uses, not a test-only bypass. Combined with GCLOUD_PROJECT=eos-platform-sandbox
// above (which lifts the catalog's active:false blanket deny for this one capability id per
// environmentCapabilityOverrides.ts), this makes setWorkOrderPartsPlan's REAL resolveEffectiveAccess()
// call resolve ALLOW for this uid and DENY for everyone else -- proving the governed gate actually
// works, not just that the callable runs.
export async function grantWorkOrderPartsPlanRole(uid) {
  const id = nextId("roleAssignment");
  await db.collection("roleAssignments").doc(id).set({
    id,
    principalUid: uid,
    roleId: "workOrderPartsPlanner",
    scope: { type: "global" },
    grantedBy: "e2e-harness",
    grantedAt: Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 0,
  });
}

// ---- Callable request builder ----
export function callReq(uid, data) {
  return uid ? { auth: { uid }, data } : { data };
}

// ---- Assertions over the resulting governed state ----
export async function getWorkOrder(workOrderId) {
  const snap = await db.collection("fieldops_wos").doc(workOrderId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function ledgerEntries({ workOrderId, partId } = {}) {
  let q = db.collection("inventory_transactions");
  if (workOrderId) q = q.where("workOrderId", "==", workOrderId);
  if (partId) q = q.where("partId", "==", partId);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function auditEvents({ action, targetId } = {}) {
  let q = db.collection("auditEvents");
  if (action) q = q.where("action", "==", action);
  if (targetId) q = q.where("targetId", "==", targetId);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
