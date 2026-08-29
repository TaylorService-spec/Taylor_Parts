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
  buildScheduledWindow, buildSecondScheduledWindow, buildOutsideBandWindow, buildWeekendWindow,
  buildTechnicianAvailability, localDateParts, DAY_PLACEMENT_OFFSET_DAYS,
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
const outsideBand = buildOutsideBandWindow(NOW);
const weekend = buildWeekendWindow(NOW);
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

test("the window lands on TOMORROW in the fixture's own zone, at the intended local hour", () => {
  const local = localWallClock(win.startMillis, SANDBOX_TIMEZONE);
  assert.ok(local, "the zone must be one the runtime knows");
  assert.equal(local.minutes, SCHEDULED_START_HOUR_LOCAL * 60, "start must be 09:00 local");

  // Tomorrow, not today: a 09:00 window seeded at three in the afternoon would already be over. It
  // is still derived from the run instant, so it never decays into a fixed past date either.
  const tomorrow = localDateParts(NOW + DAY_PLACEMENT_OFFSET_DAYS * 24 * HOUR);
  const expected = `${tomorrow.year}-${String(tomorrow.month).padStart(2, "0")}-${String(tomorrow.day).padStart(2, "0")}`;
  assert.equal(local.dateKey, expected, "the window must be derived from the run instant, not a drifting literal date");
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
// Outside-band and weekend — the two visual-acceptance states
// ---------------------------------------------------------------------------------------------

/** The board's default display band, read from the client source so this cannot drift from it. */
function boardBand() {
  const src = require_("node:fs").readFileSync(
    new URL("../../field-ops-app-vite/src/domain/dispatchBoardGeometry.js", import.meta.url), "utf8",
  );
  const start = /DAY_BAND_START_HOUR\s*=\s*(\d+)/.exec(src);
  const end = /DAY_BAND_END_HOUR\s*=\s*(\d+)/.exec(src);
  assert.ok(start && end, "could not read the board's band constants");
  return { startHour: Number(start[1]), endHour: Number(end[1]) };
}

test("the outside-band fixture really is outside the board's default band", () => {
  // Read from dispatchBoardGeometry.js rather than hardcoded: if the band is ever widened to include
  // 18:30, this fixture stops proving anything and should go red rather than quietly pass.
  const band = boardBand();
  const local = localWallClock(outsideBand.startMillis, SANDBOX_TIMEZONE);
  assert.ok(local.minutes / 60 >= band.endHour,
    `${local.minutes / 60}:00 must be at or after the band end ${band.endHour}:00`);
  // 18:30 exactly — Date.UTC coerces its hour argument to an integer, so a fractional start hour
  // silently floors to 18:00. Asserted to the minute because that half hour is otherwise invisible.
  assert.equal(local.minutes, 18 * 60 + 30, "start must be 18:30 local, not 18:00");
});

test("the outside-band fixture is a LEGAL governed placement — warned, not refused", () => {
  const { warnings } = assessWorkingHours(availability, outsideBand.startMillis, outsideBand.endMillis);
  assert.equal(warnings.length, 1, "an evening placement outside a 07:00–16:00 shift should warn");
  assert.equal(warnings[0].code, "OUTSIDE_WORKING_HOURS");
  // A warning is the whole point: the record must exist on the board as legitimately placed work.
  // The hard refusals live in placementPolicy and none of them applies here — the window is in the
  // future, the technician is governed and eligible, nothing is blocked, nothing overlaps.
  assert.ok(outsideBand.startMillis > NOW, "must not be in the past");
});

test("the weekend fixture lands on a weekend for EVERY possible seed weekday", () => {
  // The requirement is that this holds whether the seed runs on a Monday or a Saturday — so it is
  // proved across all seven, not just today's.
  for (let offset = 0; offset < 7; offset += 1) {
    const instant = NOW + offset * 24 * HOUR;
    const w = buildWeekendWindow(instant);
    const local = localWallClock(w.startMillis, SANDBOX_TIMEZONE);
    assert.ok(local.weekday === 6 || local.weekday === 0,
      `seeded at offset ${offset}, landed on weekday ${local.weekday} — must be Saturday or Sunday`);

    // And never on the run's own day, so it cannot collide with the weekday placements when the
    // seeder happens to run at a weekend.
    const runDay = localDateParts(instant);
    const runKey = `${runDay.year}-${String(runDay.month).padStart(2, "0")}-${String(runDay.day).padStart(2, "0")}`;
    assert.notEqual(local.dateKey, runKey, `offset ${offset}: weekend fixture must not land on the run date`);
    assert.ok(w.startMillis > instant, "and must be in the future");
  }
});

test("the weekend fixture is a LEGAL governed placement, inside recorded hours", () => {
  // Deliberately NOT also an off-hours case. One fixture, one behaviour: this proves weekend geometry
  // and nothing else, so a failure points at one thing.
  assert.equal(minutesOutsideWorkingHours(availability, weekend.startMillis, weekend.endMillis), 0);
  assert.deepEqual(assessWorkingHours(availability, weekend.startMillis, weekend.endMillis).warnings, []);
});

test("no two seeded placements overlap, across every technician", () => {
  // tech-sbx-01 carries three of the four. An overlap would be a double-booking the domain forbids —
  // seeded data must not assert a state the commands would refuse.
  const byTech = {
    "tech-sbx-01": [win, outsideBand, weekend],
    "tech-sbx-02": [win2],
  };
  for (const [tech, windows] of Object.entries(byTech)) {
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i]; const b = windows[j];
        assert.equal(a.startMillis < b.endMillis && b.startMillis < a.endMillis, false,
          `${tech}: placements ${i} and ${j} overlap`);
      }
    }
  }
});

test("no fixture is already in the past at seed time", () => {
  for (const [label, w] of [["first", win], ["second", win2], ["outsideBand", outsideBand], ["weekend", weekend]]) {
    assert.ok(w.endMillis > NOW, `${label} must not be seeded already finished`);
  }
});

test("at least two technicians are represented across the placements", () => {
  const src = require_("node:fs").readFileSync(
    new URL("../scripts/seedSandboxTransactional.js", import.meta.url), "utf8",
  );
  const scheduledTechs = new Set([...src.matchAll(/scheduledTechId: "(tech-sbx-\d+)"/g)].map((m) => m[1]));
  assert.ok(scheduledTechs.size >= 2, `expected >=2 technicians on placements, got ${[...scheduledTechs].join(", ")}`);
});

// ---------------------------------------------------------------------------------------------
// Determinism and boundaries
// ---------------------------------------------------------------------------------------------

test("changing the supplied instant preserves the intended relative cases", () => {
  // The fixture set must keep MEANING as time moves, not just keep running. A month from now the
  // outside-band case must still be outside the band and the weekend case must still be a weekend.
  const later = NOW + 31 * 24 * HOUR;
  const band = boardBand();

  const l1 = localWallClock(buildScheduledWindow(later).startMillis, SANDBOX_TIMEZONE);
  assert.equal(l1.minutes, SCHEDULED_START_HOUR_LOCAL * 60);

  const l3 = localWallClock(buildOutsideBandWindow(later).startMillis, SANDBOX_TIMEZONE);
  assert.ok(l3.minutes / 60 >= band.endHour, "still outside the band a month later");

  const l4 = localWallClock(buildWeekendWindow(later).startMillis, SANDBOX_TIMEZONE);
  assert.ok(l4.weekday === 6 || l4.weekday === 0, "still a weekend a month later");
});

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

test("a DECISIONS-only change triggers the lane that regenerates the artifact depending on it", () => {
  // THE STALE-ARTIFACT PATH THIS CLOSES. `precedenceSweep.mjs` pins a hash of docs/DECISIONS.md and
  // the role-governance lane both regenerates that artifact and fails on drift — but the lane did not
  // trigger on DECISIONS.md itself. So a decision could be appended, the artifact left stale, and the
  // failure surface later on an unrelated branch. That is not hypothetical: it happened with #1545,
  // and it cost a repair commit on the Dispatch scheduling branch.
  //
  // Asserted on BOTH trigger blocks. Adding it to `pull_request` alone would still let a direct push
  // to main leave the artifact stale.
  const yml = require_("node:fs").readFileSync(
    new URL("../../.github/workflows/role-governance-tests.yml", import.meta.url), "utf8",
  ).replace(/\r\n/g, "\n");

  const blocks = [];
  let current = null;
  for (const line of yml.split("\n")) {
    if (/^\s*paths:\s*$/.test(line)) { current = []; blocks.push(current); continue; }
    if (!current) continue;
    const entry = /^\s*- "(.+)"\s*$/.exec(line);
    if (entry) current.push(entry[1]);
    else if (line.trim() && !line.trim().startsWith("#")) current = null;
  }

  assert.equal(blocks.length, 2, "expected a pull_request and a push paths block");
  for (const [i, block] of blocks.entries()) {
    assert.ok(block.includes("docs/DECISIONS.md"),
      `paths block ${i + 1} must trigger on docs/DECISIONS.md — the sweep hashes it`);
    // And the artifact the lane regenerates must itself be reachable, or the guard has nothing to
    // compare against.
    assert.ok(block.some((p) => p.startsWith("functions/scripts/governance/")),
      `paths block ${i + 1} must also trigger on the generator that writes the artifact`);
  }
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
