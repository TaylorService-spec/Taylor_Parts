// The sandbox Dispatch fixtures must be facts the REAL scheduling domain can read.
//
// ============================ WHY THIS SUITE EXISTS ============================
//
// The Dispatch Quick Gate failed four checks against a fully correct board because the sandbox had
// nothing representative to draw: the only SCHEDULED Work Order carried no window (a state the
// governed `Schedule` action could never have produced, since it requires all three fields), and no
// technician had recorded working hours at all.
//
// A fixture that is merely *present* is not enough — it has to be readable by the code that will
// consume it. So these assertions run the fixture through the SAME pure availability model the
// scheduling commands and the board's projection both use (`lib/scheduling/availabilityModel.js`),
// rather than re-describing what the shape ought to be. If the canonical shape changes, this goes
// red instead of the sandbox going quietly blank.
//
// Prerequisite: `npm run build` in functions/ (imports lib/).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const {
  SANDBOX_TIMEZONE, SANDBOX_SHIFT, SCHEDULED_START_HOUR_LOCAL, SCHEDULED_DURATION_HOURS,
  buildScheduledWindow, buildSecondScheduledWindow, buildTechnicianAvailability, localDateParts,
} = require_("../scripts/sandboxDispatchFixtures.js");

const {
  assessWorkingHours, availableMinutesInWindow, localWallClock, minutesOutsideWorkingHours,
} = await import("../lib/scheduling/availabilityModel.js");

const availability = buildTechnicianAvailability({
  technicianId: "tech-sbx-01", updatedByUid: "sandbox-transactional-seed", scenarioId: "SBX-SCN-001",
});
const NOW = Date.now();
const win = buildScheduledWindow(NOW);
const win2 = buildSecondScheduledWindow(NOW);
const HOUR = 3600_000;

// ---------------------------------------------------------------------------------------------
// The scheduled Work Order's window
// ---------------------------------------------------------------------------------------------

test("the scheduled fixture has a genuine window: ordered, bounded, and the intended duration", () => {
  assert.ok(Number.isSafeInteger(win.startMillis) && win.startMillis > 0);
  assert.ok(Number.isSafeInteger(win.endMillis) && win.endMillis > 0);
  assert.ok(win.endMillis > win.startMillis, "end must be after start — a SCHEDULED record needs a real window");
  assert.equal(win.endMillis - win.startMillis, SCHEDULED_DURATION_HOURS * HOUR);
});

test("the window lands on TODAY in the fixture's own zone, at the intended local hour", () => {
  const local = localWallClock(win.startMillis, SANDBOX_TIMEZONE);
  assert.ok(local, "the zone must be one the runtime knows");
  assert.equal(local.minutes, SCHEDULED_START_HOUR_LOCAL * 60, "start must be 09:00 local");

  const today = localDateParts(NOW);
  const expected = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  assert.equal(local.dateKey, expected, "the window must fall on the run's own local day, not a drifting literal date");
});

test("the window is anchored to the run instant, so the fixture cannot decay into an empty day", () => {
  // A literal date would slide into the past and the board would open on nothing to draw — the exact
  // state this fixture exists to prevent. Same instant in, same window out; a day later, a day later.
  const a = buildScheduledWindow(NOW);
  const b = buildScheduledWindow(NOW);
  assert.deepEqual(a, b, "same instant must produce the same window");

  const tomorrow = buildScheduledWindow(NOW + 24 * HOUR);
  assert.equal(tomorrow.startMillis - a.startMillis, 24 * HOUR, "a day later must place it a day later");
});

// ---------------------------------------------------------------------------------------------
// The availability record, through the real model
// ---------------------------------------------------------------------------------------------

test("the availability fixture is in the canonical governed shape", () => {
  assert.equal(availability.technicianId, "tech-sbx-01");
  assert.equal(availability.timeZone, SANDBOX_TIMEZONE);
  assert.equal(availability.updatedByUid, "sandbox-transactional-seed");
  // Weekday keys are the STRING form of 0–6, which is what the model indexes by.
  assert.deepEqual(Object.keys(availability.weeklyHours).sort(), ["0", "1", "2", "3", "4", "5", "6"]);
  for (const day of Object.values(availability.weeklyHours)) {
    assert.deepEqual(day, [{ start: SANDBOX_SHIFT.start, end: SANDBOX_SHIFT.end }]);
  }
});

test("the REAL availability model reads the fixture and reports a real shift, not null", () => {
  // The board's "Shift not recorded" comes from this returning null. This is the assertion that the
  // Quick Gate's A3 check depends on.
  const dayStart = win.startMillis - SCHEDULED_START_HOUR_LOCAL * HOUR; // 00:00 local
  const minutes = availableMinutesInWindow(availability, { startMillis: dayStart, endMillis: dayStart + 24 * HOUR });
  assert.notEqual(minutes, null, "a recorded schedule must not read as unrecorded");
  assert.equal(minutes, 9 * 60, "07:00–16:00 is nine hours of recorded working time");
});

test("the seeded placement is INSIDE recorded working hours — no warning", () => {
  assert.equal(minutesOutsideWorkingHours(availability, win.startMillis, win.endMillis), 0);
  const { warnings } = assessWorkingHours(availability, win.startMillis, win.endMillis);
  assert.deepEqual(warnings, [], `expected a clean placement, got ${JSON.stringify(warnings)}`);
});

test("an off-hours placement on the same fixture is WARNING-only, never a refusal (ND-20)", () => {
  // The representative off-hours case, proved against the fixture rather than by seeding a second
  // Work Order the scenario does not need. 05:00–06:00 local is before the 07:00 shift.
  const dayStart = win.startMillis - SCHEDULED_START_HOUR_LOCAL * HOUR;
  const early = dayStart + 5 * HOUR;
  const { warnings } = assessWorkingHours(availability, early, early + HOUR);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "OUTSIDE_WORKING_HOURS");
  // assessWorkingHours returns warnings and never throws — outside-hours is not a refusal. The hard
  // refusals (blocked time, past start, unknown technician, overlap) live in placementPolicy and are
  // untouched by this fixture.
});

test("every weekday draws a shift — a weekend placement is representable", () => {
  // The weekly board renders all seven days, and a job placed on a Saturday must not become
  // silently undrawable. Walk a full week from the seeded day.
  const dayStart = win.startMillis - SCHEDULED_START_HOUR_LOCAL * HOUR;
  for (let d = 0; d < 7; d += 1) {
    const start = dayStart + d * 24 * HOUR + 9 * HOUR;
    assert.equal(minutesOutsideWorkingHours(availability, start, start + HOUR), 0,
      `day offset ${d} must be inside recorded hours`);
  }
});

// ---------------------------------------------------------------------------------------------
// The second placement — what makes chip geometry provable
// ---------------------------------------------------------------------------------------------

test("a SECOND placement exists on the SAME day at a DIFFERENT hour", () => {
  // One chip cannot prove the board draws time: a single chip is consistent with a board that places
  // everything at 0%. The Quick Gate compares left offsets and requires more than one distinct value.
  assert.notEqual(win2.startMillis, win.startMillis, "the two placements must not share a start");
  const a = localWallClock(win.startMillis, SANDBOX_TIMEZONE);
  const b = localWallClock(win2.startMillis, SANDBOX_TIMEZONE);
  assert.equal(a.dateKey, b.dateKey, "both must fall on the SAME local day or the board draws one of them");
  assert.notEqual(a.minutes, b.minutes, "different local hour — distinct left offsets");
});

test("the two placements do not overlap, so they are not a disguised double-booking", () => {
  const overlap = win.startMillis < win2.endMillis && win2.startMillis < win.endMillis;
  assert.equal(overlap, false);
});

test("the second placement is also inside recorded hours, measured against the real model", () => {
  // It is seeded onto tech-sbx-02, which has NO recorded availability — so nothing warns about it in
  // practice. Asserted against the recorded shift anyway: if a later change gives that technician
  // hours, the placement should already sit inside them rather than start warning.
  assert.equal(minutesOutsideWorkingHours(availability, win2.startMillis, win2.endMillis), 0);
});

// ---------------------------------------------------------------------------------------------
// Determinism and boundaries
// ---------------------------------------------------------------------------------------------

test("re-running the seeder recreates the same facts — fixed ids, no drift", () => {
  // seedSandboxTransactional writes with { merge: true } at fixed document ids, so re-running is the
  // recreate. This pins the part that could silently vary: the record's content.
  const again = buildTechnicianAvailability({
    technicianId: "tech-sbx-01", updatedByUid: "sandbox-transactional-seed", scenarioId: "SBX-SCN-001",
  });
  assert.deepEqual(again, availability);
});

test("only ONE technician is given recorded hours, so the unrecorded path stays live", () => {
  // The board's honesty rules — "unrecorded availability says so" and "no lane renders a fake 0%" —
  // only mean something while an unrecorded technician exists to prove them on. If a later change
  // seeds availability for everyone, those Quick Gate checks pass vacuously.
  const src = require_("node:fs").readFileSync(
    new URL("../scripts/seedSandboxTransactional.js", import.meta.url), "utf8",
  );
  const writes = src.match(/await set\(AVAILABILITY,/g) ?? [];
  assert.equal(writes.length, 1, "exactly one availability record should be seeded");
  assert.ok(/await set\(AVAILABILITY, "tech-sbx-01"/.test(src));
  assert.ok(!/await set\(AVAILABILITY, "tech-sbx-02"/.test(src), "tech-sbx-02 must stay unrecorded");
});

test("the deny-all client boundary is not weakened by these fixtures", () => {
  // The seed writes through the Admin SDK, which bypasses Rules by design. That is not a Rules
  // change and must not become one: firestore.rules must still deny every client read and write on
  // both availability collections.
  const rules = require_("node:fs").readFileSync(
    new URL("../../firestore.rules", import.meta.url), "utf8",
  ).replace(/\r\n/g, "\n");
  for (const collection of ["technician_working_availability", "technician_blocked_time"]) {
    const m = new RegExp(`match /${collection}/\\{[^}]+\\} \\{\\s*\\n\\s*allow read, write: if false;`).exec(rules);
    assert.ok(m, `${collection} must remain deny-all for every client`);
  }
});
