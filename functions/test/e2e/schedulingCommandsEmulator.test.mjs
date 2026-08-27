// Emulator E2E harness -- Chain 2: the governed Scheduling commands.
//
// Proves the REAL trusted transaction paths against a real Firestore emulator, through the exported
// onCall handlers (`.run(request)`), for the three commands that change a placement:
//
//   rescheduleWorkOrder          re-time, optionally onto another technician  (status UNCHANGED)
//   reassignScheduledWorkOrder   move technician, window taken from the RECORD (status UNCHANGED)
//   Unschedule                   SCHEDULED -> READY_TO_DISPATCH               (a real transition)
//
// WHAT THIS FILE IS NOT. It is not a second copy of
// functions/test/schedulingAvailabilityModel.test.mjs. That suite proves the pure arithmetic --
// interval merging, wall-clock placement, overlap maths, validation shapes -- with no Firestore at
// all. This one proves the things only a real transaction can prove: that a refusal leaves the stored
// Work Order byte-for-byte as it was, that the Audit Event and the projection commit together or not
// at all, that two concurrent dispatchers cannot both win the same slot, and that the prior
// scheduling facts genuinely survive into auditEvents after the document has stopped carrying them.
//
// Every Work Order here reaches SCHEDULED through the REAL chain (createWorkOrder -> MarkReady ->
// Schedule), never a hand-authored status document -- see functions/test/e2e/README.md item 6.
//
// Run: `npm run test:e2eEmulatorSuite`, or against an already-running emulator,
// `npm run build && node test/e2e/schedulingCommandsEmulator.test.mjs`.
import assert from "node:assert/strict";
import { HttpsError } from "firebase-functions/v2/https";
import {
  db,
  makeCheckRunner,
  seedAdmin,
  seedDispatcher,
  seedTechnician,
  seedTechnicianWithRecord,
  seedTechnicianRecord,
  createScheduledWorkOrder,
  callReq,
  getWorkOrder,
  auditEvents,
  nextId,
} from "./lib/testKit.mjs";

const { transitionWorkOrder } = await import("../../lib/transitionWorkOrder.js");
const {
  rescheduleWorkOrderCallable,
  reassignScheduledWorkOrderCallable,
  createTechnicianBlockedTimeCallable,
} = await import("../../lib/scheduling/schedulingCallables.js");

const { check, summarize } = makeCheckRunner("schedulingCommandsEmulator");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Far enough ahead that nothing here trips the past-start refusal by accident, and far enough that
// two test cases picking "tomorrow" do not collide on the same technician.
const base = () => Date.now() + 7 * DAY;

/** The four fields that ARE the scheduling projection, as a comparable snapshot. */
function projection(wo) {
  return {
    status: wo?.status ?? null,
    scheduledTechId: wo?.scheduledTechId ?? null,
    scheduledStart: wo?.scheduledStart?.toMillis?.() ?? null,
    scheduledEnd: wo?.scheduledEnd?.toMillis?.() ?? null,
  };
}

/** Assert a failure carried the sanitized code the callable layer promises, not a leaked message. */
function assertFailureCode(expected) {
  return (err) => {
    assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err?.constructor?.name}`);
    assert.equal(err.details?.code, expected, `expected failure code ${expected}, got ${err.details?.code}`);
    return true;
  };
}

// =================================================================================================
// RESCHEDULE
// =================================================================================================

await check("reschedule: a same-technician time change succeeds, the Work Order stays SCHEDULED, and the projection moves atomically with its audit", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base();
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });

  const newStart = start + 3 * HOUR;
  const result = await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, {
      workOrderId,
      scheduledStart: newStart,
      scheduledEnd: newStart + HOUR,
      reason: "customer moved the appointment",
    }),
  );

  assert.equal(result.workOrderId, workOrderId);
  assert.equal(result.scheduledTechId, technicianId, "a bare re-time keeps whoever is already on the job");
  assert.equal(result.scheduledStart, newStart);

  const wo = await getWorkOrder(workOrderId);
  // ND-19, asserted rather than assumed: re-timing is a PLAN change, so the lifecycle must not move.
  assert.equal(wo.status, "SCHEDULED", "reschedule must not transition the Work Order");
  assert.equal(wo.scheduledTechId, technicianId);
  assert.equal(wo.scheduledStart.toMillis(), newStart);
  assert.equal(wo.scheduledEnd.toMillis(), newStart + HOUR);

  // The denormalized snapshot of what was given up -- board display only, latest change not history.
  assert.equal(wo.rescheduledFromStart.toMillis(), start);
  assert.equal(wo.rescheduledFromEnd.toMillis(), start + HOUR);
  assert.equal(wo.rescheduledFromTechId, technicianId);
  assert.equal(wo.rescheduledReason, "customer moved the appointment");
  assert.equal(wo.rescheduledByUid, dispatcherUid);
  assert.ok(wo.rescheduledAt, "a server timestamp was stamped");

  // And the durable, append-only record. This is the historical-integrity requirement: the document
  // now says the NEW window, so if the old one is not here it is nowhere.
  const audits = await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId });
  assert.equal(audits.length, 1, "exactly one reschedule event");
  assert.equal(audits[0].outcome, "applied");
  assert.equal(audits[0].actorUid, dispatcherUid);
  assert.equal(audits[0].targetType, "workOrder");
  assert.match(audits[0].summary, new RegExp(new Date(start).toISOString()), "the PRIOR window is in the record");
  assert.match(audits[0].summary, new RegExp(new Date(newStart).toISOString()), "and so is the new one");
  assert.match(audits[0].summary, /customer moved the appointment/);
  assert.match(audits[0].summary, new RegExp(technicianId), "and the technician the work moved between");
});

await check("reschedule: a combined technician AND time change succeeds and names both technicians in the record", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const from = await seedTechnicianWithRecord();
  const to = await seedTechnicianWithRecord();

  const start = base() + DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: from.technicianId, startMillis: start, endMillis: start + HOUR,
  });

  const newStart = start + 5 * HOUR;
  await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, {
      workOrderId,
      scheduledTechId: to.technicianId,
      scheduledStart: newStart,
      scheduledEnd: newStart + 2 * HOUR,
      reason: "moved to the technician carrying the part",
    }),
  );

  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "SCHEDULED");
  assert.equal(wo.scheduledTechId, to.technicianId);
  assert.equal(wo.rescheduledFromTechId, from.technicianId);
  assert.equal(wo.scheduledStart.toMillis(), newStart);

  const audits = await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId });
  assert.equal(audits.length, 1);
  assert.match(audits[0].summary, new RegExp(from.technicianId));
  assert.match(audits[0].summary, new RegExp(to.technicianId));
});

await check("reschedule: an overlapping window on the same technician is REFUSED and changes nothing", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 2 * DAY;
  // The blocker occupies 10:00-11:00 on this technician.
  await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  // The subject sits harmlessly at 14:00-15:00.
  const subjectStart = start + 4 * HOUR;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: subjectStart, endMillis: subjectStart + HOUR,
  });

  const before = projection(await getWorkOrder(workOrderId));

  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId,
        scheduledStart: start + 30 * 60 * 1000, // straight into the blocker
        scheduledEnd: start + 90 * 60 * 1000,
        reason: "should not be allowed",
      }),
    ),
    assertFailureCode("SCHEDULE_CONFLICT"),
  );

  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before, "a refused reschedule leaves the previous schedule untouched");
  assert.equal((await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId })).length, 0, "and stages no audit event");
});

await check("reschedule: blocked time REFUSES, and recording the absence never touched the Work Order", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 3 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  const ptoStart = start + 6 * HOUR;
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "PTO", startMillis: ptoStart, endMillis: ptoStart + 4 * HOUR, note: "annual leave" }),
  );

  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId,
        scheduledStart: ptoStart + HOUR,
        scheduledEnd: ptoStart + 2 * HOUR,
        reason: "should land in PTO",
      }),
    ),
    assertFailureCode("BLOCKED_TIME_CONFLICT"),
  );

  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before);
  assert.equal((await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId })).length, 0);
});

await check("reschedule: a start in the past is REFUSED", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 4 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  const yesterday = Date.now() - DAY;
  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, { workOrderId, scheduledStart: yesterday, scheduledEnd: yesterday + HOUR, reason: "back-dating" }),
    ),
    assertFailureCode("START_IN_PAST"),
  );
  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before);
});

await check("reschedule: an unknown technician is not-found, and one with an ungoverned status is REFUSED as ineligible", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 5 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));
  const newStart = start + 3 * HOUR;

  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId, scheduledTechId: nextId("ghost"), scheduledStart: newStart, scheduledEnd: newStart + HOUR, reason: "no such person",
      }),
    ),
    assertFailureCode("TECHNICIAN_NOT_FOUND"),
  );

  // A record that exists but carries a status the platform does not recognise. This is the whole of
  // what "ineligible" honestly means here -- there is no skill, certification or territory model to
  // check, and inventing one would have been inventing business policy.
  const malformed = await seedTechnicianRecord(nextId("tech-bad"), "wandering_off");
  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId, scheduledTechId: malformed, scheduledStart: newStart, scheduledEnd: newStart + HOUR, reason: "malformed record",
      }),
    ),
    assertFailureCode("TECHNICIAN_INELIGIBLE"),
  );

  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before, "neither refusal moved anything");
  assert.equal((await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId })).length, 0);
});

await check("reschedule: outside working hours WARNS and still commits -- ND-20's one non-refusal, proved end to end", async () => {
  // The assertion this file exists to make about ND-20. Working hours are a planning aid, not a gate:
  // field service legitimately schedules emergency work at 02:00. If this ever becomes a refusal, the
  // change has to be made here, deliberately, rather than drifting in.
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const { setTechnicianWorkingAvailabilityCallable } = await import("../../lib/scheduling/schedulingCallables.js");

  // A technician who works 07:00-16:00, every weekday, in a zone with no daylight saving so the
  // arithmetic in this test cannot drift with the season.
  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, {
      technicianId,
      timeZone: "America/Phoenix",
      weeklyHours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "07:00", end: "16:00" }]])),
    }),
  );

  const start = base() + 6 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });

  // 02:00-03:00 Phoenix time on some day comfortably ahead -- squarely outside 07:00-16:00.
  const day = new Date(start + 2 * DAY);
  const twoAmPhoenix = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 0); // 02:00 MST = 09:00 UTC

  const result = await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, {
      workOrderId, scheduledStart: twoAmPhoenix, scheduledEnd: twoAmPhoenix + HOUR, reason: "emergency call-out",
    }),
  );

  assert.ok(result.warnings.some((w) => w.code === "OUTSIDE_WORKING_HOURS"), "the excursion was reported");
  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.scheduledStart.toMillis(), twoAmPhoenix, "and the placement COMMITTED -- a warning is not a refusal");
  assert.equal(wo.status, "SCHEDULED");

  const audits = await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId });
  assert.equal(audits.length, 1);
  assert.match(audits[0].summary, /OUTSIDE_WORKING_HOURS/, "the warning rides along into the durable record");
});

await check("reschedule: a stale view of the schedule is REFUSED rather than silently overwriting someone else's move", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 8 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });

  // Someone else moves it while our dispatcher has the board open.
  await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, { workOrderId, scheduledStart: start + 2 * HOUR, scheduledEnd: start + 3 * HOUR, reason: "first mover" }),
  );
  const after = projection(await getWorkOrder(workOrderId));

  // Our dispatcher drops the card from where they could still see it.
  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, {
        workOrderId,
        expectedScheduledStart: start, // the position they were looking at, now stale
        scheduledStart: start + 6 * HOUR,
        scheduledEnd: start + 7 * HOUR,
        reason: "second mover, stale board",
      }),
    ),
    assertFailureCode("STALE_WORK_ORDER"),
  );

  assert.deepEqual(projection(await getWorkOrder(workOrderId)), after, "the first mover's placement stands");
  assert.equal((await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId })).length, 1, "and no second audit event was staged");
});

await check("reschedule: a Work Order that is not SCHEDULED has no schedule to change", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 9 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Dispatch", assignedTechId: technicianId }));
  const before = projection(await getWorkOrder(workOrderId));
  assert.equal(before.status, "DISPATCHED");

  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, { workOrderId, scheduledStart: start + 4 * HOUR, scheduledEnd: start + 5 * HOUR, reason: "too late" }),
    ),
    assertFailureCode("NOT_SCHEDULED"),
  );
  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before);
});

await check("reschedule: a technician may not reschedule, and an unauthenticated caller may not call at all", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const { uid: otherTechUid } = await seedTechnician();

  const start = base() + 10 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));
  const payload = { workOrderId, scheduledStart: start + 3 * HOUR, scheduledEnd: start + 4 * HOUR, reason: "not yours to move" };

  await assert.rejects(
    rescheduleWorkOrderCallable.run(callReq(otherTechUid, payload)),
    assertFailureCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    rescheduleWorkOrderCallable.run(callReq(null, payload)),
    (e) => e instanceof HttpsError && e.code === "unauthenticated",
  );
  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before);
});

await check("reschedule: a missing reason is refused as invalid input, before anything is read or written", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 11 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  for (const reason of [undefined, "", "   "]) {
    await assert.rejects(
      rescheduleWorkOrderCallable.run(
        callReq(dispatcherUid, { workOrderId, scheduledStart: start + 3 * HOUR, scheduledEnd: start + 4 * HOUR, reason }),
      ),
      assertFailureCode("INVALID_INPUT"),
    );
  }
  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before);
});

// =================================================================================================
// REASSIGN
// =================================================================================================

await check("reassign: the technician moves, the window is taken from the RECORD, and the prior technician survives in audit", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const from = await seedTechnicianWithRecord();
  const to = await seedTechnicianWithRecord();

  const start = base() + 12 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: from.technicianId, startMillis: start, endMillis: start + 2 * HOUR,
  });

  const result = await reassignScheduledWorkOrderCallable.run(
    callReq(dispatcherUid, {
      workOrderId,
      scheduledTechId: to.technicianId,
      reason: "emergency coverage",
      // Deliberately passing a window too -- it must be IGNORED. A reassignment that also silently
      // re-timed the job would be two changes wearing one reason.
      scheduledStart: start + 40 * HOUR,
      scheduledEnd: start + 41 * HOUR,
    }),
  );

  assert.equal(result.scheduledStart, start, "the stored window was used, not the caller's");
  assert.equal(result.scheduledEnd, start + 2 * HOUR);

  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "SCHEDULED", "reassignment is a plan change, not a transition");
  assert.equal(wo.scheduledTechId, to.technicianId);
  assert.equal(wo.scheduledStart.toMillis(), start, "and the window on the record is unchanged");
  assert.equal(wo.rescheduledFromTechId, from.technicianId);

  // The single-current-truth requirement: scheduledTechId is who the job is scheduled for, and
  // assignedTechId is who was actually dispatched. Nothing has been dispatched, so nothing claims to
  // have been -- reassignment must not invent an assignment.
  assert.equal(wo.assignedTechId, undefined, "reassigning a SCHEDULED job does not assign anybody");

  const audits = await auditEvents({ action: "reassignScheduledWorkOrder", targetId: workOrderId });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorUid, dispatcherUid);
  assert.match(audits[0].summary, new RegExp(from.technicianId), "the prior technician is retained");
  assert.match(audits[0].summary, new RegExp(to.technicianId));
  assert.match(audits[0].summary, /emergency coverage/);
  // And the reassignment does NOT masquerade as a reschedule -- separate verbs, separate queries.
  assert.equal((await auditEvents({ action: "rescheduleWorkOrder", targetId: workOrderId })).length, 0);
});

await check("reassign: a reason is required, and refusing for want of one leaves no partial reassignment", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const from = await seedTechnicianWithRecord();
  const to = await seedTechnicianWithRecord();

  const start = base() + 13 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: from.technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  await assert.rejects(
    reassignScheduledWorkOrderCallable.run(callReq(dispatcherUid, { workOrderId, scheduledTechId: to.technicianId })),
    assertFailureCode("INVALID_INPUT"),
  );

  const wo = await getWorkOrder(workOrderId);
  assert.deepEqual(projection(wo), before);
  assert.equal(wo.scheduledTechId, from.technicianId, "the technician did not move");
  assert.equal(wo.rescheduledFromTechId, undefined, "and no half-written snapshot was left behind");
  assert.equal((await auditEvents({ action: "reassignScheduledWorkOrder", targetId: workOrderId })).length, 0);
});

await check("reassign: an ineligible technician and an occupied window are both REFUSED, atomically", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const from = await seedTechnicianWithRecord();
  const busy = await seedTechnicianWithRecord();

  const start = base() + 14 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: from.technicianId, startMillis: start, endMillis: start + HOUR,
  });
  // `busy` already has work across exactly that window.
  await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId: busy.technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  const malformed = await seedTechnicianRecord(nextId("tech-bad"), "");
  await assert.rejects(
    reassignScheduledWorkOrderCallable.run(callReq(dispatcherUid, { workOrderId, scheduledTechId: malformed, reason: "ineligible" })),
    assertFailureCode("TECHNICIAN_INELIGIBLE"),
  );
  await assert.rejects(
    reassignScheduledWorkOrderCallable.run(callReq(dispatcherUid, { workOrderId, scheduledTechId: busy.technicianId, reason: "already busy" })),
    assertFailureCode("SCHEDULE_CONFLICT"),
  );

  const wo = await getWorkOrder(workOrderId);
  assert.deepEqual(projection(wo), before);
  assert.equal(wo.scheduledTechId, from.technicianId);
  assert.equal(wo.rescheduledFromTechId, undefined);
  assert.equal((await auditEvents({ action: "reassignScheduledWorkOrder", targetId: workOrderId })).length, 0, "no false audit event for either refusal");
});

// =================================================================================================
// UNSCHEDULE  (ND-18 -- the one reverse edge)
// =================================================================================================

await check("unschedule: returns to READY_TO_DISPATCH, clears the projection, and keeps the prior technician and window in audit", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 15 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + 2 * HOUR,
  });
  // Give it a reschedule snapshot first, so the clearing of THAT can be asserted too.
  await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, { workOrderId, scheduledStart: start + HOUR, scheduledEnd: start + 3 * HOUR, reason: "moved once" }),
  );
  assert.ok((await getWorkOrder(workOrderId)).rescheduledFromStart, "precondition: a snapshot exists to be cleared");

  await transitionWorkOrder.run(
    callReq(dispatcherUid, { workOrderId, action: "Unschedule", unscheduleReason: "part is backordered" }),
  );

  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "READY_TO_DISPATCH");
  // DELETED, not blanked. A lingering empty scheduledTechId would keep this Work Order inside
  // findScheduleConflict's equality query and silently reserve a technician's time for a job that is
  // no longer placed -- the H20 defect in a different costume.
  assert.equal(wo.scheduledTechId, undefined);
  assert.equal(wo.scheduledStart, undefined);
  assert.equal(wo.scheduledEnd, undefined);
  assert.equal(wo.rescheduledFromStart, undefined, "the stale reschedule snapshot went too");
  assert.equal(wo.rescheduledFromTechId, undefined);
  assert.equal(wo.rescheduledReason, undefined);

  // Both events, staged in the one transaction: the generic transition, and the one that carries the
  // detail the generic event structurally cannot express.
  const transitions = await auditEvents({ action: "transitionWorkOrder", targetId: workOrderId });
  assert.ok(transitions.some((a) => /SCHEDULED -> READY_TO_DISPATCH/.test(a.summary)), "the transition itself is recorded");

  const audits = await auditEvents({ action: "unscheduleWorkOrder", targetId: workOrderId });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, "applied");
  assert.equal(audits[0].actorUid, dispatcherUid);
  assert.match(audits[0].summary, new RegExp(technicianId), "the technician given up");
  assert.match(audits[0].summary, new RegExp(new Date(start + HOUR).toISOString()), "and the window given up");
  assert.match(audits[0].summary, /part is backordered/);

  // Proof the release is real, not cosmetic: the slot can now be taken by other work.
  const other = await seedTechnicianWithRecord();
  await db.collection("fieldops_technicians").doc(other.technicianId).get();
  const reuseId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start + HOUR, endMillis: start + 3 * HOUR,
  });
  assert.equal((await getWorkOrder(reuseId)).status, "SCHEDULED", "the freed window really is free");
});

await check("unschedule: a reason is required, and refusing leaves the Work Order SCHEDULED and intact", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 16 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  for (const unscheduleReason of [undefined, "", "  "]) {
    await assert.rejects(
      transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Unschedule", unscheduleReason })),
      (e) => e instanceof HttpsError && e.code === "invalid-argument",
    );
  }

  const wo = await getWorkOrder(workOrderId);
  assert.deepEqual(projection(wo), before, "still SCHEDULED, still placed");
  assert.equal(wo.scheduledTechId, technicianId);
  assert.equal((await auditEvents({ action: "unscheduleWorkOrder", targetId: workOrderId })).length, 0);
});

await check("unschedule: MarkReady is NOT an alternate, reason-free path out of SCHEDULED", async () => {
  // The defect ACTION_ALLOWED_FROM exists to prevent, proved against the real callable rather than
  // only against the pure table. MarkReady targets READY_TO_DISPATCH, which ND-18 made reachable from
  // SCHEDULED -- so without that table this would succeed, silently, with no reason and no audit.
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = base() + 17 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });
  const before = projection(await getWorkOrder(workOrderId));

  await assert.rejects(
    transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" })),
    (e) => e instanceof HttpsError && e.code === "permission-denied",
  );
  await assert.rejects(
    transitionWorkOrder.run(callReq(adminUid, { workOrderId, action: "MarkReady" })),
    (e) => e instanceof HttpsError && e.code === "permission-denied",
  );

  assert.deepEqual(projection(await getWorkOrder(workOrderId)), before, "still SCHEDULED, still placed");
});

await check("unschedule: refused from DISPATCHED and from every later state", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId, uid: techUid } = await seedTechnicianWithRecord();

  const start = base() + 18 * DAY;
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR,
  });

  // Walk the real chain forward, attempting Unschedule at each stop. Once a technician has been sent,
  // the job is committed -- that is the whole of ND-18's narrowing.
  const forward = [
    ["Dispatch", dispatcherUid, { assignedTechId: technicianId }],
    ["Accept", techUid, {}],
    ["Travel", techUid, {}],
    ["Arrive", techUid, {}],
    ["WorkStart", techUid, {}],
  ];
  for (const [action, uid, extra] of forward) {
    await transitionWorkOrder.run(callReq(uid, { workOrderId, action, ...extra }));
    const status = (await getWorkOrder(workOrderId)).status;
    await assert.rejects(
      transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Unschedule", unscheduleReason: "too late" })),
      (e) => e instanceof HttpsError && (e.code === "failed-precondition" || e.code === "permission-denied"),
      `Unschedule must be refused from ${status}`,
    );
    assert.equal((await getWorkOrder(workOrderId)).status, status, `${status} is unchanged by the refused attempt`);
  }

  assert.equal((await auditEvents({ action: "unscheduleWorkOrder", targetId: workOrderId })).length, 0);
});

// =================================================================================================
// CONCURRENCY
// =================================================================================================

await check("concurrency: two overlapping reschedules onto one technician cannot both commit", async () => {
  // The per-technician sentinel (work_order_tech_locks/{technicianId}) is read AND written inside
  // each transaction, so two transactions touching two DIFFERENT Work Order documents for the SAME
  // technician still collide on that one doc. Without it both would read a pre-commit snapshot in
  // which the other's window did not exist, both would pass findScheduleConflict, and both would
  // commit -- a double-booking neither guard saw.
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const day = base() + 20 * DAY;
  // Two Work Orders parked far apart on the same technician, so neither starts in conflict.
  const first = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: day, endMillis: day + HOUR,
  });
  const second = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: day + 10 * HOUR, endMillis: day + 11 * HOUR,
  });

  // Both dispatchers now aim at the SAME contested slot, simultaneously.
  const contestedStart = day + 5 * HOUR;
  const attempt = (workOrderId, reason) =>
    rescheduleWorkOrderCallable
      .run(callReq(dispatcherUid, { workOrderId, scheduledStart: contestedStart, scheduledEnd: contestedStart + HOUR, reason }))
      .then(() => ({ ok: true, workOrderId }))
      .catch((err) => ({ ok: false, workOrderId, code: err?.details?.code ?? err?.code }));

  const results = await Promise.all([attempt(first, "racer A"), attempt(second, "racer B")]);
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);

  assert.equal(winners.length, 1, `exactly one commit expected, got ${JSON.stringify(results)}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].code, "SCHEDULE_CONFLICT", "the loser was refused for the right reason, not by a crash");

  // And the stored state agrees with that verdict -- only the winner moved.
  const winnerWo = await getWorkOrder(winners[0].workOrderId);
  const loserWo = await getWorkOrder(losers[0].workOrderId);
  assert.equal(winnerWo.scheduledStart.toMillis(), contestedStart);
  assert.notEqual(loserWo.scheduledStart.toMillis(), contestedStart, "the loser kept its original placement");

  // The decisive assertion: no two Work Orders occupy overlapping windows on this technician.
  const snap = await db.collection("fieldops_wos").where("scheduledTechId", "==", technicianId).get();
  const windows = snap.docs
    .map((d) => d.data())
    .filter((w) => w.scheduledStart && w.scheduledEnd)
    .map((w) => [w.scheduledStart.toMillis(), w.scheduledEnd.toMillis()])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < windows.length; i += 1) {
    assert.ok(windows[i][0] >= windows[i - 1][1], `overlapping windows committed: ${JSON.stringify(windows)}`);
  }

  // Exactly one audit event across both Work Orders -- the refusal staged nothing.
  const a1 = await auditEvents({ action: "rescheduleWorkOrder", targetId: first });
  const a2 = await auditEvents({ action: "rescheduleWorkOrder", targetId: second });
  assert.equal(a1.length + a2.length, 1, "one commit, one audit event");
});

process.exit(summarize() ? 0 : 1);
