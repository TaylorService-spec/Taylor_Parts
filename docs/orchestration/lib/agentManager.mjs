// Shared Agent Manager — minimum dispatcher over the existing orchestrator.
//
// An EXECUTION SERVICE, not a product/architecture/UX authority and not a second
// scheduler competing with the durable backlog (#703). It decides, for one
// request against current state, exactly one action:
//
//   REJECT_INVALID   — request fails its contract
//   DEDUPE_REUSE     — an equivalent, valid, current result already exists
//   WAIT_NETWORK     — remote request, network disallows new remote work now
//   READY_BUT_WAITING_RESOURCE — valid, but no global resource slot free
//   DISPATCH         — run a bounded worker with this allocation
//
// Pure and stateless: the session driver holds in-flight allocations, performs the
// actual bounded-worker run (via the harness), writes the durable result, routes
// it back to the requesting workstream, releases the slot, and calls again.

import { validateAgentRequest } from "./agentRequest.mjs";
import { isReusableResult } from "./agentResult.mjs";
import { classifyResourceNeed, allocate } from "./resourceGovernor.mjs";
import { remotePolicy } from "./networkState.mjs";

export const DISPATCH_DECISIONS = Object.freeze([
  "REJECT_INVALID", "DEDUPE_REUSE", "WAIT_NETWORK", "READY_BUT_WAITING_RESOURCE", "DISPATCH",
]);

// An existing result is equivalent when it answers the same request fingerprint,
// concluded cleanly, and — if the request declares a freshness anchor — was
// produced against the same repository state (avoid reruns when nothing changed, §6).
export function findEquivalentResult(request, results = [], requestsById = new Map()) {
  return (results || []).find((r) => {
    if (!isReusableResult(r)) return false;
    const originating = requestsById.get(r.requestId);
    if (!originating || originating.fingerprint !== request.fingerprint) return false;
    if (request.freshnessAnchor && r.freshnessAnchor && request.freshnessAnchor !== r.freshnessAnchor) return false;
    return true;
  }) || null;
}

export function decideDispatch({ request, allocations = [], results = [], requestsById = new Map(), networkState = "NORMAL" } = {}) {
  const errors = validateAgentRequest(request);
  if (errors.length) return { decision: "REJECT_INVALID", errors };

  const reuse = findEquivalentResult(request, results, requestsById);
  if (reuse) return { decision: "DEDUPE_REUSE", result: reuse };

  const isRemote = request.execution === "REMOTE";
  if (isRemote && !remotePolicy(networkState).allowNewRemote) {
    return { decision: "WAIT_NETWORK", networkState };
  }

  const need = classifyResourceNeed(request);
  const slot = allocate(allocations, need);
  if (slot.decision === "WAIT_RESOURCE") {
    return { decision: "READY_BUT_WAITING_RESOURCE", waitingOn: slot.waitingOn };
  }
  return { decision: "DISPATCH", allocation: need };
}

// Pick the next request to consider: blocking before non-blocking, then lower
// priority number first, then declared order. Only PENDING/validated-waiting states.
const SELECTABLE = new Set(["PENDING", "VALIDATED", "READY_BUT_WAITING_RESOURCE", "WAITING_NETWORK"]);
export function selectNextQueuedRequest(requests = []) {
  const queue = (requests || []).map((r, index) => ({ r, index })).filter((x) => SELECTABLE.has(x.r.status));
  if (!queue.length) return null;
  queue.sort((a, b) => {
    if (!!b.r.blocking !== !!a.r.blocking) return (b.r.blocking ? 1 : 0) - (a.r.blocking ? 1 : 0);
    const pa = Number.isFinite(a.r.priority) ? a.r.priority : Infinity;
    const pb = Number.isFinite(b.r.priority) ? b.r.priority : Infinity;
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
  return queue[0].r;
}

// Efficiency counters over a request/result set (§6): all derivable from durable
// records, never fabricated. Token/runtime only where the runtime exposed them.
export function efficiencyMetrics(requests = [], results = []) {
  const byStatus = (s) => requests.filter((r) => r.status === s).length;
  const tokenResults = results.filter((r) => r.metrics && typeof r.metrics.tokens === "number");
  return {
    requestsCreated: requests.length,
    executed: results.length,
    dedupedOrReused: byStatus("DEDUPED"),
    rejected: byStatus("REJECTED"),
    waitingResource: byStatus("READY_BUT_WAITING_RESOURCE"),
    waitingNetwork: byStatus("WAITING_NETWORK"),
    retries: results.reduce((a, r) => a + (r.retries || 0), 0),
    acceptedFindings: results.reduce((a, r) => a + (r.findings ? r.findings.length : 0), 0),
    tokensReported: tokenResults.length, // how many results carried real token metrics
    tokensTotal: tokenResults.reduce((a, r) => a + r.metrics.tokens, 0), // sum of only the reported ones
  };
}
