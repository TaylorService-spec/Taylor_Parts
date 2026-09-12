// Dispatch & Scheduler -- ND-25: one technician's absences may not overlap each other.
//
// ════════════════════ WHAT THIS SUITE IS FOR ════════════════════
//
// `technician_blocked_time` had no uniqueness or exclusion rule of any kind. Nothing stopped two
// records for the same technician from covering the same minutes -- not a constraint, not a check,
// not an idempotency key on the command that creates them. A double-clicked PTO form was enough.
//
// That was not merely untidy. Two consumers in this repository answer "how many minutes are blocked"
// with two different arithmetics:
//
//   functions/src/scheduling/availabilityModel.ts   blockedMinutesInWindow   walks minutes -> UNION
//   field-ops-app-vite/src/domain/dispatchBoardGeometry.js  blockedMinutesInBand  sums durations -> SUM
//
// They agree exactly while no two blocks overlap, and only while that holds. Both numbers are drawn
// on the same dispatch lane. Section 3 below makes that divergence concrete rather than asserted.
//
// The fix removes the divergence STRUCTURALLY -- it makes overlap impossible at the write path, so
// sum == union by construction and both readers are correct without either being rewritten. This
// suite holds the three things that fix depends on:
//
//   1. the overlap rule is the SHARED half-open test, not a second one specialised for blocks
//   2. the command takes the per-technician sentinel, so the guard is a real serialization and not a
//      query-then-insert that only looks like protection
//   3. the arithmetic the guard protects actually diverges under overlap, and agrees without it
//
// Section 2 reads SOURCE rather than importing, for the reason schedulingPlacementAuthorityContract
// .test.mjs already states: importing a module tells you what it exports; only reading it tells you
// what it duplicates -- or, here, what lock it forgot to take. The transactional behaviour itself is
// emulator territory (test/e2e/schedulingAvailabilityEmulator.test.mjs), and the emulator does not
// run in this environment.
//
// Prerequisite: `npm run build` in functions/ first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  blockedMinutesInWindow,
  findBlockedTimeConflict,
} from "../lib/scheduling/availabilityModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "src");
const COMMANDS = readFileSync(path.join(SRC, "scheduling", "schedulingCommands.ts"), "utf8");

const block = (blockId, kind, startMillis, endMillis) => ({
  blockId,
  technicianId: "tech-1",
  kind,
  startMillis,
  endMillis,
});

// Phoenix observes no daylight saving, so wall-clock arithmetic here is stable year round.
const ZONE = "America/Phoenix";
// 2026-08-27 is a Thursday (weekday 4), matching schedulingAvailabilityModel.test.mjs's baseline.
const MST = (hour, minute = 0) => Date.UTC(2026, 7, 27, hour + 7, minute);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The overlap rule, applied block-against-block
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Same function, same half-open test `checkPlacement` uses to refuse a PLACEMENT into blocked time.
// These cases exist so "back to back is fine" cannot come to mean one thing for a job and another
// for a lunch break.

test("ND-25: an identical duplicate absence is an overlap", () => {
  const existing = [block("b1", "PTO", MST(9), MST(17))];
  const found = findBlockedTimeConflict(existing, MST(9), MST(17));
  assert.equal(found?.blockId, "b1");
});

test("ND-25: an absence fully contained in another is an overlap", () => {
  const existing = [block("b1", "PTO", MST(9), MST(17))];
  assert.equal(findBlockedTimeConflict(existing, MST(12), MST(13))?.blockId, "b1");
});

test("ND-25: an absence that fully contains another is an overlap", () => {
  const existing = [block("b1", "LUNCH", MST(12), MST(13))];
  assert.equal(findBlockedTimeConflict(existing, MST(9), MST(17))?.blockId, "b1");
});

test("ND-25: a partial overlap at either end is an overlap", () => {
  const existing = [block("b1", "TRAINING", MST(9), MST(12))];
  assert.equal(findBlockedTimeConflict(existing, MST(11), MST(14))?.blockId, "b1");
  assert.equal(findBlockedTimeConflict(existing, MST(7), MST(10))?.blockId, "b1");
});

test("ND-25: back-to-back absences are NOT an overlap -- half-open, the same as placements", () => {
  // 12:00 ends, 12:00 starts. A morning block and an afternoon block share an instant and no minute.
  // Refusing this pair would refuse the ordinary way a split day is recorded.
  const existing = [block("b1", "MEETING", MST(9), MST(12))];
  assert.equal(findBlockedTimeConflict(existing, MST(12), MST(15)), null);
  assert.equal(findBlockedTimeConflict(existing, MST(6), MST(9)), null);
});

test("ND-25: a disjoint absence on the same day is NOT an overlap", () => {
  const existing = [block("b1", "LUNCH", MST(12), MST(13))];
  assert.equal(findBlockedTimeConflict(existing, MST(15), MST(16)), null);
});

test("ND-25: the FIRST overlapping record is returned, so the refusal can name one", () => {
  const existing = [
    block("b1", "PTO", MST(9), MST(11)),
    block("b2", "TRAINING", MST(10), MST(12)),
  ];
  const found = findBlockedTimeConflict(existing, MST(10, 30), MST(10, 45));
  assert.ok(found, "an overlap exists");
  assert.equal(typeof found.kind, "string", "the refusal can quote a kind");
  assert.equal(typeof found.blockId, "string", "the refusal can quote a block id");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The command is wired so the guard is real
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * A source body with its comments removed.
 *
 * The absence assertions below are claims about CODE. This module documents its own reasoning at
 * length and names `checkPlacement` while explaining why it deliberately does not call it -- so a
 * raw-text search would fail on correct code, and a contract test that cries wolf gets deleted.
 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** The body of one exported command in schedulingCommands.ts, to the start of the next export. */
function commandBody(name) {
  const start = COMMANDS.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} is exported from schedulingCommands.ts`);
  const rest = COMMANDS.slice(start + 1);
  const next = rest.indexOf("\nexport ");
  return next === -1 ? rest : rest.slice(0, next);
}

test("createTechnicianBlockedTime reaches the overlap decision through the SHARED functions", () => {
  assert.match(
    COMMANDS,
    /import \{ findBlockedTimeConflict \} from "\.\/availabilityModel"/,
    "the overlap test is imported, not reimplemented",
  );
  assert.match(
    COMMANDS,
    /import \{ db, loadBlockedTime, loadTechnician \} from "\.\/schedulingRepository"/,
    "the blocked-time read is the same transactional query checkPlacement uses -- and therefore the " +
      "same composite index, so this guard adds no new index requirement",
  );

  const body = commandBody("createTechnicianBlockedTime");
  assert.match(body, /loadBlockedTime\(tx, input\.technicianId, input\.startMillis\)/);
  assert.match(body, /findBlockedTimeConflict\(/);
  assert.match(body, /new SchedulingError\(\s*"BLOCKED_TIME_CONFLICT"/);

  // No second overlap arithmetic hiding in the command. `<` and `>` comparisons between two window
  // endpoints are exactly what a hand-rolled overlap test looks like.
  assert.doesNotMatch(
    codeOnly(body),
    /startMillis\s*<\s*\w+\.endMillis|endMillis\s*>\s*\w+\.startMillis/,
    "the command must not carry its own copy of the half-open overlap test",
  );
});

test("createTechnicianBlockedTime takes the per-technician sentinel -- READ and WRITE", () => {
  const body = commandBody("createTechnicianBlockedTime");

  // The read alone is not enough and that is the whole point of asserting both. A transactional
  // query locks the documents it RETURNS; a record that does not exist yet is not among them, so
  // without the sentinel in this transaction's WRITE set two concurrent creates would each query,
  // each find nothing, and each commit. That is the check-then-act race the guard exists to not be.
  assert.match(body, /const lockRef = db\(\)\.collection\(TECH_LOCKS_COLLECTION\)\.doc\(input\.technicianId\)/);
  assert.match(body, /await tx\.get\(lockRef\)/, "the sentinel is read inside the transaction");
  assert.match(body, /tx\.set\(lockRef,/, "the sentinel is WRITTEN, which is what forces contention");

  // Firestore requires every read before every write. The overlap query must therefore precede the
  // first write, or the transaction throws at runtime rather than refusing anything.
  const firstWrite = Math.min(
    ...[/tx\.set\(lockRef,/, /tx\.set\(ref,/]
      .map((re) => body.search(re))
      .filter((i) => i >= 0),
  );
  assert.ok(body.search(/loadBlockedTime\(/) < firstWrite, "the overlap query runs in the read phase");
  assert.ok(body.search(/await tx\.get\(lockRef\)/) < firstWrite, "the sentinel is read in the read phase");
});

test("deleteTechnicianBlockedTime contends on the same sentinel -- a release races a claim", () => {
  const body = commandBody("deleteTechnicianBlockedTime");
  assert.match(body, /TECH_LOCKS_COLLECTION/, "deletion serializes with creation for the same technician");
  assert.match(body, /await tx\.get\(lockRef\)/);
  assert.match(body, /tx\.set\(lockRef,/);
  assert.ok(
    body.search(/await tx\.get\(lockRef\)/) < body.search(/tx\.delete\(ref\)/),
    "read before write, as Firestore requires",
  );
});

test("recording an absence is still NOT refused because WORK is already placed there", () => {
  // The asymmetry is deliberate and must survive: someone going on PTO is a fact, and a job already
  // in that window is the dispatcher's problem to move, not this command's to refuse. ND-25 adds a
  // block-vs-block rule and must not have quietly added a block-vs-work one.
  const body = codeOnly(commandBody("createTechnicianBlockedTime"));
  assert.doesNotMatch(body, /findScheduleConflict|checkPlacement|SCHEDULE_CONFLICT/);
  assert.doesNotMatch(body, /WORK_ORDERS_COLLECTION/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. The divergence the guard closes
// ═══════════════════════════════════════════════════════════════════════════════════════════

const FULL_DAY_AVAILABILITY = {
  technicianId: "tech-1",
  timeZone: ZONE,
  weeklyHours: { 4: [{ start: "08:00", end: "17:00" }] }, // Thursday
};
const WINDOW = { startMillis: MST(8), endMillis: MST(17) };

/**
 * The dispatch board's blocked-minutes arithmetic, reproduced exactly.
 *
 * Mirrors `blockedMinutesInBand` in field-ops-app-vite/src/domain/dispatchBoardGeometry.js: clamp
 * each block to the band and SUM the durations. Copied here rather than imported because the client
 * package is a separate build with no module path into functions/ -- the copy is the point of the
 * test, not an accident of it, and if that function changes shape this suite's claim about it should
 * be re-read.
 */
function boardBlockedMinutes(blocks, band) {
  const total = blocks.reduce((sum, b) => {
    const start = Math.max(b.startMillis, band.startMillis);
    const end = Math.min(b.endMillis, band.endMillis);
    return end > start ? sum + (end - start) / 60_000 : sum;
  }, 0);
  return Math.round(total);
}

test("without overlap the two blocked-minute arithmetics agree -- which is why nobody noticed", () => {
  const blocks = [
    block("b1", "LUNCH", MST(12), MST(13)),
    block("b2", "MEETING", MST(15), MST(16)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, WINDOW), 120);
  assert.equal(boardBlockedMinutes(blocks, WINDOW), 120);
});

test("WITH overlap they disagree -- the server unions, the board sums", () => {
  // The shape a double-clicked PTO form produces: the same absence recorded twice.
  const duplicated = [
    block("b1", "PTO", MST(9), MST(17)),
    block("b2", "PTO", MST(9), MST(17)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, duplicated, WINDOW), 480, "8 hours, once");
  assert.equal(boardBlockedMinutes(duplicated, WINDOW), 960, "16 hours -- on a 9-hour lane");

  // And a partial overlap, so the point is not confined to exact duplicates.
  const partial = [
    block("b1", "PTO", MST(9), MST(11)),
    block("b2", "TRAINING", MST(10), MST(12)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, partial, WINDOW), 180, "09:00-12:00");
  assert.equal(boardBlockedMinutes(partial, WINDOW), 240);

  // Both of these inputs are now unreachable: findBlockedTimeConflict refuses the second record at
  // the write path, which is what makes sum == union hold for every set the store can contain.
  assert.ok(findBlockedTimeConflict([duplicated[0]], duplicated[1].startMillis, duplicated[1].endMillis));
  assert.ok(findBlockedTimeConflict([partial[0]], partial[1].startMillis, partial[1].endMillis));
});

test("the union is what the server already reports, so no reader changes", () => {
  // Stated as its own assertion because it is the reason this fix is a write-path guard rather than
  // a patch to the board: the SERVER number was always right. Removing overlap makes the board's
  // cheaper arithmetic right too, for every set it can now be handed.
  const blocks = [block("b1", "PTO", MST(9), MST(12))];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, WINDOW), 180);
  assert.equal(boardBlockedMinutes(blocks, WINDOW), 180);
});

test("blocked minutes outside recorded working hours are still not counted by the server", () => {
  // Unchanged behaviour, pinned because ND-25 touches the same records: a block at 03:00 takes no
  // capacity from a technician who does not work at 03:00, and the denominator never saw it either.
  const blocks = [block("b1", "UNAVAILABLE", MST(3), MST(5))];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, { startMillis: MST(0), endMillis: MST(17) }), 0);
});
