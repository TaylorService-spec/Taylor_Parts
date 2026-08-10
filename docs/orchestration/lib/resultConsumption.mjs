// Result consumption — the §23 continuation correction.
//
// THE DEFECT: the selector concluded "NO AUTHORIZED READY WORK" (a terminal checkpoint)
// while COMPLETE agent results existed, were routed to a registered workstream, and had
// not yet been interpreted. A completed agent run is NOT completed parent work — the
// interpretation is real, actionable continuation work that the selector could not see
// because `selectNextWork` only inspects a pre-computed backlog `items[]`, never results.
//
// THE FIX (no second queue): project each AWAITING_INTERPRETATION result into an ordinary
// READY work item and feed it to the SAME `selectNextWork`. A valid unconsumed result
// therefore prevents a false terminal checkpoint; disposing of it (CONSUMED/REJECTED/
// STALE/CONTAMINATED) clears the actionable state; an honest terminal checkpoint remains
// possible once nothing is awaiting.
//
// Pure. No I/O; the driver loads the durable result ledger and passes it in.

import { isAwaitingInterpretation } from "./agentResult.mjs";
import { selectNextWork } from "./selectNextWork.mjs";

/**
 * Results that are awaiting interpretation AND routed to a registered workstream.
 * A result routed to an UNregistered workstream is returned separately (unroutable) so it
 * is surfaced honestly rather than silently dropped — an ORCHESTRATOR_INTEGRATION_GAP, the
 * same class of bug that originally hid the UX workstream.
 */
export function partitionAwaiting(results = [], { registeredWorkstreams = [] } = {}) {
  const registered = new Set(registeredWorkstreams);
  const awaiting = [];
  const unroutable = [];
  for (const r of results || []) {
    if (!isAwaitingInterpretation(r)) continue;
    if (registered.has(r.routedBackTo)) awaiting.push(r);
    else unroutable.push(r);
  }
  return { awaiting, unroutable };
}

/**
 * WORK_STATES items for the selector — one READY "interpret result" item per awaiting,
 * registered result. Deterministic id so a resumed session dedupes against itself.
 */
export function interpretationWorkItems(results = [], opts = {}) {
  const { awaiting } = partitionAwaiting(results, opts);
  return awaiting.map((r) => ({
    id: `interpret:${r.resultId}`,
    state: "READY",
    workstream: r.routedBackTo,
    resultId: r.resultId,
    requestId: r.requestId,
    label: `Interpret agent result ${r.resultId} (routed to ${r.routedBackTo})`,
  }));
}

export function hasUnconsumedInterpretationWork(results = [], opts = {}) {
  return partitionAwaiting(results, opts).awaiting.length > 0;
}

/**
 * The correction, applied: inspect completed results BEFORE concluding a terminal state.
 * Concats interpretation work into the backlog items and runs the ordinary selector, so
 * unconsumed results cannot yield a false CHECKPOINT/ROADMAP_COMPLETE. Backlog items keep
 * their natural precedence (RUNNING/SAFE_CHECKPOINT/READY ordering is the selector's job);
 * interpretation items enter as READY.
 */
export function selectNextWorkIncludingResults(backlogItems = [], results = [], opts = {}) {
  const items = [...(backlogItems || []), ...interpretationWorkItems(results, opts)];
  return selectNextWork(items);
}
