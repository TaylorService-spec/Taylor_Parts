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
import { resolveDispatchModel } from "./modelPolicy.mjs";

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

// C-7 STANDARD-DISPATCH CONTEXT (Owner directive): every ORDINARY worker is bootstrapped with the
// SAME reproducible context package the Wake Supervisor uses — never a second bootstrap path. Pure:
// the package builder (contextPackageFor from context/build-package.mjs) is INJECTED so this module
// performs no I/O. Only a DISPATCH decision attaches a package; other decisions pass through unchanged.
// If the request's scope has no L1 authority in the map, the package's sufficiency is EVIDENCE_REQUIRED
// — the worker must escalate, not guess.
export function attachDispatchContext(dispatchResult, request, contextPackageFn, { sourceCommit = null } = {}) {
  if (!dispatchResult || dispatchResult.decision !== "DISPATCH") return dispatchResult;
  if (typeof contextPackageFn !== "function") throw new Error("attachDispatchContext: contextPackageFn is required (inject contextPackageFor — the shared package mechanism)");
  const contextPackage = contextPackageFn({
    id: request.requestId,
    scope: request.scope || [],
    role: request.requestedByWorkstream,
    objective: request.purpose,
    sourceCommit,
  });
  // Standard dispatch dispatches a DELEGATED worker → resolve the concrete model via the ratified
  // two-model policy (delegated → SONNET). modelTier is preserved as portability metadata. This is
  // the SAME resolver the Wake Supervisor uses, so the two paths cannot silently diverge.
  const modelSelection = resolveDispatchModel({ modelTier: request.modelTier, workstream: request.requestedByWorkstream, delegated: true });
  return { ...dispatchResult, contextPackage, selectedModel: modelSelection.selectedModel, modelSelection };
}

// Convenience: decide + attach the C-7 package in one call (the standard dispatch path).
export function dispatchWithContext({ contextPackageFn, sourceCommit = null, ...args } = {}) {
  const decision = decideDispatch(args);
  return attachDispatchContext(decision, args.request, contextPackageFn, { sourceCommit });
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

const INTEGRITY_RANK = Object.freeze({ SECURITY: 0, INTEGRITY: 1, NORMAL: 2 });
const SHA256 = /^[0-9a-f]{64}$/;
const READY_INTEGRATION = "READY";

export function validateIntegrationBacklogItem(item) {
  const errors = [];
  if (!item?.requestId) errors.push("requestId is required");
  if (!item?.target?.repo || !item?.target?.branch) errors.push("target repo/branch is required");
  if (!item?.approvedArtifact?.location || !SHA256.test(item?.approvedArtifact?.sha256 || "")) errors.push("approved patch/result location and SHA-256 are required");
  if (!Number.isFinite(item?.priority)) errors.push("numeric priority is required");
  if (!Array.isArray(item?.dependencies)) errors.push("dependencies must be an array");
  if (!Array.isArray(item?.paths) || !item.paths.length) errors.push("paths must be a non-empty array");
  if (!Array.isArray(item?.overlappingPaths)) errors.push("overlappingPaths must be an array");
  if (!Object.hasOwn(INTEGRITY_RANK, item?.integrityPriority)) errors.push("integrityPriority must be SECURITY, INTEGRITY, or NORMAL");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.verificationState)) errors.push("invalid verificationState");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.scopeState)) errors.push("invalid scopeState");
  if (!new Set(["PASS", "PENDING", "FAILED"]).has(item?.hashState)) errors.push("invalid hashState");
  if (!new Set(["APPROVED", "PENDING", "REJECTED"]).has(item?.approvalState)) errors.push("invalid approvalState");
  if (!new Set(["READY", "BLOCKED", "INTEGRATED"]).has(item?.integrationReadiness)) errors.push("invalid integrationReadiness");
  if (item?.blocker != null && typeof item.blocker !== "string") errors.push("blocker must be null or a string");
  return errors;
}

const targetKey = (item) => `${item.target.repo}#${item.target.branch}`;
const pathOverlap = (a, b) => a.paths.filter((path) => b.paths.includes(path));

// A pure ordering projection over the one durable Agent Manager backlog. It does not dispatch,
// approve, verify, or apply anything; the governed integration workflow remains the sole writer.
export function planIntegrationBacklog(items = []) {
  if (!Array.isArray(items)) throw new Error("integration backlog must be an array");
  const indexed = items.map((item, order) => ({ ...item, order, errors: validateIntegrationBacklogItem(item) }));
  const byId = new Map(indexed.map((item) => [item.requestId, item]));
  if (byId.size !== indexed.length) throw new Error("duplicate integration requestId");

  const blocked = new Map();
  for (const item of indexed) {
    if (item.errors.length) blocked.set(item.requestId, `INVALID: ${item.errors.join("; ")}`);
    else if (item.integrationReadiness === "BLOCKED" || item.blocker) blocked.set(item.requestId, item.blocker || "integration readiness is BLOCKED");
    else if (item.integrationReadiness === READY_INTEGRATION && item.verificationState !== "PASS") blocked.set(item.requestId, "verification has not passed");
    else if (item.integrationReadiness === READY_INTEGRATION && item.scopeState !== "PASS") blocked.set(item.requestId, "scope validation has not passed");
    else if (item.integrationReadiness === READY_INTEGRATION && item.hashState !== "PASS") blocked.set(item.requestId, "artifact hash validation has not passed");
    else if (item.integrationReadiness === READY_INTEGRATION && item.approvalState !== "APPROVED") blocked.set(item.requestId, "artifact is not approved");
    for (const dependency of item.dependencies || []) if (!byId.has(dependency)) blocked.set(item.requestId, `missing dependency: ${dependency}`);
  }

  const pending = new Set(indexed.filter((item) => item.integrationReadiness === READY_INTEGRATION && !blocked.has(item.requestId)).map((item) => item.requestId));
  const ordered = [];
  const compare = (a, b) => {
    const ai = INTEGRITY_RANK[a.integrityPriority], bi = INTEGRITY_RANK[b.integrityPriority];
    if (ai !== bi) return ai - bi;
    const aConflicts = indexed.some((other) => other.requestId !== a.requestId && targetKey(other) === targetKey(a) && pathOverlap(a, other).length);
    const bConflicts = indexed.some((other) => other.requestId !== b.requestId && targetKey(other) === targetKey(b) && pathOverlap(b, other).length);
    if (aConflicts !== bConflicts) return aConflicts ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.order - b.order;
  };

  while (pending.size) {
    const eligible = [...pending].map((id) => byId.get(id)).filter((item) => item.dependencies.every((id) => byId.get(id)?.integrationReadiness === "INTEGRATED" || ordered.some((done) => done.requestId === id)));
    if (!eligible.length) {
      for (const id of pending) blocked.set(id, "dependency cycle or dependency blocked");
      break;
    }
    eligible.sort(compare);
    const next = eligible[0];
    const overlaps = indexed.filter((other) => other.requestId !== next.requestId && targetKey(other) === targetKey(next)).flatMap((other) => pathOverlap(next, other));
    ordered.push({ ...next, overlappingPaths: [...new Set([...next.overlappingPaths, ...overlaps])].sort(), serializationKey: targetKey(next) });
    pending.delete(next.requestId);
  }

  return Object.freeze({
    ordered: Object.freeze(ordered),
    nextByTarget: Object.freeze(Object.fromEntries(ordered.map((item) => item.serializationKey).filter((key, i, keys) => keys.indexOf(key) === i).map((key) => [key, ordered.find((item) => item.serializationKey === key)]))),
    blocked: Object.freeze(indexed.filter((item) => blocked.has(item.requestId)).map((item) => ({ ...item, blocker: blocked.get(item.requestId) }))),
  });
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
