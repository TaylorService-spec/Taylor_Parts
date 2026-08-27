// Emulator E2E harness -- ND-24: the INITIAL Schedule placement obeys the same policy as a change.
//
// WHAT DEFECT THIS FILE EXISTS FOR
//
// ND-20 decided the collision policy for the Scheduling DOMAIN. It shipped implemented inside
// schedulingCommands.ts and wired into reschedule and reassign, while transitionWorkOrder's Schedule
// action -- the path that makes the FIRST placement -- went on validating overlap alone. The live
// Scheduling Functional Gate found the consequence in the deployed sandbox: a dispatcher could
// Schedule a Work Order into the past, or into a technician's PTO, and be refused for the identical
// window if they instead pressed Reschedule. Two entry points, two answers, same business question.
//
// So the assertions here are deliberately written as PAIRS. Each condition is put to Schedule and to
// Reschedule and the two outcomes are compared to each other, not to a hardcoded expectation. A
// future change that weakens both paths together would still be caught by the single-path checks; a
// change that weakens only one is what the pairs exist to catch, because that is the shape the defect
// actually had.
//
// Every Work Order here reaches its state through the REAL chain (createWorkOrder -> MarkReady ->
// Schedule), never a hand-authored status document -- see functions/test/e2e/README.md item 6.
//
// Run: `npm run test:e2eEmulatorSuite`, or against an already-running emulator,
// `npm run build && node test/e2e/schedulingPlacementSymmetryEmulator.test.mjs`.
import assert from "node:assert/strict";

import {
  auditEvents,
  callReq,
  createScheduledWorkOrder,
  getWorkOrder,
  makeCheckRunner,
  nextId,
  seedAdmin,
  seedDispatcher,
  seedTechnicianWithRecord,
  seedTechnicianRecord,
} from "./lib/testKit.mjs";

const { transitionWorkOrder } = await import("../../lib/transitionWorkOrder.js");
const { createWorkOrder } = await import("../../lib/createWorkOrder.js");
const { rescheduleWorkOrderCallable, createTechnicianBlockedTimeCallable } = await import(
  "../../lib/scheduling/schedulingCallables.js"
);

const { check, summarize } = makeCheckRunner("schedulingPlacementSymmetryEmulator");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const adminUid = await seedAdmin();
const dispatcherUid = await seedDispatcher();

/** A Work Order sitting in READY_TO_DISPATCH, ready for its FIRST placement. */
async function createReadyWorkOrder() {
  const created = await createWorkOrder.run(
    callReq(adminUid, {
      customerId: "cust-nd24",
      locationId: "loc-nd24",
      priority: 3,
      type: "SERVICE_CALL",
      idempotencyKey: nextId("idem"),
    }),
  );
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId: created.id, action: "MarkReady" }));
  return created.id;
}

/** Attempt an initial Schedule; return the governed outcome rather than throwing. */
async function attemptSchedule({ workOrderId, technicianId, startMillis, endMillis }) {
  try {
    const result = await transitionWorkOrder.run(
      callReq(dispatcherUid, {
        workOrderId,
        action: "Schedule",
        scheduledStart: startMillis,
        scheduledEnd: endMillis,
        scheduledTechId: technicianId,
      }),
    );
    return { refused: false, result };
  } catch (err) {
    return { refused: true, code: err?.details?.code ?? null, httpsCode: err?.code ?? null, err };
  }
}

/** Attempt a Reschedule of an already-SCHEDULED Work Order; same outcome shape. */
async function attemptReschedule({ workOrderId, technicianId, startMillis, endMillis }) {
  try {
    const result = await rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId,
        reason: "ND-24 symmetry probe",
        scheduledStart: startMillis,
        scheduledEnd: endMillis,
        ...(technicianId ? { scheduledTechId: technicianId } : {}),
      }),
    );
    return { refused: false, result };
  } catch (err) {
    return { refused: true, code: err?.details?.code ?? null, httpsCode: err?.code ?? null, err };
  }
}

// ---------------------------------------------------------------------------------------------
// The valid case, first. Everything below asserts a refusal, and a suite that only ever asserted
// refusals would pass just as well against a Schedule that refused EVERYTHING.
// ---------------------------------------------------------------------------------------------

await check("a valid initial Schedule still commits", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const workOrderId = await createReadyWorkOrder();
  const start = Date.now() + 2 * DAY;

  const outcome = await attemptSchedule({ workOrderId, technicianId, startMillis: start, endMillis: start + 2 * HOUR });
  assert.equal(outcome.refused, false, "a clean placement must not be refused");

  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "SCHEDULED");
  assert.equal(wo.scheduledTechId, technicianId);
  assert.equal(wo.scheduledStart.toMillis(), start);
});

// ---------------------------------------------------------------------------------------------
// Past start -- SCHED-D1
// ---------------------------------------------------------------------------------------------

await check("Schedule refuses a start in the past, exactly as Reschedule does", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const pastStart = Date.now() - 3 * HOUR;

  const readyId = await createReadyWorkOrder();
  const scheduleOutcome = await attemptSchedule({
    workOrderId: readyId, technicianId, startMillis: pastStart, endMillis: pastStart + 2 * HOUR,
  });

  // The paired path: a DIFFERENT technician, so the two probes cannot collide with one another and
  // report an overlap refusal that would look like agreement while proving nothing.
  const other = await seedTechnicianWithRecord();
  const scheduledId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: other.technicianId,
    startMillis: Date.now() + 5 * DAY, endMillis: Date.now() + 5 * DAY + 2 * HOUR,
  });
  const rescheduleOutcome = await attemptReschedule({
    workOrderId: scheduledId, startMillis: pastStart, endMillis: pastStart + 2 * HOUR,
  });

  assert.equal(scheduleOutcome.refused, true, "Schedule must refuse a start in the past");
  assert.equal(scheduleOutcome.code, "START_IN_PAST");
  assert.equal(
    scheduleOutcome.code, rescheduleOutcome.code,
    "Schedule and Reschedule must classify a past start identically",
  );
});

await check("a Schedule refused for a past start leaves the Work Order in the queue, with no audit", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const workOrderId = await createReadyWorkOrder();
  const before = await getWorkOrder(workOrderId);
  const pastStart = Date.now() - 4 * HOUR;

  const outcome = await attemptSchedule({
    workOrderId, technicianId, startMillis: pastStart, endMillis: pastStart + HOUR,
  });
  assert.equal(outcome.refused, true);

  // Atomicity: not merely "still READY_TO_DISPATCH", but no partial placement projection either.
  const after = await getWorkOrder(workOrderId);
  assert.equal(after.status, "READY_TO_DISPATCH");
  assert.equal(after.scheduledTechId, undefined, "a refused Schedule must not write a technician");
  assert.equal(after.scheduledStart, undefined, "a refused Schedule must not write a window");
  assert.equal(after.scheduledEnd, undefined);
  assert.equal(
    after.updatedAt?.toMillis?.(), before.updatedAt?.toMillis?.(),
    "a refused Schedule must not even bump updatedAt",
  );

  const audits = await auditEvents({ targetId: workOrderId });
  const placementAudits = audits.filter((a) => String(a.summary ?? "").includes("SCHEDULED"));
  assert.equal(placementAudits.length, 0, "a refused Schedule must stage no audit event");
});

// ---------------------------------------------------------------------------------------------
// Blocked time -- SCHED-D2
// ---------------------------------------------------------------------------------------------

await check("Schedule refuses a placement into blocked time, exactly as Reschedule does", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const blockStart = Date.now() + 3 * DAY;

  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, {
      technicianId, startMillis: blockStart, endMillis: blockStart + 4 * HOUR,
      kind: "PTO", reason: "ND-24 blocked-time probe",
    }),
  );

  const readyId = await createReadyWorkOrder();
  const scheduleOutcome = await attemptSchedule({
    workOrderId: readyId, technicianId,
    startMillis: blockStart + HOUR, endMillis: blockStart + 2 * HOUR,
  });

  // The paired path: a Work Order already placed elsewhere on this same technician, re-timed INTO the
  // block. Same technician on purpose here -- it is the technician's own absence being tested.
  const scheduledId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId,
    startMillis: blockStart + 2 * DAY, endMillis: blockStart + 2 * DAY + HOUR,
  });
  const rescheduleOutcome = await attemptReschedule({
    workOrderId: scheduledId,
    startMillis: blockStart + HOUR, endMillis: blockStart + 2 * HOUR,
  });

  assert.equal(scheduleOutcome.refused, true, "Schedule must refuse a placement into blocked time");
  assert.equal(scheduleOutcome.code, "BLOCKED_TIME_CONFLICT");
  assert.equal(
    scheduleOutcome.code, rescheduleOutcome.code,
    "Schedule and Reschedule must classify blocked time identically",
  );

  const wo = await getWorkOrder(readyId);
  assert.equal(wo.status, "READY_TO_DISPATCH", "the refused Schedule left the Work Order queued");
});

await check("blocked time refuses only its own window -- an adjacent placement still commits", async () => {
  // Guards against the fix over-refusing: a check that rejected any technician WITH blocked time
  // anywhere would pass every refusal assertion above and quietly break the business.
  const { technicianId } = await seedTechnicianWithRecord();
  const blockStart = Date.now() + 4 * DAY;
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, {
      technicianId, startMillis: blockStart, endMillis: blockStart + 2 * HOUR,
      kind: "TRAINING", reason: "ND-24 adjacency probe",
    }),
  );

  const workOrderId = await createReadyWorkOrder();
  const after = blockStart + 2 * HOUR; // starts exactly where the block ends -- half-open, so legal
  const outcome = await attemptSchedule({
    workOrderId, technicianId, startMillis: after, endMillis: after + HOUR,
  });
  assert.equal(outcome.refused, false, "a window abutting a block must still be schedulable");
  assert.equal((await getWorkOrder(workOrderId)).status, "SCHEDULED");
});

// ---------------------------------------------------------------------------------------------
// Technician eligibility
// ---------------------------------------------------------------------------------------------

await check("Schedule refuses an ineligible technician, exactly as Reschedule does", async () => {
  // A governed record that exists but carries a status the platform does not recognise -- the only
  // eligibility this repository can honestly assert today (ND-20).
  const badTechId = await seedTechnicianRecord(nextId("tech-bad"), "retired");

  const readyId = await createReadyWorkOrder();
  const start = Date.now() + 6 * DAY;
  const scheduleOutcome = await attemptSchedule({
    workOrderId: readyId, technicianId: badTechId, startMillis: start, endMillis: start + HOUR,
  });

  const good = await seedTechnicianWithRecord();
  const scheduledId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: good.technicianId,
    startMillis: start + DAY, endMillis: start + DAY + HOUR,
  });
  const rescheduleOutcome = await attemptReschedule({
    workOrderId: scheduledId, technicianId: badTechId,
    startMillis: start + 2 * DAY, endMillis: start + 2 * DAY + HOUR,
  });

  assert.equal(scheduleOutcome.refused, true, "Schedule must refuse an ineligible technician");
  assert.equal(scheduleOutcome.code, "TECHNICIAN_INELIGIBLE");
  assert.equal(scheduleOutcome.code, rescheduleOutcome.code, "both paths classify eligibility identically");
});

await check("Schedule refuses a technician with no governed record at all", async () => {
  const readyId = await createReadyWorkOrder();
  const start = Date.now() + 7 * DAY;
  const outcome = await attemptSchedule({
    workOrderId: readyId, technicianId: "tech-that-does-not-exist", startMillis: start, endMillis: start + HOUR,
  });
  assert.equal(outcome.refused, true);
  assert.equal(outcome.code, "TECHNICIAN_NOT_FOUND");
  assert.equal((await getWorkOrder(readyId)).status, "READY_TO_DISPATCH");
});

// ---------------------------------------------------------------------------------------------
// Overlap -- the one condition Schedule ALREADY enforced. Proving it survived the rewiring.
// ---------------------------------------------------------------------------------------------

await check("Schedule still refuses an overlapping placement on the same technician", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const start = Date.now() + 8 * DAY;
  await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + 3 * HOUR,
  });

  const secondId = await createReadyWorkOrder();
  const outcome = await attemptSchedule({
    workOrderId: secondId, technicianId, startMillis: start + HOUR, endMillis: start + 2 * HOUR,
  });
  assert.equal(outcome.refused, true, "overlap must still refuse");
  assert.equal(outcome.code, "SCHEDULE_CONFLICT");
  assert.equal((await getWorkOrder(secondId)).status, "READY_TO_DISPATCH");
});

await check("a placement abutting another on the same technician is legal", async () => {
  // Half-open windows: [09:00,10:00) and [10:00,11:00) do not overlap. Asserted because moving the
  // overlap check behind checkPlacement is exactly the kind of change that quietly turns < into <=.
  const { technicianId } = await seedTechnicianWithRecord();
  const start = Date.now() + 9 * DAY;
  await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });

  const secondId = await createReadyWorkOrder();
  const outcome = await attemptSchedule({
    workOrderId: secondId, technicianId, startMillis: start + HOUR, endMillis: start + 2 * HOUR,
  });
  assert.equal(outcome.refused, false, "abutting windows must remain schedulable");
});

// ---------------------------------------------------------------------------------------------
// Outside working hours -- WARNS, does not refuse
// ---------------------------------------------------------------------------------------------

await check("Schedule outside recorded working hours COMMITS and returns the warning", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  // Wall-clock hours in a fixed-offset zone, so this assertion cannot drift across a DST boundary.
  await db_setWorkingHours(technicianId);

  const workOrderId = await createReadyWorkOrder();
  const at0200 = nextLocalHourUtcMinus7(2, 3);
  const outcome = await attemptSchedule({
    workOrderId, technicianId, startMillis: at0200, endMillis: at0200 + 2 * HOUR,
  });

  assert.equal(outcome.refused, false, "ND-20: outside working hours WARNS, it does not refuse");
  const codes = (outcome.result.warnings ?? []).map((w) => w.code);
  assert.ok(
    codes.includes("OUTSIDE_WORKING_HOURS"),
    `expected OUTSIDE_WORKING_HOURS on the response, got ${JSON.stringify(codes)}`,
  );
  assert.equal((await getWorkOrder(workOrderId)).status, "SCHEDULED", "and it committed");
});

await check("Schedule inside recorded working hours commits with NO warnings", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  await db_setWorkingHours(technicianId);

  const workOrderId = await createReadyWorkOrder();
  const at0900 = nextLocalHourUtcMinus7(9, 4);
  const outcome = await attemptSchedule({
    workOrderId, technicianId, startMillis: at0900, endMillis: at0900 + 2 * HOUR,
  });

  assert.equal(outcome.refused, false);
  assert.deepEqual(
    outcome.result.warnings ?? [], [],
    "a placement squarely inside recorded hours has nothing to warn about",
  );
});

await check("Schedule for a technician with NO recorded hours warns differently, and still commits", async () => {
  // The domain's most consequential distinction: unrecorded is not the same as zero. A board that
  // collapsed the two would show every technician permanently off-shift the day this ships.
  const { technicianId } = await seedTechnicianWithRecord();
  const workOrderId = await createReadyWorkOrder();
  const start = Date.now() + 11 * DAY;

  const outcome = await attemptSchedule({
    workOrderId, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  assert.equal(outcome.refused, false);
  const codes = (outcome.result.warnings ?? []).map((w) => w.code);
  assert.ok(codes.includes("NO_WORKING_AVAILABILITY_RECORDED"), `got ${JSON.stringify(codes)}`);
  assert.ok(!codes.includes("OUTSIDE_WORKING_HOURS"), "unrecorded must never masquerade as outside-hours");
});

// ---------------------------------------------------------------------------------------------
// Helpers, kept at the bottom so the assertions read first.
// ---------------------------------------------------------------------------------------------

/**
 * Record 07:00-16:00 America/Phoenix for a technician, written straight to the collection.
 *
 * Deliberately NOT through setTechnicianWorkingAvailabilityCallable: that command is covered by
 * schedulingAvailabilityEmulator.test.mjs, and this file is about what PLACEMENT does with a
 * recorded schedule. Phoenix because it does not observe DST, so a window computed here means the
 * same wall-clock hour in March as in July.
 */
async function db_setWorkingHours(technicianId) {
  const { db } = await import("./lib/testKit.mjs");
  const hours = [{ start: "07:00", end: "16:00" }];
  await db.collection("technician_working_availability").doc(technicianId).set({
    technicianId,
    timeZone: "America/Phoenix",
    weeklyHours: { 0: hours, 1: hours, 2: hours, 3: hours, 4: hours, 5: hours, 6: hours },
  });
}

/** The instant at which it is `hour`:00 in America/Phoenix (a fixed UTC-7), `days` from now. */
function nextLocalHourUtcMinus7(hour, days) {
  const probe = new Date(Date.now() + days * DAY);
  return Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), hour + 7, 0, 0);
}

process.exit(summarize() ? 0 : 1);
