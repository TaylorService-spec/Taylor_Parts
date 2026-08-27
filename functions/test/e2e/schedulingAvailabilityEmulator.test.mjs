// Emulator E2E harness -- Chain 2b: the governed technician-availability authority.
//
// The write commands (setTechnicianWorkingAvailability, createTechnicianBlockedTime,
// deleteTechnicianBlockedTime) and the trusted read projection (readTechnicianAvailability), driven
// through the real exported onCall handlers against a real Firestore emulator.
//
// WHY THE READ MATTERS AS MUCH AS THE WRITES. Both collections deny ALL client read as well as write
// (firestore.rules), so this projection is the Dispatch board's only way in. If it returned different
// facts from the ones the commands enforce, the board would draw availability the server does not
// honour -- which is the exact failure the whole domain exists to prevent. So this file asserts the
// read against the same fixtures the refusals are proved on.
//
// CLIENT-DIRECT ACCESS IS DELIBERATELY NOT TESTED HERE. These are Admin-SDK callables and the Admin
// SDK bypasses firestore.rules by design, so a "client cannot read this" assertion made through this
// harness would be asserting nothing. That boundary belongs to the Rules regression lane
// (functions/scripts/rulesRegressionRunner.mjs), which drives the client SDK against the deployed
// ruleset -- see the note at the end of this file.
//
// Run: `npm run test:e2eEmulatorSuite`, or against an already-running emulator,
// `npm run build && node test/e2e/schedulingAvailabilityEmulator.test.mjs`.
import assert from "node:assert/strict";
import { HttpsError } from "firebase-functions/v2/https";
import {
  makeCheckRunner,
  seedAdmin,
  seedDispatcher,
  seedTechnician,
  seedTechnicianWithRecord,
  createScheduledWorkOrder,
  workingAvailabilityDoc,
  blockedTimeDocs,
  callReq,
  auditEvents,
  nextId,
} from "./lib/testKit.mjs";

const {
  setTechnicianWorkingAvailabilityCallable,
  createTechnicianBlockedTimeCallable,
  deleteTechnicianBlockedTimeCallable,
  readTechnicianAvailabilityCallable,
} = await import("../../lib/scheduling/schedulingCallables.js");

const { check, summarize } = makeCheckRunner("schedulingAvailabilityEmulator");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ZONE = "America/Phoenix"; // no daylight saving -- the arithmetic here cannot drift with the season
const WEEKDAY_HOURS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "07:00", end: "16:00" }]]));

/** Midnight UTC some days ahead, so a window built from it lands predictably in Phoenix local time. */
const dayAhead = (n) => {
  const d = new Date(Date.now() + n * DAY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
/** Phoenix is UTC-7 year round, so 07:00 local is 14:00 UTC. */
const phoenix = (dayStartUtc, hour) => dayStartUtc + (hour + 7) * HOUR;

function assertFailureCode(expected) {
  return (err) => {
    assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err?.constructor?.name}`);
    assert.equal(err.details?.code, expected, `expected ${expected}, got ${err.details?.code}`);
    return true;
  };
}

// =================================================================================================
// Working availability
// =================================================================================================

await check("working availability: a recurring schedule is stored whole, with its zone, actor and audit", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  assert.equal(await workingAvailabilityDoc(technicianId), null, "precondition: unrecorded, not empty");

  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, {
      technicianId,
      timeZone: ZONE,
      weeklyHours: {
        1: [{ start: "07:00", end: "12:00" }, { start: "13:00", end: "16:00" }], // a real lunch gap
        2: [{ start: "07:00", end: "16:00" }],
        0: [], // an explicitly non-working Sunday -- a choice somebody made, not an absence
      },
    }),
  );

  const doc = await workingAvailabilityDoc(technicianId);
  assert.equal(doc.technicianId, technicianId);
  assert.equal(doc.timeZone, ZONE);
  assert.equal(doc.updatedByUid, dispatcherUid);
  assert.ok(doc.updatedAt);
  assert.equal(doc.weeklyHours["1"].length, 2, "the lunch gap survived the write");
  assert.deepEqual(doc.weeklyHours["0"], [], "and so did the explicitly empty Sunday");

  const audits = await auditEvents({ action: "setTechnicianWorkingAvailability", targetId: technicianId });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].targetType, "technician");
  assert.equal(audits[0].actorUid, dispatcherUid);
  assert.match(audits[0].summary, new RegExp(ZONE));
});

await check("working availability: a second write REPLACES the record rather than merging into it", async () => {
  // Whole-record replacement is the design (schedulingCommands.ts): a partial update of a weekly
  // schedule is how a Tuesday nobody meant to keep survives a change.
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianId, timeZone: ZONE, weeklyHours: { 1: [{ start: "07:00", end: "16:00" }], 2: [{ start: "07:00", end: "16:00" }] } }),
  );
  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianId, timeZone: "UTC", weeklyHours: { 1: [{ start: "09:00", end: "17:00" }] } }),
  );

  const doc = await workingAvailabilityDoc(technicianId);
  assert.equal(doc.timeZone, "UTC");
  assert.deepEqual(Object.keys(doc.weeklyHours), ["1"], "Tuesday is gone, not merged forward");
  assert.equal(doc.weeklyHours["1"][0].start, "09:00");
  assert.equal((await auditEvents({ action: "setTechnicianWorkingAvailability", targetId: technicianId })).length, 2);
});

await check("working availability: an unknown technician, a bad zone and a reversed interval are all REFUSED with nothing written", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  await assert.rejects(
    setTechnicianWorkingAvailabilityCallable.run(
      callReq(dispatcherUid, { technicianId: nextId("ghost"), timeZone: ZONE, weeklyHours: WEEKDAY_HOURS }),
    ),
    assertFailureCode("TECHNICIAN_NOT_FOUND"),
  );
  await assert.rejects(
    setTechnicianWorkingAvailabilityCallable.run(
      callReq(dispatcherUid, { technicianId, timeZone: "Not/AZone", weeklyHours: WEEKDAY_HOURS }),
    ),
    assertFailureCode("INVALID_INPUT"),
  );
  // Refused rather than silently dropped: storing a record whose DISPLAYED hours and ENFORCED hours
  // differ is the exact disagreement this domain exists to prevent.
  await assert.rejects(
    setTechnicianWorkingAvailabilityCallable.run(
      callReq(dispatcherUid, { technicianId, timeZone: ZONE, weeklyHours: { 1: [{ start: "16:00", end: "07:00" }] } }),
    ),
    assertFailureCode("INVALID_INPUT"),
  );

  assert.equal(await workingAvailabilityDoc(technicianId), null, "no partial record was written by any refusal");
  assert.equal((await auditEvents({ action: "setTechnicianWorkingAvailability", targetId: technicianId })).length, 0);
});

await check("working availability: a technician may not set availability, and an unauthenticated caller may not call", async () => {
  const { technicianId } = await seedTechnicianWithRecord();
  const { uid: techUid } = await seedTechnician();
  const payload = { technicianId, timeZone: ZONE, weeklyHours: WEEKDAY_HOURS };

  await assert.rejects(
    setTechnicianWorkingAvailabilityCallable.run(callReq(techUid, payload)),
    assertFailureCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    setTechnicianWorkingAvailabilityCallable.run(callReq(null, payload)),
    (e) => e instanceof HttpsError && e.code === "unauthenticated",
  );
  assert.equal(await workingAvailabilityDoc(technicianId), null);
});

// =================================================================================================
// Blocked time
// =================================================================================================

await check("blocked time: a governed absence is created, audited, and readable back", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = dayAhead(30) + 9 * HOUR;
  const { blockId } = await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "TRAINING", startMillis: start, endMillis: start + 4 * HOUR, note: "  refrigerant cert  " }),
  );
  assert.ok(blockId);

  const blocks = await blockedTimeDocs(technicianId);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].blockId, blockId);
  assert.equal(blocks[0].kind, "TRAINING");
  assert.equal(blocks[0].startMillis, start);
  assert.equal(blocks[0].note, "refrigerant cert", "trimmed on the way in");
  assert.equal(blocks[0].createdByUid, dispatcherUid);

  const audits = await auditEvents({ action: "createTechnicianBlockedTime", targetId: technicianId });
  assert.equal(audits.length, 1);
  assert.match(audits[0].summary, /TRAINING/);
  assert.match(audits[0].summary, new RegExp(blockId));
});

await check("blocked time: an absence is recorded even when work is ALREADY scheduled across it", async () => {
  // Deliberate design, asserted so it is not later "fixed" into a refusal: someone going on PTO must
  // never be refused because a job was already placed there. The absence is the fact and the
  // placement is the problem -- the board surfaces the collision and a person decides.
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const start = dayAhead(31) + 15 * HOUR;
  await createScheduledWorkOrder({ adminUid, dispatcherUid, technicianId, startMillis: start, endMillis: start + HOUR });

  const { blockId } = await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "PTO", startMillis: start, endMillis: start + 2 * HOUR }),
  );
  assert.ok(blockId, "recording the absence succeeded despite the existing placement");
  assert.equal((await blockedTimeDocs(technicianId)).length, 1);
});

await check("blocked time: an ungoverned kind, a reversed window and an unknown technician are REFUSED with nothing written", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const start = dayAhead(32);

  await assert.rejects(
    createTechnicianBlockedTimeCallable.run(callReq(dispatcherUid, { technicianId, kind: "VACATION", startMillis: start, endMillis: start + HOUR })),
    assertFailureCode("INVALID_INPUT"),
  );
  await assert.rejects(
    createTechnicianBlockedTimeCallable.run(callReq(dispatcherUid, { technicianId, kind: "PTO", startMillis: start + HOUR, endMillis: start })),
    assertFailureCode("INVALID_INPUT"),
  );
  await assert.rejects(
    createTechnicianBlockedTimeCallable.run(callReq(dispatcherUid, { technicianId: nextId("ghost"), kind: "PTO", startMillis: start, endMillis: start + HOUR })),
    assertFailureCode("TECHNICIAN_NOT_FOUND"),
  );

  assert.equal((await blockedTimeDocs(technicianId)).length, 0, "no orphan blocked-time record from any refusal");
  assert.equal((await auditEvents({ action: "createTechnicianBlockedTime", targetId: technicianId })).length, 0);
});

await check("blocked time: deleting one removes it, audits the removal, and frees the window it was refusing", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const { rescheduleWorkOrderCallable } = await import("../../lib/scheduling/schedulingCallables.js");

  const day = dayAhead(33);
  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: phoenix(day, 8), endMillis: phoenix(day, 9),
  });

  const blockStart = phoenix(day, 13);
  const { blockId } = await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "MEETING", startMillis: blockStart, endMillis: blockStart + 2 * HOUR }),
  );

  // While the block stands, the window is refused.
  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, { workOrderId, scheduledStart: blockStart, scheduledEnd: blockStart + HOUR, reason: "into the meeting" }),
    ),
    assertFailureCode("BLOCKED_TIME_CONFLICT"),
  );

  await deleteTechnicianBlockedTimeCallable.run(callReq(dispatcherUid, { blockId }));
  assert.equal((await blockedTimeDocs(technicianId)).length, 0);

  const audits = await auditEvents({ action: "deleteTechnicianBlockedTime", targetId: technicianId });
  assert.equal(audits.length, 1, "a vanished absence is explicable");
  assert.match(audits[0].summary, /MEETING/);
  assert.match(audits[0].summary, new RegExp(blockId));

  // And the same placement now succeeds -- proof the refusal was driven by the record, not a cache.
  await rescheduleWorkOrderCallable.run(
    callReq(dispatcherUid, { workOrderId, scheduledStart: blockStart, scheduledEnd: blockStart + HOUR, reason: "meeting cancelled" }),
  );
});

await check("blocked time: deleting a record that does not exist is refused, and deletion is dispatcher-only", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const { uid: techUid } = await seedTechnician();

  const start = dayAhead(34);
  const { blockId } = await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "TRUCK_SERVICE", startMillis: start, endMillis: start + HOUR }),
  );

  await assert.rejects(
    deleteTechnicianBlockedTimeCallable.run(callReq(dispatcherUid, { blockId: nextId("ghost") })),
    assertFailureCode("INVALID_INPUT"),
  );
  await assert.rejects(
    deleteTechnicianBlockedTimeCallable.run(callReq(techUid, { blockId })),
    assertFailureCode("PERMISSION_DENIED"),
  );
  assert.equal((await blockedTimeDocs(technicianId)).length, 1, "the record survived both refusals");
});

// =================================================================================================
// The trusted read projection
// =================================================================================================

await check("trusted read: returns the combined governed facts the scheduler needs, with capacity net of blocked time", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianId, timeZone: ZONE, weeklyHours: WEEKDAY_HOURS }),
  );

  const day = dayAhead(40);
  // A two-hour meeting inside the working day.
  const blockStart = phoenix(day, 10);
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "MEETING", startMillis: blockStart, endMillis: blockStart + 2 * HOUR }),
  );
  // And one entirely OUTSIDE it, which must consume no capacity at all.
  const nightStart = phoenix(day, 22);
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "UNAVAILABLE", startMillis: nightStart, endMillis: nightStart + HOUR }),
  );

  const result = await readTechnicianAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianIds: [technicianId], startMillis: phoenix(day, 0), endMillis: phoenix(day, 24) }),
  );

  assert.equal(result.technicians.length, 1);
  const view = result.technicians[0];
  assert.equal(view.technicianId, technicianId);
  assert.equal(view.workingAvailability.timeZone, ZONE, "the board gets the zone it must draw in");
  assert.equal(view.blockedTime.length, 2, "both blocks are visible to the board, wherever they fall");

  // Nine recorded working hours (07:00-16:00), minus the two-hour meeting that lands inside them.
  // The night block overlaps no working time, so it takes nothing.
  assert.equal(view.availableMinutes, 9 * 60 - 2 * 60);
});

await check("trusted read: an unrecorded schedule comes back as null capacity, never as zero", async () => {
  // The single most consequential rule in the domain, asserted against the real projection. Percent
  // booked over an unknown denominator is unanswerable -- a board showing 0% would be reporting our
  // data entry as though it were the business.
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();

  const day = dayAhead(41);
  const result = await readTechnicianAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianIds: [technicianId], startMillis: phoenix(day, 0), endMillis: phoenix(day, 24) }),
  );

  const view = result.technicians[0];
  assert.equal(view.workingAvailability, null);
  assert.equal(view.availableMinutes, null, "null, NOT 0");
  assert.deepEqual(view.blockedTime, []);
});

await check("trusted read: only blocks overlapping the requested window come back", async () => {
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const day = dayAhead(42);

  const inside = phoenix(day, 9);
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "LUNCH", startMillis: inside, endMillis: inside + HOUR }),
  );
  // A block a week later, well outside the requested day.
  const far = phoenix(day + 7 * DAY, 9);
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "PTO", startMillis: far, endMillis: far + HOUR }),
  );
  // A long closure that BEGAN before the window and is still running inside it -- the record most
  // worth catching, and the reason the query narrows on endMillis rather than startMillis.
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "COMPANY_CLOSURE", startMillis: day - 3 * DAY, endMillis: phoenix(day, 12) }),
  );

  const result = await readTechnicianAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianIds: [technicianId], startMillis: phoenix(day, 0), endMillis: phoenix(day, 24) }),
  );
  const kinds = result.technicians[0].blockedTime.map((b) => b.kind).sort();
  assert.deepEqual(kinds, ["COMPANY_CLOSURE", "LUNCH"], "the straddling closure is included, the far-future PTO is not");
});

await check("trusted read: an invalid window is refused, and a technician may not read the roster", async () => {
  const dispatcherUid = await seedDispatcher();
  const { uid: techUid } = await seedTechnician();
  const { technicianId } = await seedTechnicianWithRecord();
  const day = dayAhead(43);

  await assert.rejects(
    readTechnicianAvailabilityCallable.run(callReq(dispatcherUid, { technicianIds: [technicianId], startMillis: day + HOUR, endMillis: day })),
    assertFailureCode("INVALID_INPUT"),
  );
  await assert.rejects(
    readTechnicianAvailabilityCallable.run(callReq(techUid, { technicianIds: [technicianId], startMillis: day, endMillis: day + HOUR })),
    assertFailureCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    readTechnicianAvailabilityCallable.run(callReq(null, { technicianIds: [technicianId], startMillis: day, endMillis: day + HOUR })),
    (e) => e instanceof HttpsError && e.code === "unauthenticated",
  );
});

await check("trusted read: the board's no-argument form returns every technician, including the ones with nothing recorded", async () => {
  // How the Dispatch board actually calls it: no id list, just a window. A technician with no
  // availability record must still appear, carrying nulls -- omitting them would make the board
  // silently short a lane.
  const dispatcherUid = await seedDispatcher();
  const recorded = await seedTechnicianWithRecord();
  const unrecorded = await seedTechnicianWithRecord();
  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianId: recorded.technicianId, timeZone: ZONE, weeklyHours: WEEKDAY_HOURS }),
  );

  const day = dayAhead(44);
  const result = await readTechnicianAvailabilityCallable.run(
    callReq(dispatcherUid, { startMillis: phoenix(day, 0), endMillis: phoenix(day, 24) }),
  );

  const byId = new Map(result.technicians.map((t) => [t.technicianId, t]));
  assert.ok(byId.has(recorded.technicianId), "the recorded technician is present");
  assert.ok(byId.has(unrecorded.technicianId), "and so is the unrecorded one");
  assert.equal(byId.get(recorded.technicianId).availableMinutes, 9 * 60);
  assert.equal(byId.get(unrecorded.technicianId).availableMinutes, null);
  assert.equal(result.startMillis, phoenix(day, 0), "the window it answered for is echoed back");
});

await check("trusted read and the commands agree: the same block that the board draws is the one the server refuses", async () => {
  // The disagreement guard, stated as a test. Board and enforcement run the same pure functions over
  // the same documents, so a window the projection reports as blocked must be a window a placement
  // cannot be committed into.
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const { rescheduleWorkOrderCallable } = await import("../../lib/scheduling/schedulingCallables.js");

  const day = dayAhead(45);
  await setTechnicianWorkingAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianId, timeZone: ZONE, weeklyHours: WEEKDAY_HOURS }),
  );
  const blockStart = phoenix(day, 11);
  await createTechnicianBlockedTimeCallable.run(
    callReq(dispatcherUid, { technicianId, kind: "PTO", startMillis: blockStart, endMillis: blockStart + 3 * HOUR }),
  );

  const workOrderId = await createScheduledWorkOrder({
    adminUid, dispatcherUid, technicianId, startMillis: phoenix(day, 8), endMillis: phoenix(day, 9),
  });

  const view = (await readTechnicianAvailabilityCallable.run(
    callReq(dispatcherUid, { technicianIds: [technicianId], startMillis: phoenix(day, 0), endMillis: phoenix(day, 24) }),
  )).technicians[0];
  const drawn = view.blockedTime.find((b) => b.startMillis === blockStart);
  assert.ok(drawn, "the board would draw this block");

  await assert.rejects(
    rescheduleWorkOrderCallable.run(
      callReq(dispatcherUid, { workOrderId, scheduledStart: drawn.startMillis, scheduledEnd: drawn.startMillis + HOUR, reason: "into the block the board drew" }),
    ),
    assertFailureCode("BLOCKED_TIME_CONFLICT"),
    "and the server refuses exactly that window",
  );

  // Capacity agrees too: nine working hours less the three-hour PTO that lands inside them.
  assert.equal(view.availableMinutes, 9 * 60 - 3 * 60);
});

// CLIENT-DIRECT ACCESS. Not asserted here, and the reason is structural rather than an omission:
// every callable above runs on the Admin SDK, which bypasses firestore.rules by design, so a
// "a client cannot read technician_blocked_time" check made through this harness would pass whatever
// the ruleset said. That boundary is the Rules regression lane's (functions/scripts/
// rulesRegressionRunner.mjs, `npm run test:rules`), which drives the CLIENT SDK against the ruleset
// and is where the two new deny-all blocks are covered.
process.exit(summarize() ? 0 : 1);
