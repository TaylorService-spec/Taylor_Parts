// Owner Roadmap Projection — pure read-only views over roadmapModel.mjs.
//
// Every export is a pure function `model -> view data`. No I/O, no markdown, no
// invented percentages: the only number produced is a milestone COUNT derived
// from explicit milestones (milestoneProgress). Rendering to markdown lives in
// generateRoadmapViews.mjs so these stay trivially testable.

import { roadmapModel, allCapabilities } from "./roadmapModel.mjs";

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
