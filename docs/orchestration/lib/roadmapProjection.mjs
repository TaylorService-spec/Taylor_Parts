// Owner Roadmap Projection — pure read-only views over roadmapModel.mjs.
//
// Every export is a pure function `model -> view data`. No I/O, no markdown, no
// invented percentages: the only number produced is a milestone COUNT derived
// from explicit milestones (milestoneProgress). Rendering to markdown lives in
// generateRoadmapViews.mjs so these stay trivially testable.

import { roadmapModel, allCapabilities } from "./roadmapModel.mjs";
import { capacitySnapshot } from "./resourceGovernor.mjs";
import { efficiencyMetrics } from "./agentManager.mjs";
import { summarizeAssignment, withEscalation } from "./workLifecycle.mjs";
import { projectAiGovernance } from "./aiExchange.mjs";
import { reviewProvenanceLabel } from "./reviewProvenance.mjs";
import { projectOwnerFriction } from "./ownerFriction.mjs";
import { projectWakeBoard } from "./wakeState.mjs";

// "Who's Doing What" — worker responsibility visibility (Owner requirement). Projects durable
// WORK ASSIGNMENTS (routed via the Agent Manager) into a glance list: who is responsible, the
// lifecycle state (ASSIGNED/ACKNOWLEDGED/ACTIVE/COMPLETED/CONSUMED), the trigger outcome, and
// escalation (WAITING_FOR_PICKUP/POSSIBLY_STALLED). ROUTED work is NEVER shown as ACTIVE — a
// routed assignment with no acknowledgement stays ASSIGNED, honestly. Silence implies nothing.
// A review assignment additionally carries its source-provenance label (REVIEW CURRENT/STALE/
// CONTAMINATED/UNKNOWN) so a stale-source review is visibly distinguishable. Not a new queue.
export function projectWhosDoingWhat(assignments = [], { nowMs = null } = {}) {
  return (assignments || []).map((w) => {
    const summary = summarizeAssignment(nowMs != null ? withEscalation(w, nowMs) : w);
    if (w.reviewProvenance && w.reviewProvenance.sourceFreshnessState) {
      summary.sourceFreshnessState = w.reviewProvenance.sourceFreshnessState;
      summary.reviewLabel = reviewProvenanceLabel(w.reviewProvenance.sourceFreshnessState);
    }
    return summary;
  });
}

// Milestone-derived progress ONLY — {complete,total} or null when no explicit
// milestones exist. Never a fabricated percentage.
export function milestoneProgress(capability) {
  const ms = capability.milestones || [];
  if (ms.length === 0) return null;
  return { complete: ms.filter((m) => m.complete === true).length, total: ms.length };
}

// The six orthogonal dimension fields, kept separate so nothing collapses into
// one misleading signal.
export function dimensions(capability) {
  return {
    implementationState: capability.implementationState,
    activationState: capability.activationState,
    backendState: capability.backendState,
    userOperable: capability.userOperable,
    uxState: capability.uxState,
    deployState: capability.deployState,
  };
}

// Board glyphs from status (design-board / ux-board views).
export function statusToSymbol(status, routedTo) {
  if (routedTo) return "R";
  switch (status) {
    case "DONE": case "DELIVERED": return "x";
    case "RUNNING": return ">";
    case "OWNER_DECISION": return "!";
    case "PROTECTED_ACTION": return "P";
    case "BLOCKED_DEPENDENCY": return "B";
    case "AT_REST": return "-";
    default: return " "; // READY / PLANNED / IDENTIFIED / ASSESSMENT_READY / ASSESSED
  }
}

// 1. Executive Roadmap — one compact line per capability.
export function projectExecutiveRoadmap(model = roadmapModel) {
  return (model.domains || []).map((d) => ({
    domainId: d.id, domainName: d.name, domainKind: d.kind,
    capabilities: (d.capabilities || []).map((c) => ({
      id: c.id, name: c.name, status: c.status, workstreamOwner: c.workstreamOwner,
      dimensions: dimensions(c), milestones: milestoneProgress(c),
    })),
  }));
}

// 2. Detailed Roadmap — full hierarchy, all fields.
export function projectDetailedRoadmap(model = roadmapModel) {
  return {
    id: model.id, name: model.name, lastVerifiedRepoState: model.lastVerifiedRepoState,
    domains: (model.domains || []).map((d) => ({
      id: d.id, name: d.name, kind: d.kind,
      capabilities: (d.capabilities || []).map((c) => ({
        id: c.id, name: c.name, status: c.status, workstreamOwner: c.workstreamOwner,
        dimensions: dimensions(c), milestones: milestoneProgress(c),
        dependencies: c.dependencies || [], blockedReason: c.blockedReason, routedTo: c.routedTo,
        ownerDecision: c.ownerDecision, protectedBoundary: c.protectedBoundary,
        roadmapTrigger: c.roadmapTrigger, lastVerifiedRepoState: c.lastVerifiedRepoState,
        milestoneDetail: (c.milestones || []).map((m) => ({
          id: m.id, name: m.name, complete: m.complete, completionCriteria: m.completionCriteria || [],
          workItems: (m.workItems || []).map((w) => ({
            id: w.id, name: w.name, status: w.status, owner: w.owner,
            prEvidence: w.prEvidence || [], tests: w.tests, verification: w.verification,
            deployState: w.deployState, blockedReason: w.blockedReason, protectedBoundary: w.protectedBoundary,
            evidence: w.evidence || [],
          })),
        })),
      })),
    })),
  };
}

function capsWhere(model, predicate) {
  return allCapabilities(model).filter(predicate);
}

// 3. Active Work — RUNNING or READY.
export function projectActiveWork(model = roadmapModel) {
  return capsWhere(model, (c) => c.status === "RUNNING" || c.status === "READY").map((c) => ({
    id: c.id, name: c.name, domain: c.domainName, status: c.status, workstreamOwner: c.workstreamOwner,
    milestones: milestoneProgress(c),
  }));
}

// 4. Blocked / Dependencies.
export function projectBlocked(model = roadmapModel) {
  return capsWhere(model, (c) => c.status === "BLOCKED_DEPENDENCY").map((c) => ({
    id: c.id, name: c.name, domain: c.domainName, blockedReason: c.blockedReason,
    dependencies: c.dependencies || [], routedTo: c.routedTo,
  }));
}

// 5. Owner Decisions — blocking (status OWNER_DECISION) and recorded/deferred (carry ownerDecision text).
export function projectOwnerDecisions(model = roadmapModel) {
  return capsWhere(model, (c) => c.status === "OWNER_DECISION" || !!c.ownerDecision).map((c) => ({
    id: c.id, name: c.name, domain: c.domainName, decision: c.ownerDecision,
    blocking: c.status === "OWNER_DECISION",
  }));
}

// 6. Protected / Awaiting Operator.
export function projectProtected(model = roadmapModel) {
  return capsWhere(model, (c) => c.status === "PROTECTED_ACTION").map((c) => ({
    id: c.id, name: c.name, domain: c.domainName, protectedBoundary: c.protectedBoundary,
  }));
}

function boardFor(model, owner) {
  return capsWhere(model, (c) => c.workstreamOwner === owner).map((c) => ({
    symbol: statusToSymbol(c.status, c.routedTo), id: c.id, name: c.name, domain: c.domainName,
    status: c.status, note: c.blockedReason || c.ownerDecision || c.protectedBoundary || undefined,
  }));
}

// 7. Design execution board. 8. UX execution board.
export function projectDesignBoard(model = roadmapModel) { return boardFor(model, "Product/Design"); }
export function projectUxBoard(model = roadmapModel) { return boardFor(model, "UX"); }

// 9. Agent Operations (Phase 3 §9) — read-only projection over the durable Agent
// Request/Result ledger + live governor/network state. Pure: the generator loads
// the ledger files and current state and passes them in.
const QUEUED_STATUSES = new Set(["PENDING", "VALIDATED", "READY_BUT_WAITING_RESOURCE", "WAITING_NETWORK"]);
const RUNNING_STATUSES = new Set(["DISPATCHED", "RUNNING"]);
function compactRequest(r) {
  return { requestId: r.requestId, workstream: r.requestedByWorkstream, mode: r.mode, purpose: r.purpose, status: r.status, execution: r.execution, priority: r.priority };
}
export function projectAgentOperations(requests = [], results = [], { networkState = "NORMAL", allocations = [], networkHealth = null, ownerRelayCount = 0, proofStatus = null } = {}) {
  return {
    // Phase 4: network state may come from real telemetry (networkHealth.state); fall back to the passed state.
    networkState: (networkHealth && networkHealth.state) || networkState,
    networkHealth: networkHealth ? {
      state: networkHealth.state, confidence: networkHealth.confidence, sampleAgeSec: networkHealth.sampleAgeSec,
      reasonCodes: networkHealth.reasonCodes || [], recentLatency: networkHealth.recentLatency || null,
      connectionCount: networkHealth.connectionCount ?? null, evidenceWindow: networkHealth.evidenceWindow || null,
      asOf: networkHealth.asOf || null,
    } : null,
    capacity: capacitySnapshot(allocations),
    queued: requests.filter((r) => QUEUED_STATUSES.has(r.status)).map(compactRequest),
    running: requests.filter((r) => RUNNING_STATUSES.has(r.status)).map(compactRequest),
    recentResults: results.map((r) => ({
      resultId: r.resultId, requestId: r.requestId, routedBackTo: r.routedBackTo,
      status: r.status, verdict: r.verdict, findings: (r.findings || []).length, retries: r.retries || 0,
    })),
    metrics: efficiencyMetrics(requests, results),
    // §10: routine Design/UX agent handoffs require ZERO Owner relay when the durable ledger carries them.
    ownerRelayCount,
    proofStatus,
  };
}

// Recent Progress (Control Center §Recent Progress) — meaningful change history derived
// ONLY from what the model already asserts: DONE/DELIVERED work items that cite PR
// evidence, ordered by the highest PR number they reference. PR numbers are a trustworthy
// monotonic sequence; this is NOT a git-history dump and fabricates no timeline. Items
// without PR evidence are omitted rather than dated from unavailable facts.
export function projectRecentProgress(model = roadmapModel, { limit = 20 } = {}) {
  const items = [];
  for (const d of model.domains || []) {
    for (const c of d.capabilities || []) {
      for (const m of c.milestones || []) {
        for (const w of m.workItems || []) {
          if (w.status !== "DONE" && w.status !== "DELIVERED") continue;
          const prNums = (w.prEvidence || []).map((p) => Number(String(p).replace("#", ""))).filter((n) => Number.isFinite(n));
          if (prNums.length === 0) continue; // no trustworthy evidence → omit, don't invent
          items.push({
            capability: c.name, domain: d.name, workstream: c.workstreamOwner,
            item: w.name, prs: [...w.prEvidence], latestPr: Math.max(...prNums),
          });
        }
      }
    }
  }
  items.sort((a, b) => b.latestPr - a.latestPr);
  return items.slice(0, limit);
}

// Owner cockpit projection (M6). Progressive-disclosure rollups DERIVED from existing durable
// state — no new authority, no second roadmap. Glance-level verdicts + drilldown lists. Every
// section that has no durable source is emitted as an honest { available:false } gap, never
// simulated. `networkHealth` (sanitized) and `ownerRelayCount` are injected by the adapter.
export function projectCockpit(model = roadmapModel, { networkHealth = null, freshness = null, ownerRelayCount = null, workAssignments = [], decisionRequests = [], aiExchanges = [], frictionEvents = [], nowMs = null } = {}) {
  const caps = [];
  for (const d of model.domains || []) for (const c of d.capabilities || []) caps.push({ ...c, domain: d.name });

  const byStatus = (s) => caps.filter((c) => c.status === s);
  const ownerDecisions = byStatus("OWNER_DECISION");
  const protectedActions = byStatus("PROTECTED_ACTION");
  const blocked = byStatus("BLOCKED_DEPENDENCY");
  const ready = byStatus("READY");
  const running = byStatus("RUNNING");

  // SYSTEM HEALTH — explicit governed conditions ONLY (never a percentage/blend).
  // A pending OWNER_DECISION is ACTION_REQUIRED. PROTECTED_ACTION is an intentional resting
  // gate (activation held), surfaced under NEEDS YOU as OWNER_AUTHORIZATION but not itself a
  // health alarm. Network pressure / stale freshness / blocked deps are ATTENTION.
  const reasons = [];
  for (const c of ownerDecisions) reasons.push({ code: "OWNER_DECISION", detail: `${c.id} awaits an Owner decision` });
  const networkPressure = networkHealth && networkHealth.state && networkHealth.state !== "NORMAL" && networkHealth.state !== "UNKNOWN";
  if (networkPressure) reasons.push({ code: "NETWORK", detail: `network ${networkHealth.state}` });
  if (freshness && (freshness === "STALE" || freshness === "UNKNOWN")) reasons.push({ code: "FRESHNESS", detail: `board is ${freshness}` });
  for (const c of blocked) reasons.push({ code: "BLOCKED_DEPENDENCY", detail: `${c.id} is blocked` });
  const state = ownerDecisions.length > 0 ? "ACTION_REQUIRED"
    : (networkPressure || blocked.length > 0 || (freshness === "STALE" || freshness === "UNKNOWN")) ? "ATTENTION"
    : "HEALTHY";
  const systemHealth = { state, reasons };

  // NEEDS YOU — genuine asks only, AUTO_RESOLVED never appears (it is the filter, not a row).
  // Two sources: (1) DURABLE Owner Decision Requests carrying a persisted triageClass — the
  // authoritative source; (2) a capability-STATUS proxy for capabilities that have no decision
  // request yet. RECOMMEND_OWNER appears only via a real durable request.
  const durableDecisions = (decisionRequests || [])
    .filter((d) => d.triageClass && d.triageClass !== "AUTO_RESOLVED")
    .map((d) => ({
      source: "decision-request", triageClass: d.triageClass, decisionId: d.decisionId,
      name: d.question || d.decisionId, text: d.reason || d.recommendation || null,
      requiresReconfirmAtExecution: d.triageClass === "OWNER_AUTHORIZATION",
      requestedAuthority: d.requestedAuthority || null,
    }));
  const proxyItems = [
    ...ownerDecisions.map((c) => ({ source: "capability-status", triageClass: "NEEDS_OWNER", capabilityId: c.id, name: c.name, domain: c.domain, text: c.ownerDecision || null })),
    ...protectedActions.map((c) => ({ source: "capability-status", triageClass: "OWNER_AUTHORIZATION", capabilityId: c.id, name: c.name, domain: c.domain, protectedBoundary: c.protectedBoundary || null, requiresReconfirmAtExecution: true })),
  ];
  const needsYou = {
    proxy: proxyItems.length > 0,
    proxyReason: proxyItems.length > 0
      ? "some rows derive from capability STATUS (proxy) for capabilities with no durable Owner Decision Request yet; rows tagged source:'decision-request' carry the authoritative persisted triageClass."
      : null,
    items: [...durableDecisions, ...proxyItems],
  };

  // WORK SUPPLY — coarse model-count proxy (the fine schedulability truth lives in
  // execution-backlog.md, not the envelope). DRAINED is legitimate, never an error.
  const supplyState = ready.length === 0 ? "DRAINED" : ready.length <= 2 ? "LOW" : "HEALTHY";
  const workSupply = {
    state: supplyState, readyCount: ready.length, runningCount: running.length,
    terminalCheckpoint: ready.length === 0,
    note: ready.length === 0 ? "No authorized READY work is a legitimate terminal state, not a failure." : null,
    proxy: true, proxyReason: "coarse capability-status counts; richer schedulability is in execution-backlog.md (not the envelope).",
  };

  // AUTONOMY — derived from the unattended-readiness capability; not parsed from prose.
  const ur = caps.find((c) => c.id === "unattended-readiness");
  const autonomy = {
    mode: "SUPERVISED_IN_SESSION", // Option A (/loop) is the current continuation mechanism
    governingCapability: ur ? ur.id : null,
    overnightAuthorized: false,
    authorityExpansions: 0,
    authorityExpansionsBasis: "no authority-expansion action exists in the model; the invariant is that this MUST remain 0.",
  };

  // OPERABILITY — distribution across the six lanes from the existing dimensions. NEVER a
  // single completion %. Process capabilities (all dims NOT_APPLICABLE) are excluded and counted.
  const dist = { BUILT: 0, INERT: 0, DEPLOYED: 0, USER_OPERABLE: 0, PROTECTED: 0, UNKNOWN: 0 };
  let processExcluded = 0;
  const perCapability = [];
  for (const c of caps) {
    const dm = dimensions(c);
    const allNA = Object.values(dm).every((v) => v === "NOT_APPLICABLE" || v === undefined);
    if (allNA) { processExcluded++; continue; }
    let lane;
    if (c.status === "PROTECTED_ACTION") lane = "PROTECTED";
    else if (dm.userOperable === true && dm.deployState === "DEPLOYED") lane = "USER_OPERABLE";
    else if (dm.deployState === "DEPLOYED") lane = "DEPLOYED";
    else if (dm.activationState === "INERT") lane = "INERT";
    else if (dm.implementationState === "IMPLEMENTED") lane = "BUILT";
    else lane = "UNKNOWN";
    dist[lane]++;
    perCapability.push({ id: c.id, name: c.name, lane, dimensions: dm });
  }
  const operability = { distribution: dist, processExcluded, perCapability };

  // SINCE YOUR LAST VISIT — ordered PR-evidenced increments; the client diffs against its own
  // last-seen marker (the envelope cannot know when the Owner last looked). Basis is honestly
  // PR sequence, not wall-clock.
  const increments = projectRecentProgress(model);
  const sinceLastVisit = { markerBasis: "PR_SEQUENCE", latestPr: increments.length ? increments[0].latestPr : null, increments };

  // AI GOVERNANCE — projected from the compact Claude↔ChatGPT exchange ledger (never a
  // transcript). Honest {available:false} gap until real exchanges exist. ownerRelayedCount
  // surfaces exchanges that still required the Owner as conduit (a context defect to reduce).
  const aiGovernance = projectAiGovernance(aiExchanges, { ownerRelayCount });

  // CUSTOMER / PRODUCT OUTCOME — now a durable capability field (Owner-approved). Projected,
  // not inferred: a capability without an established outcome is honestly UNKNOWN, never
  // fabricated. Distribution over evidenceState + per-capability where an outcome is set.
  const outcomeDist = { UNKNOWN: 0, HYPOTHESIS: 0, EVIDENCED: 0, VALIDATED: 0, DISPROVEN: 0 };
  const outcomes = [];
  for (const c of caps) {
    const co = c.customerOutcome;
    const evidenceState = co && co.evidenceState ? co.evidenceState : "UNKNOWN";
    outcomeDist[evidenceState] = (outcomeDist[evidenceState] || 0) + 1;
    if (co) outcomes.push({ id: c.id, name: c.name, intendedOutcome: co.intendedOutcome, evidenceState, evidence: co.evidence || [] });
  }
  const customerOutcome = {
    available: true,
    distribution: outcomeDist,
    established: outcomes,
    note: outcomes.length === 0 ? "No capability has an established customer outcome yet; all UNKNOWN until discovery/evidence establishes one (never fabricated)." : null,
  };

  // WHO'S DOING WHAT — worker responsibility visibility. Routed ≠ active: an assignment shows
  // its true lifecycle + escalation, never "active" merely because it was routed.
  const whosDoingWhat = projectWhosDoingWhat(workAssignments, { nowMs });

  // REVIEW PROVENANCE — so evidence for UX/AI review/hosted-publish visibly distinguishes
  // REVIEW CURRENT/STALE/CONTAMINATED/UNKNOWN. Rolls up the review assignments' source-freshness
  // labels (from the existing reviewProvenance authority — NOT another freshness model). A
  // non-CURRENT review is surfaced, never silently trusted.
  const reviewRollup = { available: false, distribution: { "REVIEW CURRENT": 0, "REVIEW STALE": 0, "REVIEW CONTAMINATED": 0, "REVIEW UNKNOWN": 0 }, reviews: [] };
  for (const w of whosDoingWhat) {
    if (!w.reviewLabel) continue;
    reviewRollup.available = true;
    reviewRollup.distribution[w.reviewLabel] = (reviewRollup.distribution[w.reviewLabel] || 0) + 1;
    reviewRollup.reviews.push({ workId: w.workId, responsibleParty: w.responsibleParty, reviewLabel: w.reviewLabel, sourceFreshnessState: w.sourceFreshnessState });
  }
  const reviewProvenance = reviewRollup.available ? reviewRollup : { available: false, reason: "no review assignments carry source provenance yet." };

  // OWNER FRICTION — reduce AVOIDABLE (manual relay/handoff/memory-dependency/unnecessary-
  // decision/duplicate-notification/manual-recovery) → 0; NEVER hide NECESSARY decision/
  // authorization. MANUAL_CONTEXT_RELAY is derived from ownerRelayed exchanges (real evidence).
  const ownerFriction = projectOwnerFriction(frictionEvents, { aiExchanges });

  // WAKE BOARD — the wake-state chain (READY/AUTHORIZED/ROUTED/TRIGGERED/…/CONSUMED) + trigger
  // mechanism, surfacing the Owner's distinction: authorized work WAITING_FOR_TRIGGER vs no
  // authorized work. Populates from assignments that carry a wakeState (the wake supervisor writes
  // them); honest-empty otherwise.
  const wakeBoard = projectWakeBoard(workAssignments);

  return { systemHealth, needsYou, workSupply, autonomy, operability, sinceLastVisit, whosDoingWhat, wakeBoard, reviewProvenance, ownerFriction, aiGovernance, customerOutcome };
}

// Convenience: all eight views at once (used by the generator).
export function projectAll(model = roadmapModel) {
  return {
    executiveRoadmap: projectExecutiveRoadmap(model),
    detailedRoadmap: projectDetailedRoadmap(model),
    activeWork: projectActiveWork(model),
    blocked: projectBlocked(model),
    ownerDecisions: projectOwnerDecisions(model),
    protected: projectProtected(model),
    designBoard: projectDesignBoard(model),
    uxBoard: projectUxBoard(model),
  };
}
