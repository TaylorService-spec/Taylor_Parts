// Dispatch & Scheduler -- UNAVAILABLE TIME IS THE UNION OF BLOCKED INTERVALS.
//
// ════════════════════ WHAT THIS SUITE REPLACES, AND WHY ════════════════════
//
// This file was schedulingBlockedTimeExclusion.test.mjs, and it guarded ND-25: "one technician's
// absences may not overlap each other". The OWNER RULING of 2026-09-12 withdrew that rule:
//
//     OVERLAPPING BLOCKED-TIME FACTS ARE LEGITIMATE. A technician may be covered simultaneously by
//     more than one real unavailability fact -- a COMPANY_CLOSURE overlapping a recurring LUNCH, PTO
//     overlapping a closure, training inside a broader closure. The availability model means
//     UNAVAILABLE TIME = UNION OF BLOCKED INTERVALS. It is not the sum of every block's duration,
//     and it is not "no two blocks may overlap".
//
// ND-25 was a correct diagnosis of a real defect with the fix applied to the wrong layer. The defect
// was arithmetic: two readers answered "how many minutes are blocked" differently.
//
//   functions/src/scheduling/availabilityModel.ts          blockedMinutesInWindow   UNION
//   field-ops-app-vite/src/domain/dispatchBoardGeometry.js  blockedMinutesInBand     SUM
//
// Both numbers are drawn on the same dispatch lane. ND-25 removed the divergence by making its INPUT
// unreachable -- forbidding overlap at the write path so sum == union by construction. That bought
// agreement at the price of a business fact: a company closure could no longer be recorded over a
// lunch break, and which of two real absences was refused depended only on data-entry order.
//
// THE FIX NOW LIVES WHERE THE DEFECT DID. Both readers merge intervals before measuring, so they
// agree for EVERY set the store can contain, including all the sets ND-25 used to make impossible.
//
// ════════════════════ WHAT THIS SUITE HOLDS ════════════════════
//
//   1. the union itself -- overlap, containment, duplication, back-to-back, disjoint
//   2. the SERVER capacity reader unions (and still masks by recorded working hours)
//   3. the BOARD band reader unions -- asserted against the REAL imported module, not a copy
//   4. board and server AGREE, run over the same inputs in the same process
//   5. the write path no longer refuses overlap, still takes the serialization sentinel, and
//      collapses only a provable EXACT replay
//
// Section 5 reads SOURCE rather than importing, for the reason schedulingPlacementAuthorityContract
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
  mergeBlockedIntervals,
  unionBlockedMinutesInRange,
} from "../lib/scheduling/availabilityModel.js";

// ════════════════════ THE CROSS-PACKAGE IMPORT IS THE POINT ════════════════════
//
// The previous version of this file reproduced `blockedMinutesInBand` by hand, with a comment
// explaining that the client package is a separate build with no module path into functions/. That
// copy is exactly how the two arithmetics drifted in the first place: a mirrored function agrees
// with its original only until someone edits one of them.
//
// dispatchBoardGeometry.js is dependency-free ESM (it imports only two sibling pure modules), so the
// REAL board function can simply be imported here by relative path and run against the REAL server
// function in the same process. Nothing is mirrored, and the agreement below is measured rather than
// asserted about a copy.
import {
  blockedMinutesInBand,
  mergeBlockedIntervals as mergeBlockedIntervalsBoard,
} from "../../field-ops-app-vite/src/domain/dispatchBoardGeometry.js";

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

const FULL_DAY_AVAILABILITY = {
  technicianId: "tech-1",
  timeZone: ZONE,
  weeklyHours: { 4: [{ start: "08:00", end: "17:00" }] }, // Thursday
};
const WINDOW = { startMillis: MST(8), endMillis: MST(17) };
const BAND = { startMillis: MST(8), endMillis: MST(17) };
const view = (blocks) => ({ blockedTime: blocks });

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The union itself
// ═══════════════════════════════════════════════════════════════════════════════════════════

test("the union of two overlapping intervals is ONE interval, spanning both", () => {
  const merged = mergeBlockedIntervals([
    block("b1", "PTO", MST(9), MST(11)),
    block("b2", "TRAINING", MST(10), MST(12)),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { startMillis: MST(9), endMillis: MST(12) });
});

test("a LUNCH contained inside a COMPANY_CLOSURE adds nothing to the union", () => {
  // The exact shape of #1549's E2E case, reduced to arithmetic: a multi-day closure straddling the
  // daily lunch. Both records are legitimate and both are kept; the union is the closure.
  const merged = mergeBlockedIntervals([
    block("closure", "COMPANY_CLOSURE", MST(0), MST(24)),
    block("lunch", "LUNCH", MST(12), MST(13)),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { startMillis: MST(0), endMillis: MST(24) });
});

test("two IDENTICAL ranges are one interval -- a replayed record cannot double the union", () => {
  const merged = mergeBlockedIntervals([
    block("b1", "PTO", MST(9), MST(17)),
    block("b2", "PTO", MST(9), MST(17)),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { startMillis: MST(9), endMillis: MST(17) });
});

test("back-to-back intervals merge into one span -- and change no minute's answer", () => {
  // 12:00 ends, 12:00 starts. There is no minute between them, so the union is 09:00-15:00. That is
  // NOT the same claim as "back-to-back is an overlap": the half-open conflict test below still says
  // they do not collide, which is what keeps a job placed at exactly 12:00 legal.
  const merged = mergeBlockedIntervals([
    block("b1", "MEETING", MST(9), MST(12)),
    block("b2", "TRAINING", MST(12), MST(15)),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { startMillis: MST(9), endMillis: MST(15) });
  assert.equal(findBlockedTimeConflict([block("b1", "MEETING", MST(9), MST(12))], MST(12), MST(15)), null);
});

test("disjoint intervals stay separate, in ascending order, whatever order they arrive in", () => {
  const merged = mergeBlockedIntervals([
    block("b2", "MEETING", MST(15), MST(16)),
    block("b1", "LUNCH", MST(12), MST(13)),
  ]);
  assert.deepEqual(merged, [
    { startMillis: MST(12), endMillis: MST(13) },
    { startMillis: MST(15), endMillis: MST(16) },
  ]);
});

test("a malformed record is not blocked time -- it is dropped, never thrown on", () => {
  const merged = mergeBlockedIntervals([
    block("bad-reversed", "PTO", MST(14), MST(9)),
    block("bad-empty", "PTO", MST(9), MST(9)),
    { blockId: "bad-nan", startMillis: Number.NaN, endMillis: MST(10) },
    null,
    undefined,
    block("good", "PTO", MST(9), MST(10)),
  ]);
  assert.deepEqual(merged, [{ startMillis: MST(9), endMillis: MST(10) }]);
  assert.deepEqual(mergeBlockedIntervals(undefined), []);
});

test("unionBlockedMinutesInRange counts a covered minute ONCE however many records cover it", () => {
  const stacked = [
    block("closure", "COMPANY_CLOSURE", MST(8), MST(17)),
    block("lunch", "LUNCH", MST(12), MST(13)),
    block("pto", "PTO", MST(8), MST(17)),
  ];
  assert.equal(unionBlockedMinutesInRange(stacked, WINDOW), 9 * 60, "nine hours, once");
  // The SUM of those three durations is nearly twice the day.
  const summed = stacked.reduce((n, b) => n + (b.endMillis - b.startMillis) / 60_000, 0);
  assert.equal(summed, 19 * 60, "which is what a summing reader would have reported");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The server capacity reader unions
// ═══════════════════════════════════════════════════════════════════════════════════════════

test("a COMPANY_CLOSURE overlapping a LUNCH takes the CLOSURE's minutes, not closure + lunch", () => {
  const blocks = [
    block("closure", "COMPANY_CLOSURE", MST(8), MST(17)),
    block("lunch", "LUNCH", MST(12), MST(13)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, WINDOW), 9 * 60);
});

test("two identical ranges do not double the unavailable duration", () => {
  const duplicated = [
    block("b1", "PTO", MST(9), MST(17)),
    block("b2", "PTO", MST(9), MST(17)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, duplicated, WINDOW), 480, "8 hours, once");
});

test("partially overlapping absences report the union, not the sum", () => {
  const partial = [
    block("b1", "PTO", MST(9), MST(11)),
    block("b2", "TRAINING", MST(10), MST(12)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, partial, WINDOW), 180, "09:00-12:00");
});

test("back-to-back absences still report their true total", () => {
  const adjacent = [
    block("b1", "MEETING", MST(9), MST(12)),
    block("b2", "TRAINING", MST(12), MST(15)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, adjacent, WINDOW), 360, "six hours, no seam lost");
});

test("disjoint absences still add up", () => {
  const blocks = [
    block("b1", "LUNCH", MST(12), MST(13)),
    block("b2", "MEETING", MST(15), MST(16)),
  ];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, WINDOW), 120);
});

test("blocked minutes outside recorded working hours are still not counted by the server", () => {
  // Unchanged behaviour, pinned because this ruling touches the same records: a block at 03:00 takes
  // no capacity from a technician who does not work at 03:00, and the denominator never saw it.
  const blocks = [block("b1", "UNAVAILABLE", MST(3), MST(5))];
  assert.equal(blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, { startMillis: MST(0), endMillis: MST(17) }), 0);
});

test("an unrecorded schedule is still null capacity, never zero", () => {
  assert.equal(blockedMinutesInWindow(null, [block("b1", "PTO", MST(9), MST(10))], WINDOW), null);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. The board band reader unions -- the REAL module, imported
// ═══════════════════════════════════════════════════════════════════════════════════════════

test("blockedMinutesInBand no longer double-counts an overlap", () => {
  const duplicated = [
    block("b1", "PTO", MST(9), MST(17)),
    block("b2", "PTO", MST(9), MST(17)),
  ];
  // This was 960 -- sixteen hours drawn on a nine-hour lane -- before the union landed.
  assert.equal(blockedMinutesInBand(view(duplicated), BAND), 480);
});

test("blockedMinutesInBand draws a closure over a lunch as the closure", () => {
  const blocks = [
    block("closure", "COMPANY_CLOSURE", MST(8), MST(17)),
    block("lunch", "LUNCH", MST(12), MST(13)),
  ];
  assert.equal(blockedMinutesInBand(view(blocks), BAND), 9 * 60);
});

test("blockedMinutesInBand still clamps to the band and still sums disjoint blocks", () => {
  const blocks = [
    block("overnight", "COMPANY_CLOSURE", MST(0), MST(10)), // only 08:00-10:00 is in band
    block("meeting", "MEETING", MST(15), MST(16)),
  ];
  assert.equal(blockedMinutesInBand(view(blocks), BAND), 120 + 60);
});

test("the board's merge and the server's merge produce the SAME intervals", () => {
  const cases = [
    [block("b1", "PTO", MST(9), MST(11)), block("b2", "TRAINING", MST(10), MST(12))],
    [block("b1", "COMPANY_CLOSURE", MST(0), MST(24)), block("b2", "LUNCH", MST(12), MST(13))],
    [block("b1", "MEETING", MST(9), MST(12)), block("b2", "TRAINING", MST(12), MST(15))],
    [block("b1", "LUNCH", MST(12), MST(13)), block("b2", "MEETING", MST(15), MST(16))],
    [block("b1", "PTO", MST(9), MST(17)), block("b2", "PTO", MST(9), MST(17))],
    [],
  ];
  for (const blocks of cases) {
    assert.deepEqual(
      mergeBlockedIntervalsBoard(blocks),
      mergeBlockedIntervals(blocks),
      "the hand-mirrored client merge has drifted from the server's",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. The frontend representation and the server answer AGREE
// ═══════════════════════════════════════════════════════════════════════════════════════════

test("board band minutes == server window minutes, for every overlap shape, in one process", () => {
  // The two functions answer deliberately DIFFERENT questions -- the board measures calendar time in
  // the drawn band, the server measures capacity inside recorded working hours. They are made
  // comparable here by choosing a technician whose working day IS the band (08:00-17:00 Thursday),
  // which is the condition under which a dispatcher reads both numbers off the same lane line.
  const cases = {
    "closure over lunch": [
      block("closure", "COMPANY_CLOSURE", MST(8), MST(17)),
      block("lunch", "LUNCH", MST(12), MST(13)),
    ],
    "identical duplicates": [
      block("b1", "PTO", MST(9), MST(17)),
      block("b2", "PTO", MST(9), MST(17)),
    ],
    "partial overlap": [
      block("b1", "PTO", MST(9), MST(11)),
      block("b2", "TRAINING", MST(10), MST(12)),
    ],
    "training inside a closure": [
      block("closure", "COMPANY_CLOSURE", MST(9), MST(16)),
      block("training", "TRAINING", MST(10), MST(12)),
      block("lunch", "LUNCH", MST(12), MST(13)),
    ],
    "back to back": [
      block("b1", "MEETING", MST(9), MST(12)),
      block("b2", "TRAINING", MST(12), MST(15)),
    ],
    disjoint: [
      block("b1", "LUNCH", MST(12), MST(13)),
      block("b2", "MEETING", MST(15), MST(16)),
    ],
    none: [],
  };

  for (const [name, blocks] of Object.entries(cases)) {
    assert.equal(
      blockedMinutesInBand(view(blocks), BAND),
      blockedMinutesInWindow(FULL_DAY_AVAILABILITY, blocks, WINDOW),
      `the board and the server disagree about "${name}" -- the same lane would show two numbers`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. The write path: no overlap prohibition, the sentinel kept, replay only
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * A source body with its comments removed.
 *
 * The absence assertions below are claims about CODE. This module documents its own reasoning at
 * length and names the withdrawn rule while explaining why it is withdrawn -- so a raw-text search
 * would fail on correct code, and a contract test that cries wolf gets deleted.
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

test("createTechnicianBlockedTime REFUSES NOTHING for overlap -- the ruling, asserted against code", () => {
  const body = codeOnly(commandBody("createTechnicianBlockedTime"));
  assert.doesNotMatch(
    body,
    /findBlockedTimeConflict/,
    "block-vs-block overlap refusal is withdrawn: a COMPANY_CLOSURE may cover a LUNCH",
  );
  assert.doesNotMatch(
    body,
    /BLOCKED_TIME_CONFLICT/,
    "that refusal code belongs to PLACEMENT into blocked time, never to recording an absence",
  );
  // Nor a hand-rolled one in its place. `<` and `>` between two window endpoints is exactly what an
  // overlap test looks like, however it is spelled.
  assert.doesNotMatch(
    body,
    /startMillis\s*<\s*\w+\.endMillis|endMillis\s*>\s*\w+\.startMillis/,
    "no overlap prohibition smuggled back in by hand",
  );
});

test("the only collapse is an EXACT replay -- every field, or it is a different fact", () => {
  const body = commandBody("createTechnicianBlockedTime");
  assert.match(body, /isSameRecordedAbsence\(/, "identity is decided by one named predicate");

  const predicate = COMMANDS.slice(COMMANDS.indexOf("function isSameRecordedAbsence("));
  const end = predicate.indexOf("\n}\n");
  const decl = predicate.slice(0, end);
  for (const field of ["technicianId", "kind", "startMillis", "endMillis", "note"]) {
    assert.match(decl, new RegExp(`${field}`), `${field} must participate in the identity test`);
  }
  // Equality, not containment or comparison: a replay is the same assertion, not a nearby one. An
  // ORDERING comparison between two windows is what an overlap rule is made of, and there is none
  // here. (`=>` is an arrow function, not a comparison, so it is removed before the scan.)
  const comparisons = codeOnly(decl).replace(/=>/g, "");
  assert.doesNotMatch(comparisons, /[<>]/, "identity is equality -- an inequality here is an overlap rule");
});

test("createTechnicianBlockedTime still takes the per-technician sentinel -- READ and WRITE", () => {
  // The serialization is preserved exactly as it was. It protects concurrent scheduling state -- two
  // simultaneous identical submissions serialize, so the loser re-reads and sees the winner's record
  // rather than writing a second copy of it. What it is NOT is a licence to prohibit overlap.
  const body = commandBody("createTechnicianBlockedTime");
  assert.match(body, /const lockRef = db\(\)\.collection\(TECH_LOCKS_COLLECTION\)\.doc\(input\.technicianId\)/);
  assert.match(body, /await tx\.get\(lockRef\)/, "the sentinel is read inside the transaction");
  assert.match(body, /tx\.set\(lockRef,/, "the sentinel is WRITTEN, which is what forces contention");

  // Firestore requires every read before every write.
  const firstWrite = Math.min(
    ...[/tx\.set\(lockRef,/, /tx\.set\(ref,/]
      .map((re) => body.search(re))
      .filter((i) => i >= 0),
  );
  assert.ok(body.search(/loadBlockedTime\(/) < firstWrite, "the replay query runs in the read phase");
  assert.ok(body.search(/await tx\.get\(lockRef\)/) < firstWrite, "the sentinel is read in the read phase");
});

test("the replay check reuses the SHARED blocked-time query -- no second query, no second index", () => {
  assert.match(
    COMMANDS,
    /import \{ db, loadBlockedTime, loadTechnician \} from "\.\/schedulingRepository"/,
    "the blocked-time read is the same transactional query checkPlacement uses",
  );
  assert.match(commandBody("createTechnicianBlockedTime"), /loadBlockedTime\(tx, input\.technicianId, input\.startMillis\)/);
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
  // in that window is the dispatcher's problem to move, not this command's to refuse.
  const body = codeOnly(commandBody("createTechnicianBlockedTime"));
  assert.doesNotMatch(body, /findScheduleConflict|checkPlacement|SCHEDULE_CONFLICT/);
  assert.doesNotMatch(body, /WORK_ORDERS_COLLECTION/);
});

test("Work Order placement still REFUSES genuinely unavailable time", () => {
  // The other half of the ruling, and the half most at risk of being lost while relaxing the write
  // path: blocked time still refuses a PLACEMENT. checkPlacement owns that, over the same records.
  const policy = readFileSync(path.join(SRC, "scheduling", "placementPolicy.ts"), "utf8");
  assert.match(policy, /findBlockedTimeConflict\(/, "the placement policy still asks the overlap test");
  assert.match(policy, /"BLOCKED_TIME_CONFLICT"/, "and still refuses on it");

  // And the test itself, run: a job proposed inside a legitimately-overlapping pair is refused by
  // the record that covers it, whichever of the two that is.
  const stacked = [
    block("closure", "COMPANY_CLOSURE", MST(8), MST(17)),
    block("lunch", "LUNCH", MST(12), MST(13)),
  ];
  assert.ok(findBlockedTimeConflict(stacked, MST(12, 15), MST(12, 45)), "inside both");
  assert.ok(findBlockedTimeConflict(stacked, MST(14), MST(15)), "inside the closure only");
  assert.equal(findBlockedTimeConflict(stacked, MST(17), MST(18)), null, "after both -- half-open, still free");
});
