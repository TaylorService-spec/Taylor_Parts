// TEAM PROJECTIONS -- the status breakdown and the comparison that must not become a leaderboard.
//
// Two different failures are guarded here.
//
//   A CHART THAT TOTALS MORE THAN THE WORK. Mixing "past due" and "conflict" into a by-status chart
//   double-counts: one work order can be both, and both are projections over status plus dates
//   rather than statuses. Only ACTUAL stored statuses are counted.
//
//   A LEADERBOARD WEARING A TABLE'S CLOTHES. Rows ordered by completed count ARE a ranking whatever
//   the headings say, and throughput alone is not the whole of a technician's job. Rows come back in
//   NAME order and carry no score.
//
// Run: node --test test/dashboardTeamProjections.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  workOrdersByStatus,
  technicianComparison,
  UNKNOWN_STATUS_LABEL,
  TECHNICIAN_QUALITY_UNAVAILABLE,
} from "../src/domain/dashboardTeamProjections.js";

const wo = (status, assignedTechId = null) => ({ status, assignedTechId });

// ── status breakdown ────────────────────────────────────────────────────────────────────────────

test("an unresolved read produces NO projection, never zeros", () => {
  for (const bad of [null, undefined, "not an array"]) {
    assert.equal(workOrdersByStatus(bad), null);
    assert.equal(technicianComparison(bad, () => "x"), null);
  }
});

test("a resolved but empty collection is an empty projection, not a missing one", () => {
  // Different from the above, and the difference is the whole point: [] means "you can see the
  // collection and there is nothing in it", null means "nobody could look".
  assert.deepEqual(workOrdersByStatus([]), []);
  assert.deepEqual(technicianComparison([], () => "x"), []);
});

test("work orders are counted by their ACTUAL stored status", () => {
  const rows = workOrdersByStatus([wo("SCHEDULED"), wo("SCHEDULED"), wo("COMPLETED")]);
  assert.deepEqual(rows, [
    { status: "SCHEDULED", count: 2 },
    { status: "COMPLETED", count: 1 },
  ]);
});

test("every work order lands in exactly one bucket -- the chart cannot exceed the work", () => {
  const input = [wo("SCHEDULED"), wo("COMPLETED"), wo("SCHEDULED"), wo("DRAFT")];
  const total = workOrdersByStatus(input).reduce((n, r) => n + r.count, 0);
  assert.equal(total, input.length, "a work order was counted twice or dropped");
});

test("a missing or malformed status is its OWN bucket, never dropped", () => {
  // Dropping them would make the chart quietly total fewer work orders than exist, and the reader
  // would have no way to notice.
  const rows = workOrdersByStatus([wo("SCHEDULED"), wo(null), wo(""), wo("   "), wo(undefined), wo(42)]);
  const unknown = rows.find((r) => r.status === UNKNOWN_STATUS_LABEL);
  assert.equal(unknown.count, 5);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 6);
});

test("status labels are trimmed but never invented or renamed", () => {
  assert.deepEqual(workOrdersByStatus([wo("  SCHEDULED  ")]), [{ status: "SCHEDULED", count: 1 }]);
});

// ── technician comparison ───────────────────────────────────────────────────────────────────────

const NAMES = { "t-1": "Ada Byron", "t-2": "Grace Hopper", "t-3": "Zoe Quinn" };
const resolve = (id) => NAMES[id] ?? null;

test("rows come back in NAME order -- never ranked by throughput", () => {
  // The load-bearing assertion. t-3 has the most completed work; if this ever sorts by count, the
  // table has become a leaderboard whatever its headings say.
  const rows = technicianComparison(
    [
      wo("COMPLETED", "t-3"), wo("COMPLETED", "t-3"), wo("COMPLETED", "t-3"),
      wo("COMPLETED", "t-1"),
      wo("SCHEDULED", "t-2"),
    ],
    resolve,
  );
  assert.deepEqual(rows.map((r) => r.name), ["Ada Byron", "Grace Hopper", "Zoe Quinn"]);
});

test("no row carries a rank, score, percentage or tone", () => {
  const [row] = technicianComparison([wo("COMPLETED", "t-1")], resolve);
  assert.deepEqual(Object.keys(row).sort(), ["completed", "name", "open", "technicianId"]);
  for (const forbidden of ["rank", "score", "percent", "tone", "position", "rating"]) {
    assert.ok(!(forbidden in row), `a technician row exposes "${forbidden}"`);
  }
});

test("completed and open are counted from status, and every assigned job is one or the other", () => {
  const rows = technicianComparison(
    [wo("COMPLETED", "t-1"), wo("CLOSED", "t-1"), wo("VERIFIED", "t-1"), wo("SCHEDULED", "t-1"), wo("DRAFT", "t-1")],
    resolve,
  );
  assert.equal(rows[0].completed, 3);
  assert.equal(rows[0].open, 2);
});

test("unassigned work is NOT a technician row", () => {
  // A row for unassigned work would read as a person carrying that workload.
  const rows = technicianComparison([wo("SCHEDULED", null), wo("SCHEDULED", ""), wo("SCHEDULED", "t-1")], resolve);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].technicianId, "t-1");
});

test("an unresolved technician name SAYS SO and never shows a document id", () => {
  // Ten surfaces in this repo once hand-rolled this lookup and nine rendered the raw id.
  const rows = technicianComparison([wo("SCHEDULED", "t-unknown")], resolve);
  assert.equal(rows[0].name, "Name not resolved");
  assert.ok(!rows[0].name.includes("t-unknown"));
  // A missing resolver is the same answer, not a crash.
  assert.equal(technicianComparison([wo("SCHEDULED", "t-1")], null)[0].name, "Name not resolved");
});

// ── the reserved half is stated, not omitted ────────────────────────────────────────────────────

test("the quality measures the platform does not define are named, not silently absent", () => {
  // An absent column reads as "there is nothing more to know". A reserved one reads as "the platform
  // knows this picture is incomplete", which is the truth.
  for (const phrase of [/on-time/i, /first-time fix/i, /workday/i]) {
    assert.match(TECHNICIAN_QUALITY_UNAVAILABLE, phrase);
  }
  assert.ok(TECHNICIAN_QUALITY_UNAVAILABLE.length > 120, "the reason must say what each one needs");
});
