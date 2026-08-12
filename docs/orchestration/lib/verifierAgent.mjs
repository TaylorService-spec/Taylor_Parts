// Verifier Agent — a bounded, evidence-driven check on agent-produced work, layered ON TOP of the
// existing Shared Agent Manager (agentRequest.mjs / agentResult.mjs / agentManager.mjs). This is NOT a
// second orchestrator, queue, scheduler, or authority layer:
//
//   - A verification is just an AgentRequest with mode: "VERIFICATION" (already a first-class mode,
//     see AGENT_MODES in agentRequest.mjs) and an AgentResult with mode-appropriate verdict/findings —
//     the EXISTING contracts, not a parallel one.
//   - Dispatch, dedupe, resource governance, and network awareness are the EXISTING agentManager
//     decideDispatch() — a verification request is just another request in that queue. Nothing here
//     re-implements scheduling or concurrency.
//   - This module adds only what verification specifically needs: shaping a verification request so the
//     Verifier inspects authoritative surfaces INDEPENDENTLY (never just the worker's summary), a typed
//     finding vocabulary for what verification failure looks like, deriving a PASS / RETURN_FOR_CORRECTION
//     / ESCALATE verdict, a bounded correction-loop state machine, and a scope guard so the Verifier can
//     report but never enact scope/architecture authority.
//
// AGENT OUTPUT != PRODUCT AUTHORITY (agent-manager.md) applies here too, twice over: neither the worker's
// result NOR the verifier's result is product authority. A PASS verdict is evidence that claims held up
// under independent inspection — not a product/roadmap decision.
//
// Pure: schema + constructors + validation + deterministic decision functions. No I/O, no clock, no
// agent execution. The session driver runs the bounded Verifier worker (via the harness, same as any
// other dispatched request) and calls back into this module with the result.

import { createAgentRequest, validateAgentRequest } from "./agentRequest.mjs";

export const VERIFIER_VERDICTS = Object.freeze(["PASS", "RETURN_FOR_CORRECTION", "ESCALATE"]);

// Conservative default (Owner-facing requirement: "recommend 2 unless existing policy suggests smaller").
// No standing policy in agent-manager.md suggests smaller, so 2 is the default; callers may lower it.
export const DEFAULT_MAX_CORRECTION_LOOPS = 2;

// What a Verifier is required, at minimum, to be able to detect and report (EOS-ISSUE-819).
export const CLAIM_FAILURE_CATEGORIES = Object.freeze([
  "UNSUPPORTED_CLAIM",        // material claim with no traceable evidence
  "INVENTED_ARTIFACT",        // nonexistent file/function/commit/issue/test/capability
  "CONTRADICTS_REPO_STATE",   // claim contradicts what the repo/context actually shows now
  "SCOPE_DRIFT",              // worker did/claimed more (or different) than the request authorized
  "MISSED_CONSTRAINT",        // an explicit constraint/completion criterion was not met
  "STALE_EVIDENCE",           // evidence predates a materially relevant repo/context change
  "INTERNAL_CONTRADICTION",   // the worker's own result contradicts itself
  "SHOULD_BE_UNVERIFIED",     // claim stated as fact but only supportable as UNVERIFIED
]);

/**
 * Build the AgentRequest for a verification pass over a worker's AgentResult. Reuses the existing
 * request contract (mode: "VERIFICATION") rather than inventing a new envelope.
 *
 * Evidence-driven by construction: allowedSurfaces is the UNION of the original worker request's
 * authoritative surfaces and any surfaces the worker's result itself claims to have touched — the
 * Verifier inspects the same (or a superset of) ground truth the worker had, never just the worker's
 * prose summary. `scope` is copied verbatim from the worker request — the Verifier checks the work
 * done, it does not get a wider mandate than the worker had (no scope creep of its own).
 */
export function createVerificationRequest({
  requestId, workerRequest, workerResult, priority = workerRequest && workerRequest.priority,
  correctionCount = 0, retryAllowance = 0, modelTier,
} = {}) {
  if (!workerRequest) throw new Error("createVerificationRequest: workerRequest is required (the request being verified)");
  if (!workerResult) throw new Error("createVerificationRequest: workerResult is required (the result being verified)");
  const claimedSurfaces = Array.isArray(workerResult.evidence)
    ? workerResult.evidence.map((e) => (typeof e === "string" ? e : e && e.path)).filter(Boolean)
    : [];
  const allowedSurfaces = [...new Set([...(workerRequest.allowedSurfaces || []), ...claimedSurfaces])];
  return createAgentRequest({
    requestId,
    requestedByWorkstream: workerRequest.requestedByWorkstream,
    purpose: `Independently verify result ${workerResult.resultId} for request ${workerRequest.requestId}: ${workerRequest.purpose}`,
    mode: "VERIFICATION",
    modelTier: modelTier || workerRequest.modelTier,
    execution: workerRequest.execution,
    allowedSurfaces,
    scope: [...(workerRequest.scope || [])], // never wider than the worker's authorized scope
    requiresBrowser: false, // the Verifier inspects repo/context surfaces, not a live browser
    mutating: false,        // a Verifier never writes product state — read-only inspection only
    priority,
    retryAllowance,
    outputContract: "structured verdict PASS/FAIL over CLAIM_FAILURE_CATEGORIES findings, each with the exact failed claim, the evidence gap, and a corrective instruction",
    evidence: [],
    correctionCount,
  });
}

/**
 * Second placement (work-intake scope): pre-execution SEMANTIC verification of a request/intake
 * artifact itself — after deterministic contract/preflight validation has already passed, but
 * before the request is dispatched to a worker at all. This is for judgment calls a pure validator
 * cannot make (e.g. "does this purpose/scope actually cohere with governing docs?"), never for
 * syntax a deterministic check already proves (see checkRequiredHeadings below — that boundary is
 * load-bearing: do not spend a Verifier call on what preflight already catches). Reuses the SAME
 * VERIFICATION mode, the SAME dispatch/verdict/session machinery as post-worker verification — the
 * only difference is what's being inspected (the request/intake artifact, not a worker's result).
 */
export function createPreDispatchVerificationRequest({ requestId, targetRequest, priority, retryAllowance = 0, modelTier } = {}) {
  if (!targetRequest) throw new Error("createPreDispatchVerificationRequest: targetRequest is required (the request/intake artifact to semantically check)");
  return createAgentRequest({
    requestId,
    requestedByWorkstream: targetRequest.requestedByWorkstream,
    purpose: `Pre-dispatch semantic verification of request ${targetRequest.requestId}: ${targetRequest.purpose}`,
    mode: "VERIFICATION",
    modelTier: modelTier || targetRequest.modelTier,
    execution: targetRequest.execution,
    allowedSurfaces: [...(targetRequest.allowedSurfaces || [])],
    scope: [...(targetRequest.scope || [])], // never wider than the request it is checking
    requiresBrowser: false,
    mutating: false,
    priority: priority == null ? targetRequest.priority : priority,
    retryAllowance,
    outputContract: "structured verdict PASS/FAIL over CLAIM_FAILURE_CATEGORIES findings on the REQUEST's semantic soundness (not syntax a deterministic preflight already proves)",
    evidence: [],
  });
}

export function validateVerifierFinding(f) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(!!f, "finding is required");
  if (!f) return errors;
  need(CLAIM_FAILURE_CATEGORIES.includes(f.category), `category must be one of ${CLAIM_FAILURE_CATEGORIES.join("/")}`);
  need(!!f.claim, "claim is required (the exact claim that failed verification)");
  need(!!f.evidenceGap, "evidenceGap is required (what independent inspection found instead)");
  need(!!f.correctiveInstruction, "correctiveInstruction is required (what the worker must do to correct it)");
  return errors;
}

const FINDING_DEFAULTS = Object.freeze({ proposesScopeExpansion: false });

export function createVerifierFinding(input = {}) {
  const f = { ...FINDING_DEFAULTS, ...input };
  const errors = validateVerifierFinding(f);
  if (errors.length) throw new Error(`createVerifierFinding: ${errors.join("; ")}`);
  return Object.freeze(f);
}

/**
 * Scope guard: a Verifier may FLAG that work exceeded/differed from its authorized scope
 * (SCOPE_DRIFT is one of the required categories), but it must never BECOME the authority that
 * expands scope. Any finding a caller marks proposesScopeExpansion (the finding itself argues for
 * doing MORE than the original request, rather than reporting a defect in what was claimed) is
 * routed to `outOfBounds` — never surfaced as a corrective instruction the worker should act on.
 * This is the enforcement of "Verifier must not broaden product scope or become product/
 * architecture authority."
 */
export function guardVerifierScope(findings = []) {
  const inBounds = [];
  const outOfBounds = [];
  for (const f of findings || []) {
    (f.proposesScopeExpansion ? outOfBounds : inBounds).push(f);
  }
  return { inBounds, outOfBounds };
}

/**
 * Derive the verifier verdict from the Verifier's OWN AgentResult (never from the worker's
 * self-report). Ambiguity (NOT_APPLICABLE, or a PASS verdict with unresolved findings) is treated
 * conservatively as ESCALATE, not as a silent PASS — mirrors the requirement that unsupported
 * material should be downgraded to UNVERIFIED rather than asserted as fact.
 */
export function deriveVerdict(verifierResult) {
  if (!verifierResult) throw new Error("deriveVerdict: verifierResult is required");
  const { inBounds } = guardVerifierScope(verifierResult.findings || []);
  if (verifierResult.verdict === "PASS" && inBounds.length === 0) return "PASS";
  if (verifierResult.verdict === "FAIL" || inBounds.length > 0) return "RETURN_FOR_CORRECTION";
  return "ESCALATE"; // NOT_APPLICABLE or an unresolved verdict — do not assume PASS
}

const SESSION_DEFAULTS = Object.freeze({ correctionCount: 0, maxLoops: DEFAULT_MAX_CORRECTION_LOOPS, history: [], status: "PENDING", final: false });

export function createVerificationSession(input = {}) {
  const s = { ...SESSION_DEFAULTS, ...input };
  s.history = [...(s.history || [])];
  return Object.freeze(s);
}

/**
 * Bounded correction loop: Worker -> Verifier -> PASS or RETURN_FOR_CORRECTION -> same Worker
 * corrects -> Verifier rechecks. Escalates to the existing orchestrator/Owner boundary (not an
 * indefinite ping-pong) once `maxLoops` corrections have been dispatched and the Verifier still
 * does not return PASS.
 */
export function advanceVerificationSession(session, verifierResult) {
  const verdict = deriveVerdict(verifierResult);
  const { inBounds, outOfBounds } = guardVerifierScope(verifierResult.findings || []);
  const entry = Object.freeze({ verdict, findingsCount: inBounds.length, outOfBoundsCount: outOfBounds.length, resultId: verifierResult.resultId || null });
  const history = [...session.history, entry];

  if (verdict === "PASS") {
    return Object.freeze({ ...session, history, status: "PASS", final: true });
  }
  if (session.correctionCount >= session.maxLoops) {
    return Object.freeze({ ...session, history, status: "ESCALATE", final: true, escalationReason: `correction loop exhausted (${session.maxLoops} max)` });
  }
  if (verdict === "ESCALATE") {
    return Object.freeze({ ...session, history, status: "ESCALATE", final: true, escalationReason: "verifier could not determine a verdict from independent evidence" });
  }
  return Object.freeze({ ...session, history, correctionCount: session.correctionCount + 1, status: "RETURN_FOR_CORRECTION", final: false });
}

/**
 * Runtime/token/cost/loop tracking (agent-manager.md §6 policy: recorded only where the runtime
 * exposes it, never fabricated) so later tests can determine whether verifier spend earns its
 * value. `claimsChanged` is true when a correction pass altered or retracted material claims —
 * the signal that verification actually caught something, not just added overhead.
 */
export function verificationSpendSummary(session, { workerResults = [], verifierResults = [] } = {}) {
  const tokensOf = (results) => results.reduce((a, r) => a + ((r.metrics && typeof r.metrics.tokens === "number") ? r.metrics.tokens : 0), 0);
  const runtimeOf = (results) => results.reduce((a, r) => a + ((r.metrics && typeof r.metrics.runtimeMs === "number") ? r.metrics.runtimeMs : 0), 0);
  const claimsChanged = (workerResults || []).some((r) => r.retracted === true) || session.correctionCount > 0;
  return {
    correctionCount: session.correctionCount,
    status: session.status,
    escalated: session.status === "ESCALATE",
    passed: session.status === "PASS",
    verifierRuns: (verifierResults || []).length,
    verifierTokensTotal: tokensOf(verifierResults),
    verifierRuntimeMsTotal: runtimeOf(verifierResults),
    workerRuns: (workerResults || []).length,
    workerTokensTotal: tokensOf(workerResults),
    claimsChanged,
  };
}

// --- Deterministic preflight (NOT the Verifier Agent) ---------------------------------------------
//
// Some defects are cheap, mechanical, and fully deterministic to catch — e.g. an intake artifact
// missing its required literal section headings (Issue #818: missing "## Scope" / "## Required
// work"). Those MUST be caught by a deterministic check before a Verifier Agent (a paid, evidence-
// gathering agent call) is ever dispatched. This function is intentionally separate from everything
// above: it takes no agent result, makes no independent inspection, and returns no VERIFIER_VERDICT —
// it is plain string matching, and it runs BEFORE any AgentRequest is even created.
export function checkRequiredHeadings(text, requiredHeadings = []) {
  const body = text || "";
  const missing = (requiredHeadings || []).filter((h) => !body.includes(h));
  return { ok: missing.length === 0, missingHeadings: missing };
}
