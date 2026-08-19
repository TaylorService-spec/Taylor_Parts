// H20 fix -- dispatch reassignment becomes explicit and accountable.
//
// Defect H20: transitionWorkOrder.ts's Dispatch branch wrote assignedTechId from a caller-supplied value
// with no check against wo.scheduledTechId, and never updated scheduledTechId. A dispatcher could Schedule
// for technician X and Dispatch to Y through the shipped UI with no warning: the scheduling board (keyed on
// scheduledTechId) kept X's slot reserved, the technician boards (keyed on assignedTechId) showed Y, and
// findScheduleConflict -- which ran once at Schedule time against X's calendar -- never checked Y's calendar
// at all, silently bypassing the double-booking guard for the technician who actually got the job.
//
// Owner ruling implemented here: dispatchers MAY reassign away from the scheduled technician; a reason is
// REQUIRED when they do; prior technician, new technician, actor, timestamp, and reason are recorded; the
// schedule AND double-booking conflict checks re-run against the NEW technician; scheduledTechId and
// assignedTechId are reconciled so the two boards cannot disagree afterward; terminal Work Orders stay locked.
//
// Same harness as transitionWorkOrderConcurrency.test.mjs: the compiled onCall handler is invoked directly
// via `.run(request)` against a live Firestore emulator.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/transitionWorkOrderReassignment.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
const PROJECT_ID = "taylor-parts";
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

const { transitionWorkOrder } = await import("../lib/transitionWorkOrder.js");

const WOS = "fieldops_wos";
const USERS = "users";
const AUDIT_EVENTS = "auditEvents";

let counter = 0;
function id(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

function callRequest(data, uid) {
  return { data, auth: uid !== undefined ? { uid, token: {} } : undefined };
}

async function seedDispatcher(uid) {
  await db.collection(USERS).doc(uid).set({ role: "dispatcher" });
}

async function seedScheduledWorkOrder(woId, { scheduledTechId, startMs, endMs, status = "SCHEDULED" }) {
  await db.collection(WOS).doc(woId).set({
    id: woId,
    status,
    scheduledTechId,
    scheduledStart: admin.firestore.Timestamp.fromMillis(startMs),
    scheduledEnd: admin.firestore.Timestamp.fromMillis(endMs),
  });
}

async function latestAuditEventFor(workOrderId, action) {
  const snap = await db
    .collection(AUDIT_EVENTS)
    .where("targetId", "==", workOrderId)
    .where("action", "==", action)
    .get();
  return snap.docs.map((d) => d.data());
}

const HOUR = 60 * 60 * 1000;
const baseStart = Date.now() + 24 * HOUR; // tomorrow, avoids any accidental overlap with other tests' windows
const baseEnd = baseStart + 2 * HOUR;

test("DEFECT GUARD: reassigning away from the scheduled technician WITHOUT a reason is rejected", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-noreason");
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart, endMs: baseEnd });

  await assert.rejects(
    () => transitionWorkOrder.run(callRequest({ workOrderId: woId, action: "Dispatch", assignedTechId: techY }, dispatcherUid)),
    /reason/i,
    "Dispatch to a different technician than scheduled must be rejected without a reason"
  );

  const snap = await db.collection(WOS).doc(woId).get();
  assert.equal(snap.data().status, "SCHEDULED", "the Work Order must NOT have transitioned to DISPATCHED");
  assert.equal(snap.data().assignedTechId, undefined, "assignedTechId must not have been written");
});

test("a SAME-technician Dispatch (no reassignment) succeeds with NO reason and is not audited as a reassignment", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const woId = id("wo-samegtech");
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart, endMs: baseEnd });

  const result = await transitionWorkOrder.run(
    callRequest({ workOrderId: woId, action: "Dispatch", assignedTechId: techX }, dispatcherUid)
  );
  assert.equal(result.status, "DISPATCHED");

  const snap = await db.collection(WOS).doc(woId).get();
  assert.equal(snap.data().assignedTechId, techX);
  assert.equal(snap.data().scheduledTechId, techX, "scheduledTechId stays reconciled with assignedTechId");
  assert.equal(snap.data().reassignedFromTechId, undefined, "no reassignment fields written for a same-technician dispatch");

  const auditEvents = await latestAuditEventFor(woId, "reassignWorkOrderTechnician");
  assert.equal(auditEvents.length, 0, "a same-technician Dispatch must not emit a reassignment Audit Event");
});

test("DEFECT FIX: reassignment WITH a reason succeeds, reconciles both fields, and audits prior/new tech + reason", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-withreason");
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart, endMs: baseEnd });

  const result = await transitionWorkOrder.run(
    callRequest(
      { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Technician X called in sick" },
      dispatcherUid
    )
  );
  assert.equal(result.status, "DISPATCHED");

  const snap = await db.collection(WOS).doc(woId).get();
  const data = snap.data();
  assert.equal(data.assignedTechId, techY, "the new technician is assigned");
  // H20 fix: scheduledTechId must be reconciled to the new technician too -- this is what keeps the
  // scheduling board (keyed on scheduledTechId) and the technician boards (keyed on assignedTechId) from
  // disagreeing about who actually has this Work Order.
  assert.equal(data.scheduledTechId, techY, "scheduledTechId is reconciled to the new technician, freeing the prior technician's slot");
  assert.equal(data.reassignedFromTechId, techX, "the prior technician is recorded");
  assert.equal(data.reassignedReason, "Technician X called in sick");
  assert.equal(data.reassignedByUid, dispatcherUid, "the acting dispatcher is recorded");
  assert.ok(data.reassignedAt, "a reassignment timestamp is recorded");

  const auditEvents = await latestAuditEventFor(woId, "reassignWorkOrderTechnician");
  assert.equal(auditEvents.length, 1, "exactly one reassignment Audit Event is staged");
  const event = auditEvents[0];
  assert.equal(event.actorUid, dispatcherUid, "the Audit Event records the acting dispatcher");
  assert.equal(event.outcome, "applied");
  assert.ok(event.summary.includes(techX), "the Audit Event summary names the prior technician");
  assert.ok(event.summary.includes(techY), "the Audit Event summary names the new technician");
  assert.ok(event.summary.includes("Technician X called in sick"), "the Audit Event summary carries the reason");
  assert.ok(event.at, "the Audit Event records a server timestamp");
});

test("MERGE COMPOSITION (M9/H19 + H20): a reassigning Dispatch stages BOTH the generic transitionWorkOrder event AND the dedicated reassignWorkOrderTechnician event for the SAME call -- two meaningfully different facts, not a duplicate", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-composition");
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart, endMs: baseEnd });

  await transitionWorkOrder.run(
    callRequest(
      { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Coverage swap" },
      dispatcherUid
    )
  );

  const [genericEvents, reassignEvents] = await Promise.all([
    latestAuditEventFor(woId, "transitionWorkOrder"),
    latestAuditEventFor(woId, "reassignWorkOrderTechnician"),
  ]);

  assert.equal(genericEvents.length, 1, "the M9/H19 generic per-transition event still fires for this Dispatch");
  assert.equal(reassignEvents.length, 1, "the H20 reassignment event ALSO fires for this same Dispatch");

  // The generic event records the STATE TRANSITION (and, per the merge resolution, a short pointer to the
  // reassignment) -- it must never be the only place the reason lives, since it structurally has no reason
  // field of its own.
  assert.ok(genericEvents[0].summary.includes("Dispatch"), "the generic event names the action");
  assert.ok(genericEvents[0].summary.includes(techX) && genericEvents[0].summary.includes(techY),
    "the generic event's summary points at the reassignment (prior -> new technician)");
  assert.ok(!genericEvents[0].summary.includes("Coverage swap"),
    "the generic event does not duplicate the full reason text -- that detail lives only in the dedicated event");

  // The dedicated event carries the full, structured reassignment fact the generic one cannot express.
  assert.ok(reassignEvents[0].summary.includes("Coverage swap"), "the dedicated event carries the reason");
  assert.ok(reassignEvents[0].summary.includes(techX) && reassignEvents[0].summary.includes(techY),
    "the dedicated event names both technicians");

  // Both records describe the ONE Dispatch call and must attribute it identically.
  assert.equal(genericEvents[0].actorUid, reassignEvents[0].actorUid, "both events attribute the same actor");
  assert.equal(genericEvents[0].targetId, woId);
  assert.equal(reassignEvents[0].targetId, woId);
});

test("DEFECT FIX: reassigning to a technician with a SCHEDULE conflict (overlapping window) is refused -- the gap H20 exploited", async () => {
  // Before the fix, findScheduleConflict ran ONLY at Schedule time against the originally-scheduled
  // technician's calendar. Dispatching to a DIFFERENT technician never re-checked that technician's own
  // calendar, so a technician already double-booked on an overlapping window could be dispatched anyway.
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-conflict");
  const conflictingWoId = id("wo-conflict-existing");

  // techY already has an overlapping SCHEDULED Work Order in the same window.
  await seedScheduledWorkOrder(conflictingWoId, { scheduledTechId: techY, startMs: baseStart, endMs: baseEnd });
  // This Work Order was scheduled for techX in the SAME window; dispatcher tries to reassign it to techY.
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart, endMs: baseEnd });

  await assert.rejects(
    () =>
      transitionWorkOrder.run(
        callRequest(
          { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Coverage swap" },
          dispatcherUid
        )
      ),
    /already scheduled for overlapping/i,
    "the re-run schedule conflict check must refuse a technician who is already booked in this window"
  );

  const snap = await db.collection(WOS).doc(woId).get();
  assert.equal(snap.data().status, "SCHEDULED", "the Work Order must NOT have transitioned to DISPATCHED");
  assert.equal(snap.data().scheduledTechId, techX, "the original technician's slot must remain intact after a refused reassignment");
});

test("DEFECT FIX: reassigning to a technician who is already actively DOUBLE-BOOKED (occupying status) is refused", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-doublebook");
  const activeWoId = id("wo-doublebook-active");

  // techY is already actively on another Work Order (an occupying status).
  await db.collection(WOS).doc(activeWoId).set({ id: activeWoId, status: "DISPATCHED", assignedTechId: techY });
  await seedScheduledWorkOrder(woId, { scheduledTechId: techX, startMs: baseStart + 100 * HOUR, endMs: baseEnd + 100 * HOUR });

  await assert.rejects(
    () =>
      transitionWorkOrder.run(
        callRequest(
          { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Coverage swap" },
          dispatcherUid
        )
      ),
    /cannot double-book/i
  );
});

test("DEFECT GUARD: a terminal (COMPLETED) Work Order rejects reassignment entirely", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-completed");
  await db.collection(WOS).doc(woId).set({ id: woId, status: "COMPLETED", scheduledTechId: techX, assignedTechId: techX });

  await assert.rejects(
    () =>
      transitionWorkOrder.run(
        callRequest(
          { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Trying to reassign a done job" },
          dispatcherUid
        )
      ),
    /Invalid transition/i,
    "a COMPLETED Work Order must reject Dispatch (and therefore reassignment) entirely, reason or not"
  );
});

test("DEFECT GUARD: a terminal (CANCELLED) Work Order rejects reassignment entirely", async () => {
  const dispatcherUid = id("u-dispatcher");
  await seedDispatcher(dispatcherUid);

  const techX = id("tech-x");
  const techY = id("tech-y");
  const woId = id("wo-cancelled");
  await db.collection(WOS).doc(woId).set({ id: woId, status: "CANCELLED", scheduledTechId: techX });

  await assert.rejects(
    () =>
      transitionWorkOrder.run(
        callRequest(
          { workOrderId: woId, action: "Dispatch", assignedTechId: techY, reassignReason: "Trying to reassign a cancelled job" },
          dispatcherUid
        )
      ),
    /Invalid transition/i,
    "a CANCELLED Work Order must reject Dispatch (and therefore reassignment) entirely, reason or not"
  );
});
