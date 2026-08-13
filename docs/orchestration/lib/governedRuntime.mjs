// Live governed multi-child execution — the RUNTIME adapter that turns the pure orchestration brain
// (governedOrchestration.planParentExecution) into a single-pass, in-process mission runner the intake runtime
// invokes for a decomposed parent. It is the missing wire between "a parent intake carries childSpecs" and "EOS
// actually runs the exact governed child set, consolidates, reconciles, and emits ONE REVIEW_READY parent
// result" — with NO manual bridge and NO cross-workflow multi-pass fragility.
//
// Single pass, fail-closed, deterministic:
//   1. DECOMPOSE the parent into constrained child work items (planParentExecution → buildChildWorkItems). A
//      child that would widen authority on ANY axis REJECTs the whole mission — nothing runs.
//   2. Run each emitted child through the injected `runChild` (in production: adapt → runIntakeExecution with the
//      real guarded worker → land the child's artifacts durably BEFORE the next child runs; in tests: a fake).
//   3. Re-enter planParentExecution with the exact child set COMPLETE + their results + the findings register.
//      It fails closed on a missing/EXTRACTION_INVALID child or an incomplete set, so a COMPLETE here is a
//      genuine 2/2 (N/N) governed completion — consolidated + reconciled + REVIEW_READY.
//
// PURE except for the injected `runChild` (all real I/O lives there). This is the same design as intakeExecute:
// a pure decision core exercised by the same tests the runtime runs, with I/O injected.

import { planParentExecution, parentGrantFromArtifact, childSpecsFromArtifact } from "./governedOrchestration.mjs";
import { intakeDigest, resolveWorkIntake } from "./workIntake.mjs";
import { normalizeExecutionContract } from "./completionSemantics.mjs";

/**
 * Adapt a decomposed child work item (as emitted by buildChildWorkItems / surfaced on a DECOMPOSE plan) into the
 * exact resolved shape runIntakeExecution consumes. Two deterministic bridges:
 *   • promote the inherited `authority.profile` to `authority.authorizedExecutionProfile` (the field the
 *     governed profile resolver reads) — the grant is unchanged, only the field name the runtime expects;
 *   • attach the child's `execution` contract (its REQUESTED task class). With the #868 seam, a child that
 *     requests VERIFY but inherits only ANALYSIS runs read-only and still COMPLETEs (no unprovable receipt).
 * Recomputes sha256 over the adapted payload and returns a fully resolved, hash-verified artifact.
 *
 * @param {object} childItem   one artifact from a DECOMPOSE plan's `children`
 * @param {object} [opts]
 * @param {string} [opts.taskClass]  the child's requested execution task class (default READ_ONLY_ANALYSIS)
 * @returns {object} a resolved intake artifact (resolveWorkIntake output)
 */
export function toExecutableChildArtifact(childItem, { taskClass = "READ_ONLY_ANALYSIS" } = {}) {
  if (!childItem || typeof childItem !== "object" || !childItem.requestId) {
    throw new Error("toExecutableChildArtifact: a child work item with requestId is required");
  }
  const auth = childItem.authority || {};
  // Rebuild the payload WITHOUT the self-referential sha, promoting the profile field and adding the execution
  // contract, then re-digest. Everything else (scope/contextScope/source/authority axes/timestamps) is preserved
  // exactly as the constrained-inheritance builder minted it — no authority is added here.
  const { sha256: _omit, ...base } = childItem;
  const payload = {
    ...base,
    authority: {
      ...auth,
      // authorizedExecutionProfile is what resolveExecutionProfile reads as the GRANT; the inherited profile is
      // authoritative and is copied verbatim (no widening — it is exactly the child's constrained grant).
      authorizedExecutionProfile: auth.authorizedExecutionProfile ?? auth.profile ?? "READ_ONLY_ANALYSIS",
    },
    execution: normalizeExecutionContract({ taskClass }),
  };
  const sha256 = intakeDigest(payload);
  const artifact = { ...payload, sha256 };
  return resolveWorkIntake({
    requestId: artifact.requestId,
    location: artifact.artifactLocation,
    sha256,
    bytes: Buffer.from(JSON.stringify(artifact), "utf8"),
  });
}

/**
 * Run one governed parent mission end-to-end in a single pass.
 *
 * @param {object} p
 * @param {object}   p.parentArtifact  the resolved parent intake (carries authority + decomposition.childSpecs)
 * @param {Array}    [p.register]      findings register entries (for reconcile memory)
 * @param {Function} p.runChild        (childItem, spec) → { requestId, disposition, sector, content, written? }
 *                                     performs the real per-child execution + durable landing (injected).
 * @returns {{action, decompose, childRuns, reconciled, parentStatus, final}}
 *   action: "COMPLETE" | "BLOCKED" | "AWAIT" | "REJECT"
 */
export function runGovernedParentMission({ parentArtifact, register = [], runChild } = {}) {
  if (typeof runChild !== "function") throw new Error("runGovernedParentMission: runChild(childItem, spec) is required");
  const parent = parentGrantFromArtifact(parentArtifact);
  const childSpecs = childSpecsFromArtifact(parentArtifact);

  // 1. Decompose — fail-closed on a widening child (REJECT) or a malformed decomposition.
  const decompose = planParentExecution({ parent, childSpecs, childStates: [] });
  if (decompose.action !== "DECOMPOSE") {
    return Object.freeze({ action: decompose.action, decompose, childRuns: [], reconciled: null, parentStatus: "REJECTED", final: decompose });
  }

  const sectorByRequestId = new Map(childSpecs.map((s) => [s.requestId, s.sector]));

  // 2. Run each constrained child through the injected runner (durable landing happens inside runChild).
  const childRuns = [];
  for (const childItem of decompose.children) {
    const spec = childSpecs.find((s) => s.requestId === childItem.requestId) || null;
    const run = runChild(childItem, spec) || {};
    childRuns.push(Object.freeze({
      requestId: childItem.requestId,
      disposition: run.disposition ?? "FAILED",
      sector: run.sector ?? sectorByRequestId.get(childItem.requestId) ?? null,
      content: run.content ?? "",
      written: Object.freeze([...(Array.isArray(run.written) ? run.written : [])]),
    }));
  }

  // 3. Consolidate + reconcile against the EXACT expected child set. planParentExecution fails closed on a
  //    non-COMPLETE child (AWAIT), a missing/EXTRACTION_INVALID result (BLOCKED), or an unexpected child.
  const childStates = childRuns.map((r) => ({ requestId: r.requestId, status: r.disposition === "COMPLETE" ? "COMPLETE" : r.disposition }));
  const childResults = childRuns.map((r) => ({ requestId: r.requestId, disposition: r.disposition, sector: r.sector, content: r.content }));
  const final = planParentExecution({ parent, childSpecs, childStates, childResults, register });

  const parentStatus = final.action === "COMPLETE" ? "COMPLETE"
    : final.action === "AWAIT" ? "AWAITING_CHILDREN"
      : final.action === "BLOCKED" ? "BLOCKED_INCOMPLETE" : "REJECTED";
  return Object.freeze({ action: final.action, decompose, childRuns: Object.freeze(childRuns), reconciled: final.reconciled ?? null, parentStatus, final });
}
