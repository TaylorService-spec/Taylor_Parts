import { WORK_ORDER_STATUS_VALUES } from "../domain/workOrderStatus.js";
import { OPERATIONAL_BOARD_POLICY, boardWindow } from "../config/operationalBoardPolicy.js";

// The operational board query contract.
//
// DELIBERATELY NOT ListViewDefinition. A list returns a page and says there is more; a
// board returns a COMPLETE working set or admits it cannot. Those are different promises
// and sharing one runtime would eventually let a board inherit paging, at which point its
// columns would show the first N of a queue while still reading as the whole queue —
// which is worse than the unbounded read, because the unbounded read was at least true.
//
// So: no cursor, no pageSize, no "load more". The bound here is the SCOPE PREDICATE, not
// a row count. That is what makes this a bounded read under §9 without making it partial:
// "every open job in the operational horizon" is a complete answer to a narrow question,
// where "the first fifty work orders" is a partial answer to a broad one.
//
// THREE QUERIES, ONE SCOPE. Firestore cannot express "in the window OR overdue OR
// unscheduled" as a single query — they are different predicates on the same field. So
// the contract declares three, each complete, and their union IS the scope. Splitting it
// is not a workaround: each query is separately meaningful, and a reader can see exactly
// what the board claims to cover.

export const BOARD_QUERY_KIND = Object.freeze(["IN_WINDOW", "OVERDUE", "UNSCHEDULED"]);

/** Lifecycle states a board covers: everything the policy does not call terminal. */
export function openStates(policy = OPERATIONAL_BOARD_POLICY) {
  return WORK_ORDER_STATUS_VALUES.filter((s) => !policy.terminalStates.includes(s));
}

/**
 * The queries whose union is the declared board scope.
 *
 * Every one filters on the open states, so nothing terminal can enter the board through
 * any branch. `limit` is the completeness cap plus one — the same truncation probe the
 * list runtime uses, but read differently: for a list it means "there is another page",
 * and here it means "this board can no longer claim to be complete".
 */
export function buildBoardQueries(now, policy = OPERATIONAL_BOARD_POLICY) {
  const { from, to } = boardWindow(now, policy);
  const states = openStates(policy);
  const base = { collection: "fieldops_wos", statuses: states, limit: policy.completenessCap + 1 };

  return Object.freeze([
    // The normal case: open work scheduled inside the operational horizon.
    Object.freeze({ ...base, kind: "IN_WINDOW", scheduledFrom: from, scheduledTo: to }),
    // Aged out of the window and STILL OPEN. This is the clause a naive date filter drops
    // first, and it is precisely the work most in need of a dispatcher.
    Object.freeze({ ...base, kind: "OVERDUE", scheduledBefore: from }),
    // Never scheduled at all. Invisible to any date predicate, and unschedulable work is
    // the definition of something needing attention.
    Object.freeze({ ...base, kind: "UNSCHEDULED", scheduledIsNull: true }),
  ]);
}

/**
 * Work scheduled BEYOND the forward horizon is deliberately out of scope.
 *
 * It is open, but it is planned rather than actionable, and a dispatch board that showed
 * every future job would stop being a working set. This is a DECLARED boundary, not a
 * hidden truncation: it is stated here, it is configurable through horizonForwardDays, and
 * a surface can say so.
 */
export const EXCLUDED_FROM_BOARD = Object.freeze({
  reason: "OPEN_BEYOND_FORWARD_HORIZON",
  description: "Open work scheduled beyond the forward horizon is planned, not actionable.",
});

export const BOARD_SCOPE_STATE = Object.freeze(["COMPLETE", "OVER_CAP", "UNAVAILABLE", "DENIED"]);

/**
 * Merge the three result sets into one working set.
 *
 * Deduplicated by document id, because the queries are separate predicates over one
 * collection and a record can satisfy more than one — an unscheduled job is not in the
 * window, but future refinements of the predicates should not be able to double-count.
 *
 * The state is COMPLETE only when every branch came back under the cap. One branch over
 * the cap makes the WHOLE board incomplete, and saying otherwise would let a board render
 * two honest columns beside one silently truncated one.
 */
export function mergeBoardResults(results, policy = OPERATIONAL_BOARD_POLICY) {
  if (results.some((r) => r?.errorStatus === "denied")) {
    return Object.freeze({ state: "DENIED", rows: Object.freeze([]), overCapKinds: Object.freeze([]) });
  }
  if (results.some((r) => r?.errorStatus)) {
    return Object.freeze({ state: "UNAVAILABLE", rows: Object.freeze([]), overCapKinds: Object.freeze([]) });
  }

  const overCapKinds = results.filter((r) => (r?.rows?.length ?? 0) > policy.completenessCap).map((r) => r.kind);

  const byId = new Map();
  for (const result of results) {
    for (const row of result?.rows ?? []) if (!byId.has(row.id)) byId.set(row.id, row);
  }

  return Object.freeze({
    // Over the cap the board reports OVER_CAP and keeps the rows, so a surface can still
    // show what it has WHILE saying the set is incomplete. Discarding them would replace
    // a disclosed partial view with no view at all, which helps nobody.
    state: overCapKinds.length ? "OVER_CAP" : "COMPLETE",
    rows: Object.freeze([...byId.values()]),
    overCapKinds: Object.freeze(overCapKinds),
  });
}

/** What a surface tells a dispatcher about the scope it is showing. */
export function boardScopeMessage(merged, policy = OPERATIONAL_BOARD_POLICY) {
  switch (merged.state) {
    case "COMPLETE":
      return `Showing all open work scheduled from ${policy.horizonPastDays} days ago through ${policy.horizonForwardDays} days ahead, plus everything overdue or unscheduled.`;
    case "OVER_CAP":
      // Names the incompleteness rather than implying a paging control would fix it.
      return `More than ${policy.completenessCap} open work orders match this board's scope, so this is not the complete queue. Narrow the scope or review the backlog directly.`;
    case "DENIED":
      return "You do not have access to work orders.";
    default:
      return "Work orders could not be loaded. Try again.";
  }
}
