// Governed multi-child orchestration — the brain that runs a decomposed mission end-to-end with NO manual
// bridge. Given a parent's decomposition spec, the current state of its children, and the findings register, it
// decides the ONE next governed action. Pure and deterministic; the workflow performs the I/O (commit children,
// write the parent result). It composes the already-merged, tested pieces:
//   • buildChildWorkItems (authorityInheritance) — decompose into constrained child work items (no widening)
//   • runAuditReconcile   (resultConsolidation)  — worker results → extract → completeness gate → consolidate →
//                                                   reconcile against register memory
//
// Fail-closed at every step: an over-asking child rejects the decomposition; the parent never reaches COMPLETE
// until EXACTLY the expected child set is COMPLETE and consolidation+reconcile succeed (a missing/EXTRACTION_
// INVALID child blocks it). This is what replaces the hand-driven #852 flow.

import { buildChildWorkItems } from "./authorityInheritance.mjs";
import { runAuditReconcile } from "./resultConsolidation.mjs";

/**
 * Decide the next action for a governed parent mission.
 *
 * @param {object} p
 * @param {object} p.parent       the Owner-approved parent grant (workId, profile, scope, contextScope, budgetUsd,
 *                                capabilities, protectedBoundary) — one approval, from which children inherit.
 * @param {Array}  p.childSpecs   the declared children: [{ requestId, title, intent, scope, sector, ... }].
 * @param {Array}  p.childStates  current per-child status on main: [{ requestId, status }] (COMPLETE / other).
 * @param {Array}  p.childResults executed children's raw results: [{ requestId, disposition, sector, content }].
 * @param {Array}  p.register     the findings register entries.
 * @returns {{action, ...}} one of:
 *   { action:"DECOMPOSE", children }          — emit these child work items (they don't exist yet)
 *   { action:"REJECT", rejected|reason }      — a child would widen authority / decomposition invalid (fail closed)
 *   { action:"AWAIT", pending }               — children emitted, not all COMPLETE yet
 *   { action:"BLOCKED", reason, detail }      — all present but consolidation/gate failed (e.g. EXTRACTION_INVALID)
 *   { action:"COMPLETE", reconciled, reviewReady:true } — 2/2 (N/N) complete, consolidated + reconciled, ready
 */
export function planParentExecution({ parent, childSpecs = [], childStates = [], childResults = [], register = [] } = {}) {
  const specs = Array.isArray(childSpecs) ? childSpecs : [];
  if (!parent || typeof parent !== "object" || !parent.workId) return Object.freeze({ action: "REJECT", reason: "parent grant with workId is required" });
  if (specs.length === 0) return Object.freeze({ action: "REJECT", reason: "no child specs — nothing to decompose" });

  const expectedIds = specs.map((s) => s.requestId);
  const emitted = new Set((Array.isArray(childStates) ? childStates : []).map((c) => c.requestId));

  // (1) Not yet decomposed → build the constrained child work items (fail closed if any would widen authority).
  if (specs.some((s) => !emitted.has(s.requestId))) {
    const built = buildChildWorkItems({ parent, requests: specs });
    if (!built.ok) return Object.freeze({ action: "REJECT", reason: built.reason });
    if (built.rejected.length) return Object.freeze({ action: "REJECT", rejected: built.rejected });
    return Object.freeze({ action: "DECOMPOSE", children: built.accepted });
  }

  // (2) Children exist but not all COMPLETE → await (parent CANNOT complete on a partial set).
  const complete = new Set((Array.isArray(childStates) ? childStates : []).filter((c) => c.status === "COMPLETE").map((c) => c.requestId));
  const pending = expectedIds.filter((id) => !complete.has(id));
  if (pending.length) return Object.freeze({ action: "AWAIT", pending: Object.freeze(pending) });

  // (3) Exactly the expected set is COMPLETE → consolidate + reconcile. runAuditReconcile fails closed on a
  // missing/EXTRACTION_INVALID child or an incomplete set, so a green result here is a genuine parent COMPLETE.
  const reconciled = runAuditReconcile({ parentWorkId: parent.workId, expectedChildIds: expectedIds, childResults, register });
  if (!reconciled.ok) return Object.freeze({ action: "BLOCKED", reason: "consolidation/reconcile gate not satisfied", detail: reconciled.consolidated ?? reconciled });
  return Object.freeze({ action: "COMPLETE", reconciled, reviewReady: true });
}

/**
 * Construct the parent GRANT (what children inherit from) from a parent work.json artifact. One Owner approval:
 * the profile comes from the authorized execution profile, scope/contextScope/boundary from the artifact, and
 * budget/capabilities default to none for a read-only mission unless the artifact declares them.
 */
export function parentGrantFromArtifact(a = {}) {
  const auth = a.authority || {};
  return Object.freeze({
    workId: a.requestId,
    profile: auth.authorizedExecutionProfile || a.executionProfile || "READ_ONLY_ANALYSIS",
    scope: Array.isArray(a.scope) ? a.scope : [],
    contextScope: Array.isArray(a.contextScope) ? a.contextScope : [],
    budgetUsd: typeof a.budgetUsd === "number" ? a.budgetUsd : 0,
    capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
    protectedBoundary: auth.protectedBoundary ?? null,
  });
}

/** The declared children a parent work.json carries (structured, not prose-parsed). */
export function childSpecsFromArtifact(a = {}) {
  const d = a.decomposition || {};
  return Array.isArray(d.childSpecs) ? d.childSpecs : [];
}

/**
 * Run one orchestration step for a parent, performing the I/O through injected deps (fakes in tests; real
 * git/fs readers+writers in the execute workflow). Pure decision (planParentExecution) + effectful I/O here.
 *
 * deps:
 *   readChildStates(ids) → [{requestId,status}]      readChildResults(ids) → [{requestId,disposition,sector,content}]
 *   readRegister() → [entries]                        emitChild(childArtifact) → written location (commit child work.json)
 *   writeParentResult({parentWorkId, reconciled}) → written    (write consolidated result + REVIEW_READY)
 *
 * @returns {{action, parentStatus, ...}} — the parent's next durable status + what was written.
 */
export function orchestrateParent({ parent, childSpecs = [], deps = {} } = {}) {
  const ids = childSpecs.map((s) => s.requestId);
  const childStates = deps.readChildStates ? deps.readChildStates(ids) : [];
  const childResults = deps.readChildResults ? deps.readChildResults(ids) : [];
  const register = deps.readRegister ? deps.readRegister() : [];
  const plan = planParentExecution({ parent, childSpecs, childStates, childResults, register });

  switch (plan.action) {
    case "DECOMPOSE": {
      const emitted = plan.children.map((c) => (deps.emitChild ? deps.emitChild(c) : c.artifactLocation));
      return Object.freeze({ action: "DECOMPOSE", parentStatus: "AWAITING_CHILDREN", emitted: Object.freeze(emitted) });
    }
    case "AWAIT":
      return Object.freeze({ action: "AWAIT", parentStatus: "AWAITING_CHILDREN", pending: plan.pending });
    case "COMPLETE": {
      const written = deps.writeParentResult ? deps.writeParentResult({ parentWorkId: parent.workId, reconciled: plan.reconciled }) : null;
      return Object.freeze({ action: "COMPLETE", parentStatus: "COMPLETE", reviewReady: true, reconciled: plan.reconciled, written });
    }
    case "BLOCKED":
      return Object.freeze({ action: "BLOCKED", parentStatus: "BLOCKED_INCOMPLETE", reason: plan.reason, detail: plan.detail });
    default: // REJECT
      return Object.freeze({ action: "REJECT", parentStatus: "REJECTED", reason: plan.reason ?? null, rejected: plan.rejected ?? null });
  }
}
