// Owner Decision Request + pure decision triage (§9, §10).
//
// The chat transcript is NOT the authoritative decision record. An Owner Decision Request is
// a durable, structured record of a question that genuinely needs Owner-level attention —
// and triage decides, from standing authority, whether it needs the Owner AT ALL. Most
// routine questions resolve BEFORE reaching the Owner Inbox: "worker lacks authority" is not
// "Owner needs to decide."
//
// Pure: schema + validation + a deterministic classifier. No I/O, no clock.

// Triage outcomes (§10).
export const TRIAGE_CLASSES = Object.freeze([
  "AUTO_RESOLVED",     // standing policy/architecture/governance/evidence determines the answer; no new policy
  "RECOMMEND_OWNER",   // a strong recommendation exists, but accepting it establishes NEW business/product policy
  "NEEDS_OWNER",       // existing policy/evidence cannot determine the answer
  "OWNER_AUTHORIZATION", // recommendation may be clear, but execution crosses an explicitly protected boundary
]);

const DEFAULTS = Object.freeze({
  options: [], evidence: [], affectedCapabilities: [], recommendation: null,
  requestedAuthority: null, impactOfWaiting: null, status: "OPEN", disposition: null,
});

export function createOwnerDecisionRequest(input = {}) {
  const d = { ...DEFAULTS, ...input };
  d.options = [...(d.options || [])];
  d.evidence = [...(d.evidence || [])];
  d.affectedCapabilities = [...(d.affectedCapabilities || [])];
  return Object.freeze(d);
}

export function validateOwnerDecisionRequest(d) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!d.decisionId, "decisionId is required");
  need(!!d.projectId, "projectId is required");
  need(!!d.originatingWorkstream, "originatingWorkstream is required");
  need(!!d.question, "question is required");
  need(!!d.reason, "reason (why a decision is needed) is required");
  need(Array.isArray(d.options), "options must be an array");
  need(Array.isArray(d.evidence), "evidence must be an array");
  need(d.disposition == null || TRIAGE_CLASSES.includes(d.disposition), "disposition, when present, must be a TRIAGE_CLASS");
  return errors;
}

/**
 * Deterministic triage. Signals are explicit booleans the caller derives from standing
 * authority + the requested action — the classifier does not guess.
 *
 * Precedence (highest first):
 *   1. crossesProtectedBoundary → OWNER_AUTHORIZATION. Execution crossing a protected/
 *      credentialed/deploy boundary always needs the Owner's execution-time authorization,
 *      EVEN IF the direction is obvious. (Ratified policy: a recorded decision establishes
 *      intent, not execution — re-confirm at execution. `requiresReconfirmAtExecution`.)
 *   2. determinedByExistingAuthority && !establishesNewPolicy → AUTO_RESOLVED. Standing
 *      governance/architecture/evidence answers it and no new Owner policy is created.
 *   3. establishesNewPolicy (with a recommendation) → RECOMMEND_OWNER.
 *   4. otherwise → NEEDS_OWNER (undetermined).
 *
 * @param {object} s
 * @param {boolean} s.crossesProtectedBoundary   the REQUESTED ACTION is protected execution
 *                                                (deploy, Rules, grant, prod write, credential)
 * @param {boolean} s.determinedByExistingAuthority standing policy/arch/evidence answers it
 * @param {boolean} s.establishesNewPolicy        accepting the answer creates new business/product policy
 * @param {boolean} [s.hasRecommendation]         a concrete recommendation exists
 * @returns {{ triageClass, reachesOwner, requiresReconfirmAtExecution, reason }}
 */
export function triage(s = {}) {
  let triageClass;
  let reason;
  if (s.crossesProtectedBoundary) {
    triageClass = "OWNER_AUTHORIZATION";
    reason = "requested action is protected execution — needs Owner authorization at execution time (record ≠ execute)";
  } else if (s.determinedByExistingAuthority && !s.establishesNewPolicy) {
    triageClass = "AUTO_RESOLVED";
    reason = "standing governance/architecture/evidence determines the answer and no new Owner policy is created";
  } else if (s.establishesNewPolicy) {
    triageClass = "RECOMMEND_OWNER";
    reason = "a recommendation exists, but accepting it establishes new business/product policy";
  } else {
    triageClass = "NEEDS_OWNER";
    reason = "existing policy/evidence cannot determine the answer";
  }
  return {
    triageClass,
    reachesOwner: triageClass !== "AUTO_RESOLVED",
    requiresReconfirmAtExecution: triageClass === "OWNER_AUTHORIZATION",
    reason,
  };
}

// Ratified policy helper: OWNER_AUTHORIZATION is a two-step — a recorded decision establishes
// intent/direction; the protected action still passes its own execution-time gate.
export function requiresReconfirmAtExecution(triageClass) {
  return triageClass === "OWNER_AUTHORIZATION";
}
