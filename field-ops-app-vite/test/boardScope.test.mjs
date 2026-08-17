// Operational board scope — the query contract.
//
// A board claims to show a COMPLETE working set. These assert the claim is either true or
// withdrawn, never quietly false: nothing terminal enters, nothing overdue is dropped,
// and one truncated branch makes the whole board incomplete rather than one column.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardQueries,
  mergeBoardResults,
  boardScopeMessage,
  openStates,
  BOARD_QUERY_KIND,
} from "../src/metadata/boardScope.js";
import { OPERATIONAL_BOARD_POLICY, boardWindow } from "../src/config/operationalBoardPolicy.js";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const kinds = (queries) => queries.map((q) => q.kind);

test("open states are derived by EXCLUDING terminal ones, so a new state is open by default", () => {
  // The failure modes are not symmetric. A new state wrongly open shows a dispatcher an
  // extra job; a new state wrongly terminal makes real work vanish with no trace.
  const open = openStates();
  assert.ok(!open.includes("CLOSED"));
  assert.ok(!open.includes("CANCELLED"));
  assert.ok(open.includes("WORK_IN_PROGRESS"));
  assert.ok(open.includes("CREATED"));
});

test("the scope is three queries whose union covers window, overdue and unscheduled", () => {
  // Firestore cannot express "in window OR overdue OR unscheduled" as one query — they
  // are different predicates on the same field.
  assert.deepEqual(kinds(buildBoardQueries(NOW)), [...BOARD_QUERY_KIND]);
});

test("every branch filters to open states — nothing terminal enters through any of them", () => {
  for (const q of buildBoardQueries(NOW)) {
    assert.ok(!q.statuses.includes("CLOSED"), q.kind);
    assert.ok(!q.statuses.includes("CANCELLED"), q.kind);
  }
});

test("overdue work is queried by DATE, not excluded by it", () => {
  // The clause a naive date filter drops first, and the work most in need of a dispatcher.
  const overdue = buildBoardQueries(NOW).find((q) => q.kind === "OVERDUE");
  assert.deepEqual(overdue.scheduledBefore, boardWindow(NOW).from);
  assert.equal(overdue.scheduledFrom, undefined);
});

test("unscheduled work is queried explicitly — no date predicate would ever match it", () => {
  const unscheduled = buildBoardQueries(NOW).find((q) => q.kind === "UNSCHEDULED");
  assert.equal(unscheduled.scheduledIsNull, true);
});

test("the window comes from policy and a supplied clock, never from module import time", () => {
  const { from, to } = boardWindow(NOW);
  const days = (a, b) => Math.round((b - a) / 86400000);
  assert.equal(days(from, NOW), OPERATIONAL_BOARD_POLICY.horizonPastDays);
  assert.equal(days(NOW, to), OPERATIONAL_BOARD_POLICY.horizonForwardDays);
});

test("no branch carries a cursor or a page size — a board does not page", () => {
  // Sharing list paging would let a column show the first N of a queue while reading as
  // the whole queue.
  for (const q of buildBoardQueries(NOW)) {
    assert.equal(q.cursor, undefined);
    assert.equal(q.pageSize, undefined);
  }
});

test("the bound is the completeness cap PLUS ONE — a probe, not a page size", () => {
  for (const q of buildBoardQueries(NOW)) {
    assert.equal(q.limit, OPERATIONAL_BOARD_POLICY.completenessCap + 1);
  }
});

const rows = (n, prefix = "wo") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

test("results merge into one working set, deduplicated by id", () => {
  const merged = mergeBoardResults([
    { kind: "IN_WINDOW", rows: [{ id: "a" }, { id: "b" }] },
    { kind: "OVERDUE", rows: [{ id: "b" }, { id: "c" }] },
    { kind: "UNSCHEDULED", rows: [] },
  ]);
  assert.equal(merged.state, "COMPLETE");
  assert.deepEqual(merged.rows.map((r) => r.id), ["a", "b", "c"]);
});

test("ONE branch over the cap makes the WHOLE board incomplete", () => {
  // Otherwise a board renders two honest columns beside one silently truncated one.
  const merged = mergeBoardResults([
    { kind: "IN_WINDOW", rows: rows(OPERATIONAL_BOARD_POLICY.completenessCap + 1) },
    { kind: "OVERDUE", rows: [{ id: "x" }] },
    { kind: "UNSCHEDULED", rows: [] },
  ]);
  assert.equal(merged.state, "OVER_CAP");
  assert.deepEqual(merged.overCapKinds, ["IN_WINDOW"]);
});

test("over the cap the rows are KEPT, so a surface can show what it has and say it is partial", () => {
  // Discarding them would replace a disclosed partial view with no view at all.
  const merged = mergeBoardResults([
    { kind: "IN_WINDOW", rows: rows(OPERATIONAL_BOARD_POLICY.completenessCap + 1) },
    { kind: "OVERDUE", rows: [] },
    { kind: "UNSCHEDULED", rows: [] },
  ]);
  assert.ok(merged.rows.length > 0);
});

test("a denied branch is DENIED, not empty and not merely unavailable", () => {
  const merged = mergeBoardResults([
    { kind: "IN_WINDOW", rows: [{ id: "a" }] },
    { kind: "OVERDUE", errorStatus: "denied" },
    { kind: "UNSCHEDULED", rows: [] },
  ]);
  assert.equal(merged.state, "DENIED");
  // A partial board built from the branches that succeeded would present an access
  // boundary as a smaller queue.
  assert.deepEqual(merged.rows, []);
});

test("a failed branch is UNAVAILABLE, and does not degrade into a smaller board", () => {
  const merged = mergeBoardResults([
    { kind: "IN_WINDOW", rows: [{ id: "a" }] },
    { kind: "OVERDUE", errorStatus: "unavailable" },
    { kind: "UNSCHEDULED", rows: [] },
  ]);
  assert.equal(merged.state, "UNAVAILABLE");
  assert.deepEqual(merged.rows, []);
});

test("the completeness message states the scope, and the over-cap message withdraws the claim", () => {
  assert.match(boardScopeMessage({ state: "COMPLETE" }), /all open work scheduled/i);
  const over = boardScopeMessage({ state: "OVER_CAP" });
  assert.match(over, /not the complete queue/i);
  // It must not imply a paging control would fix it — there is no next page of a board.
  assert.ok(!/load more|next page/i.test(over));
});
