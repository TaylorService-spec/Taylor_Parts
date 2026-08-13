// Gateway Verifier (#820) — a lightweight boundary guard around ChatGPT-originated EOS work.
//
// Two bounded phases, both PURE (no I/O, no clock, no network — every fact the checks need is
// injected by the caller):
//
//   1. preflightSubmission(event, ctx) — runs on the raw GitHub Issue event BEFORE the existing
//      `eos-issue-intake` adapter (issue-intake-producer.mjs) builds a work.json artifact.
//   2. reviewReturn(input)             — runs AFTER EOS reaches a terminal status (COMPLETE/FAILED)
//      and BEFORE ChatGPT-side reporting treats the work as complete/review-ready.
//
// This is a boundary guard, not another orchestrator, scheduler, queue, or product-authority
// layer: it never selects work, never executes, never grants authority, and never broadens or
// narrows the requested scope. Deterministic checks (required sections, hash/state shape, keyword
// scan, glob-prefix membership) are code-owned here; anything that needs repository/context
// judgment (e.g. "does this claimed file really contain what the summary says") is delegated to an
// INJECTED `evidenceChecker` seam — this module never fetches anything itself.
//
// Coordination with #819 (Agent Manager Verifier): that module protects worker output INSIDE EOS
// (agent-to-agent, mid-execution). This module protects the ChatGPT <-> EOS BOUNDARY — one
// submission in, one result out. Neither module executes work, selects work, or supersedes the
// other; a Gateway PASS is a precondition for `eos-intake`, not a substitute for the Agent Manager
// Verifier's in-EOS checks, and vice versa.
//
// Structured outcomes: PASS, REJECT_CORRECTABLE, ESCALATE. REJECT_CORRECTABLE means the deterministic
// checks found something the producer can fix (missing section, wrong repo, bad field) — retry is
// expected. ESCALATE means the gateway cannot or must not resolve it itself (protected/high-risk
// action, scope creep in the returned result, correction attempts exhausted) — an Owner/ChatGPT
// decision is needed and the gateway STOPS, it does not loop indefinitely.

import { validateIssueEvent, section } from "../context/issue-intake-producer.mjs";

export const GATEWAY_OUTCOMES = Object.freeze(["PASS", "REJECT_CORRECTABLE", "ESCALATE"]);

// "Prevent endless loops: deterministic correction where possible; maximum 2 semantic correction
// attempts; then ESCALATE and stop." — attempt is 0-based (0 = first try); attempt 2 is the 3rd try,
// which is beyond the 2 allowed CORRECTIONS, so it always escalates.
export const MAX_CORRECTION_ATTEMPTS = 2;

const PROTECTED_ACTION_PATTERNS = Object.freeze([
  { category: "SECURITY_RULES", pattern: /firestore\.rules|security rules/i },
  { category: "DEPLOY", pattern: /\bdeploy(ment)?\b|\bhosting\b|production release/i },
  { category: "CREDENTIAL", pattern: /\bcredential(s)?\b|api[- ]?key|\bsecret(s)?\b(?!\s+broker)/i },
  { category: "CAPABILITY_GRANT", pattern: /capability grant|role change|permission grant|grant access/i },
  { category: "DESTRUCTIVE", pattern: /\bmigration\b|\brollback\b|force[- ]?push|drop table|delete (all|production)|\bdestructive\b/i },
  { category: "SPEND", pattern: /\bspend\b|budget increase|\bbilling\b/i },
]);

const HEDGE_LANGUAGE = /\b(probably|should work|likely|i believe|presumably|seems to|might have|appears to|not fully verified|untested but)\b/i;

/** Scan free text for protected/high-risk action categories. Returns a deduped, sorted list. */
export function detectProtectedActions(text) {
  const hay = String(text || "");
  const hits = new Set();
  for (const { category, pattern } of PROTECTED_ACTION_PATTERNS) if (pattern.test(hay)) hits.add(category);
  return [...hits].sort();
}

/** Cheap heuristic consistency check between a submission's Scope and Required work sections. */
export function checkScopeConsistency(body) {
  const errors = [];
  const scope = section(body, "Scope");
  const requiredWork = section(body, "Required work");
  const completion = section(body, "Completion");
  if (scope && requiredWork && requiredWork.trim().length < 8) {
    errors.push({ code: "THIN_REQUIRED_WORK", detail: "Required work section is present but too thin to act on" });
  }
  if (scope && completion && completion.trim().length < 8) {
    errors.push({ code: "THIN_COMPLETION", detail: "Completion section is present but too thin to verify against" });
  }
  return { errors };
}

/** Validate optional budget/cost/concurrency fields, when a submission includes them. */
export function checkBudgetFields(fields = {}) {
  const errors = [];
  const numeric = (key, { integer = false, min = 0 } = {}) => {
    if (!(key in fields) || fields[key] == null) return;
    const v = fields[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || (integer && !Number.isInteger(v))) {
      errors.push({ code: "BAD_BUDGET_FIELD", detail: `${key} must be a finite ${integer ? "integer" : "number"} >= ${min}` });
    }
  };
  numeric("maxSpendUsd");
  numeric("budgetUsd");
  numeric("costCeilingUsd");
  numeric("maxConcurrency", { integer: true, min: 1 });
  return errors;
}

/** Strip a trailing glob wildcard so a result path can be checked against an allowed scope root. */
function globRoot(glob) {
  return String(glob || "").replace(/\*\*?$/, "");
}

/** Does `path` fall under any of the requested scope globs (prefix match on the glob root)? */
export function pathInScope(path, scopeGlobs = []) {
  if (!path) return false;
  return scopeGlobs.some((glob) => path.startsWith(globRoot(glob)));
}

/**
 * Submission preflight — runs on the raw GitHub Issue event BEFORE eos-intake. Reuses the
 * governed producer contract (validateIssueEvent: required non-empty sections, trusted author,
 * open issue, correct label) as the deterministic base, then layers the gateway's own boundary
 * checks. Never mutates the event and never adapts it into a work.json artifact — that remains
 * `issue-intake-producer.mjs`'s job.
 *
 * @param {object} event a GitHub `issues.labeled` webhook payload
 * @param {object} [ctx]
 * @param {string} [ctx.expectedRepoFullName] e.g. "TaylorService-spec/Taylor_Parts" — target repo/project identity
 * @param {boolean} [ctx.existingWorkArtifact] a work.json for this requestId already exists (stale/duplicate)
 * @param {string} [ctx.now] injected ISO now, for a staleness check
 * @param {number} [ctx.maxIssueAgeMs] refuse an issue whose updated_at is older than this window
 * @param {object} [ctx.budgetFields] any submitted budget/cost/concurrency fields
 * @param {number} [ctx.attempt] 0-based correction attempt count for THIS requestId
 * @returns {{ outcome, errors, escalations, warnings, reason }}
 */
export function preflightSubmission(event, {
  expectedRepoFullName = null,
  existingWorkArtifact = false,
  now = null,
  maxIssueAgeMs = null,
  budgetFields = {},
  attempt = 0,
} = {}) {
  const errors = [];
  const escalations = [];

  // 1. Governed producer contract — required sections/non-empty content, trusted author, label,
  //    open issue. This is the exact check that fails #818 (missing literal `## Scope` /
  //    `## Required work`) before eos-intake ever adapts the event.
  for (const detail of validateIssueEvent(event)) errors.push({ code: "PRODUCER_CONTRACT", detail });

  // 2. Target repo/project identity.
  const repoFullName = event?.repository?.full_name
    || (event?.repository?.owner?.login && event?.repository?.name ? `${event.repository.owner.login}/${event.repository.name}` : null);
  if (!expectedRepoFullName || !repoFullName || repoFullName !== expectedRepoFullName) {
    errors.push({ code: "WRONG_REPO", detail: `expected explicit repo ${expectedRepoFullName || "none"}, got ${repoFullName || "none"}` });
  }

  // 3. Intake-label intent (belt-and-braces: validateIssueEvent already checks this, but the
  //    gateway names it as its own boundary check so a future producer contract change can't
  //    silently drop label enforcement).
  if (event?.label?.name !== "eos-intake") {
    errors.push({ code: "WRONG_LABEL_INTENT", detail: `label must be exactly eos-intake, got ${event?.label?.name ?? "none"}` });
  }

  // 4. Internally consistent scope/constraints/completion criteria (heuristic, non-fatal).
  const consistency = checkScopeConsistency(event?.issue?.body);
  errors.push(...consistency.errors);
  const warnings = [];

  // 5. Cheap authoritative stale-state checks.
  if (existingWorkArtifact) {
    errors.push({ code: "DUPLICATE_INTAKE", detail: "a work.json artifact already exists for this requestId — refusing a duplicate/stale dispatch" });
  }
  if (maxIssueAgeMs != null && now && event?.issue?.updated_at) {
    const ageMs = Date.parse(now) - Date.parse(event.issue.updated_at);
    if (Number.isFinite(ageMs) && ageMs > maxIssueAgeMs) {
      errors.push({ code: "STALE_ISSUE", detail: `issue.updated_at is older than the allowed ${maxIssueAgeMs}ms freshness window` });
    }
  }

  // 6. Protected/high-risk action identification — this is a judgment call the gateway cannot
  //    resolve itself, so it escalates rather than rejects-correctable.
  const protectedHits = detectProtectedActions(`${event?.issue?.title || ""}\n${event?.issue?.body || ""}`);
  if (protectedHits.length) {
    escalations.push({ code: "PROTECTED_ACTION", detail: `possible protected/high-risk action(s) named in the submission: ${protectedHits.join(", ")}` });
  }

  // 7. Budget/cost/concurrency fields, when present.
  errors.push(...checkBudgetFields(budgetFields));

  // 8. Routability — this producer only ever adapts into the github-issue-intake / orchestration
  //    domain; a submission that names no reachable EOS domain surface (an empty Scope) cannot be
  //    routed. (Non-empty Scope is already enforced by the producer contract above; this exists so
  //    routability failures are legible on their own, not folded into a generic section error.)
  const scopeGlobs = section(event?.issue?.body, "Scope").split("\n").map((l) => l.trim().replace(/^[-*]\s+/, "")).filter(Boolean);
  if (!scopeGlobs.length) {
    errors.push({ code: "NOT_ROUTABLE", detail: "no Scope path globs — cannot route to an EOS domain" });
  }

  return finalizeGatewayOutcome({ errors, escalations, warnings, attempt });
}

/** The ChatGPT submission enforcement point: the label callback is unreachable without PASS. */
export async function applyIntakeLabelAfterPreflight(event, context, applyLabel) {
  const outcome = preflightSubmission(event, context);
  if (outcome.outcome !== "PASS") return Object.freeze({ ...outcome, labelApplied: false });
  if (typeof applyLabel !== "function") throw new Error("applyIntakeLabelAfterPreflight: applyLabel callback is required after PASS");
  await applyLabel("eos-intake");
  return Object.freeze({ ...outcome, labelApplied: true });
}

/**
 * Return review — runs after EOS reaches a terminal status, before ChatGPT-side reporting treats
 * the work as complete/review-ready. Confirms a durable terminal state + expected artifacts,
 * spot-checks claims, prevents unsupported claims from being overstated, confirms completion
 * matches the requested scope, separates genuine Owner decisions from implementation detail, and
 * is itself idempotent (a second review of the same terminal result is a no-op PASS, not a
 * re-review).
 *
 * @param {object} p
 * @param {object} p.status the durable intake status artifact (intakeStatus.mjs shape)
 * @param {object} [p.result] the content-addressed result manifest (workIntake.mjs shape), when COMPLETE
 * @param {string[]} [p.requestedScope] the original work.json `scope` globs
 * @param {(claim:string)=>boolean} [p.evidenceChecker] injected authoritative repo-evidence check
 * @param {boolean} [p.alreadyReviewed] a prior review already ran for this exact terminal state
 * @param {number} [p.attempt] 0-based correction attempt count
 * @returns {{ outcome, errors, escalations, downgrades, ownerDecisionRequired, reason, duplicate }}
 */
export function reviewReturn({
  status = null, result = null, requestedScope = [], evidenceChecker = null, alreadyReviewed = false, attempt = 0,
} = {}) {
  if (alreadyReviewed) {
    return Object.freeze({
      outcome: "PASS", duplicate: true, errors: [], escalations: [], downgrades: [],
      ownerDecisionRequired: status?.ownerActionRequired === true,
      reason: "a return review already ran for this terminal state — avoiding a duplicate completion review",
    });
  }

  const errors = [];
  const escalations = [];
  const downgrades = [];
  const TERMINAL_STATES = Object.freeze(["COMPLETE", "FAILED"]);

  // 1. Durable terminal state + expected artifacts.
  if (!status || !TERMINAL_STATES.includes(status.state)) {
    errors.push({ code: "NOT_TERMINAL", detail: `status.state must be COMPLETE or FAILED, got ${status?.state ?? "none"}` });
  }
  if (status?.state === "COMPLETE") {
    if (!status.resultRef) errors.push({ code: "MISSING_RESULT_REF", detail: "COMPLETE status is missing its resultRef" });
    if (!result || !result.contentLocation) errors.push({ code: "MISSING_ARTIFACT", detail: "COMPLETE status has no resolvable content artifact" });
  }

  // 2 + 3. Spot-check highest-impact claims; prevent unsupported/UNVERIFIED claims from being
  // overstated. A claimed verdict with no supporting evidence, or a claimed path that fails an
  // injected authoritative repo-evidence check, is DOWNGRADED — never silently reported as-is.
  if (result) {
    if (result.verdict && result.verdict !== "NOT_APPLICABLE" && !(result.evidence && result.evidence.length)) {
      downgrades.push({ claim: result.verdict, action: "DOWNGRADED_TO_UNVERIFIED", detail: "verdict asserted with no supporting evidence references" });
    }
    if (evidenceChecker) {
      for (const ref of result.evidence || []) {
        const path = ref?.artifactLocation;
        if (path && !evidenceChecker(path)) {
          downgrades.push({ claim: path, action: "DOWNGRADED_TO_UNVERIFIED", detail: "claimed evidence path did not pass the authoritative repo-evidence check" });
        }
      }
    }
    if (HEDGE_LANGUAGE.test(result.summary || "")) {
      downgrades.push({ claim: result.summary, action: "FLAGGED_UNSUPPORTED_LANGUAGE", detail: "summary uses hedged/unverified language" });
    }
  }

  // 4. Confirm completion matches requested scope — the gateway cannot resolve a scope mismatch
  // itself (it would mean either the work overran its authorized boundary or the scope was too
  // narrow), so it escalates rather than rejects-correctable.
  if (result && requestedScope.length) {
    const outOfScope = (result.evidence || [])
      .map((e) => e?.artifactLocation)
      .filter(Boolean)
      .filter((path) => !pathInScope(path, requestedScope));
    if (outOfScope.length) {
      escalations.push({ code: "SCOPE_MISMATCH", detail: `result touches paths outside the requested scope: ${outOfScope.join(", ")}` });
    }
  }

  // 5. Separate genuine Owner decisions from implementation detail — a real Owner-decision flag
  // must carry its question; a missing question is a deterministic, correctable defect, not an
  // escalation in itself.
  const ownerDecisionRequired = status?.ownerActionRequired === true;
  if (ownerDecisionRequired && !status.ownerQuestion) {
    errors.push({ code: "MISSING_OWNER_QUESTION", detail: "ownerActionRequired is true but no ownerQuestion is recorded" });
  }

  return finalizeGatewayOutcome({ errors, escalations, warnings: [], attempt, extra: { downgrades, ownerDecisionRequired, duplicate: false } });
}

/** Shared PASS / REJECT_CORRECTABLE / ESCALATE decision, including the bounded correction budget. */
function finalizeGatewayOutcome({ errors, escalations, warnings = [], attempt = 0, extra = {} }) {
  let outcome;
  let reason;
  if (escalations.length) {
    outcome = "ESCALATE";
    reason = `escalated: ${escalations.map((e) => e.code).join(", ")}`;
  } else if (errors.length && attempt >= MAX_CORRECTION_ATTEMPTS) {
    outcome = "ESCALATE";
    reason = `correction attempts exhausted (${attempt}/${MAX_CORRECTION_ATTEMPTS}) — stopping rather than looping`;
  } else if (errors.length) {
    outcome = "REJECT_CORRECTABLE";
    reason = `correctable: ${errors.map((e) => e.code).join(", ")}`;
  } else {
    outcome = "PASS";
    reason = "no defects found";
  }
  return Object.freeze({ outcome, errors: Object.freeze(errors), escalations: Object.freeze(escalations), warnings: Object.freeze(warnings), reason, ...extra });
}
