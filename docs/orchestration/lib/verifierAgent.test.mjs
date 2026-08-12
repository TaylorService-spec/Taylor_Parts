// Tests for the Verifier Agent (EOS-ISSUE-819). Run:
//   node --test docs/orchestration/lib/verifierAgent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRequest } from "./agentRequest.mjs";
import { createAgentResult } from "./agentResult.mjs";
import { decideDispatch } from "./agentManager.mjs";
import {
  VERIFIER_VERDICTS, DEFAULT_MAX_CORRECTION_LOOPS, CLAIM_FAILURE_CATEGORIES,
  createVerificationRequest, createPreDispatchVerificationRequest, createVerifierFinding, validateVerifierFinding,
  guardVerifierScope, deriveVerdict, createVerificationSession, advanceVerificationSession,
  verificationSpendSummary, checkRequiredHeadings,
} from "./verifierAgent.mjs";

const workerReq = (over = {}) => createAgentRequest({
  requestId: "w1", requestedByWorkstream: "Design", purpose: "implement widget", mode: "GENERAL",
  allowedSurfaces: ["src/widget.js"], scope: ["widgets"], ...over,
});
const workerRes = (over = {}) => createAgentResult({
  resultId: "wr1", requestId: "w1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS",
  findings: ["added src/widget.js"], evidence: ["src/widget.js"], ...over,
});

// --- Vocabulary lock ---
test("exported vocabularies have their expected membership", () => {
  assert.deepEqual([...VERIFIER_VERDICTS], ["PASS", "RETURN_FOR_CORRECTION", "ESCALATE"]);
  assert.equal(DEFAULT_MAX_CORRECTION_LOOPS, 2);
  assert.deepEqual([...CLAIM_FAILURE_CATEGORIES], [
    "UNSUPPORTED_CLAIM", "INVENTED_ARTIFACT", "CONTRADICTS_REPO_STATE", "SCOPE_DRIFT",
    "MISSED_CONSTRAINT", "STALE_EVIDENCE", "INTERNAL_CONTRADICTION", "SHOULD_BE_UNVERIFIED",
  ]);
});

// --- Verification request reuses the existing Agent Manager contract ---
test("createVerificationRequest builds a VALID VERIFICATION-mode AgentRequest, never wider scope than the worker", () => {
  const wreq = workerReq();
  const wres = workerRes();
  const vreq = createVerificationRequest({ requestId: "v1", workerRequest: wreq, workerResult: wres });
  assert.equal(vreq.mode, "VERIFICATION");
  assert.equal(vreq.mutating, false);
  assert.deepEqual(vreq.scope, wreq.scope);
  assert.ok(vreq.allowedSurfaces.includes("src/widget.js"));
  const errors = decideDispatch({ request: vreq }).errors;
  assert.ok(!errors || errors.length === 0);
});

test("createVerificationRequest is a normal request in the existing dispatcher — no parallel dispatch path", () => {
  const vreq = createVerificationRequest({ requestId: "v1", workerRequest: workerReq(), workerResult: workerRes() });
  const decision = decideDispatch({ request: vreq, allocations: [], results: [], networkState: "NORMAL" });
  assert.equal(decision.decision, "DISPATCH");
});

// --- Pre-dispatch placement (semantic check of the request/intake itself, before any worker runs) ---
test("createPreDispatchVerificationRequest checks the REQUEST itself, never wider scope, and dispatches through the same path", () => {
  const target = workerReq();
  const vreq = createPreDispatchVerificationRequest({ requestId: "pv1", targetRequest: target });
  assert.equal(vreq.mode, "VERIFICATION");
  assert.deepEqual(vreq.scope, target.scope);
  assert.equal(vreq.mutating, false);
  const decision = decideDispatch({ request: vreq, allocations: [], results: [], networkState: "NORMAL" });
  assert.equal(decision.decision, "DISPATCH");
});

// --- Findings ---
test("a well-formed finding validates; missing fields are caught", () => {
  const good = { category: "INVENTED_ARTIFACT", claim: "added tests/foo.test.js", evidenceGap: "no such file exists in the repo", correctiveInstruction: "remove the claim or add the file" };
  assert.deepEqual(validateVerifierFinding(good), []);
  assert.ok(validateVerifierFinding({ category: "NOT_A_CATEGORY" }).length > 0);
});

test("createVerifierFinding throws on an invalid finding", () => {
  assert.throws(() => createVerifierFinding({ category: "BOGUS" }));
});

// --- Scope guard ---
test("guardVerifierScope routes scope-expanding findings to outOfBounds, never as an actionable instruction", () => {
  const flagged = createVerifierFinding({ category: "SCOPE_DRIFT", claim: "worker also touched billing", evidenceGap: "billing/ was not in allowedSurfaces", correctiveInstruction: "we should also redesign billing while we're here", proposesScopeExpansion: true });
  const real = createVerifierFinding({ category: "INVENTED_ARTIFACT", claim: "added fn doThing()", evidenceGap: "no doThing symbol found", correctiveInstruction: "remove the claim" });
  const { inBounds, outOfBounds } = guardVerifierScope([flagged, real]);
  assert.deepEqual(inBounds, [real]);
  assert.deepEqual(outOfBounds, [flagged]);
});

// --- Verdict derivation (evidence-driven, from the Verifier's OWN result) ---
test("PASS: no findings and verifier verdict PASS", () => {
  const vres = createAgentResult({ resultId: "vr1", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS", findings: [] });
  assert.equal(deriveVerdict(vres), "PASS");
});

test("unsupported/fantasy claim rejection: an invented artifact finding returns RETURN_FOR_CORRECTION", () => {
  const finding = createVerifierFinding({ category: "INVENTED_ARTIFACT", claim: "implemented functions/notARealFile.js", evidenceGap: "file does not exist in the repository tree", correctiveInstruction: "retract the claim or actually create the file and cite it" });
  const vres = createAgentResult({ resultId: "vr1", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "FAIL", findings: [finding] });
  assert.equal(deriveVerdict(vres), "RETURN_FOR_CORRECTION");
});

test("stale/contradictory evidence returns RETURN_FOR_CORRECTION, not a silent PASS", () => {
  const finding = createVerifierFinding({ category: "CONTRADICTS_REPO_STATE", claim: "file X exports Y", evidenceGap: "current repo state shows X does not export Y", correctiveInstruction: "re-verify against current repo state and correct the claim" });
  const vres = createAgentResult({ resultId: "vr2", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "FAIL", findings: [finding] });
  assert.equal(deriveVerdict(vres), "RETURN_FOR_CORRECTION");
});

test("ambiguous verifier result (NOT_APPLICABLE) escalates rather than passing silently", () => {
  const vres = createAgentResult({ resultId: "vr3", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "NOT_APPLICABLE", findings: [] });
  assert.equal(deriveVerdict(vres), "ESCALATE");
});

test("scope-drift-only finding with proposesScopeExpansion does not itself force RETURN_FOR_CORRECTION (guarded out of bounds)", () => {
  const flagged = createVerifierFinding({ category: "SCOPE_DRIFT", claim: "should redesign billing too", evidenceGap: "n/a", correctiveInstruction: "expand scope to billing", proposesScopeExpansion: true });
  const vres = createAgentResult({ resultId: "vr4", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS", findings: [flagged] });
  assert.equal(deriveVerdict(vres), "PASS");
});

// --- Bounded correction loop ---
test("correction success: RETURN_FOR_CORRECTION then PASS within the loop cap", () => {
  let session = createVerificationSession();
  const fail = createAgentResult({ resultId: "vr1", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "FAIL", findings: [createVerifierFinding({ category: "MISSED_CONSTRAINT", claim: "tests were added", evidenceGap: "no new test file found", correctiveInstruction: "add the missing tests" })] });
  session = advanceVerificationSession(session, fail);
  assert.equal(session.status, "RETURN_FOR_CORRECTION");
  assert.equal(session.correctionCount, 1);
  assert.equal(session.final, false);

  const pass = createAgentResult({ resultId: "vr2", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS", findings: [] });
  session = advanceVerificationSession(session, pass);
  assert.equal(session.status, "PASS");
  assert.equal(session.final, true);
});

test("correction exhaustion escalates after the max loop count, never ping-pongs indefinitely", () => {
  let session = createVerificationSession({ maxLoops: 2 });
  const fail = () => createAgentResult({ resultId: "vrX", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "FAIL", findings: [createVerifierFinding({ category: "UNSUPPORTED_CLAIM", claim: "c", evidenceGap: "g", correctiveInstruction: "fix" })] });

  session = advanceVerificationSession(session, fail());
  assert.equal(session.status, "RETURN_FOR_CORRECTION");
  assert.equal(session.correctionCount, 1);

  session = advanceVerificationSession(session, fail());
  assert.equal(session.status, "RETURN_FOR_CORRECTION");
  assert.equal(session.correctionCount, 2);

  session = advanceVerificationSession(session, fail());
  assert.equal(session.status, "ESCALATE");
  assert.equal(session.final, true);
  assert.match(session.escalationReason, /correction loop exhausted/);
});

test("default max correction loops is 2 when unspecified", () => {
  const session = createVerificationSession();
  assert.equal(session.maxLoops, DEFAULT_MAX_CORRECTION_LOOPS);
});

// --- Verifier cannot broaden scope even across a whole session ---
test("verifier inability to broaden scope: an out-of-bounds-only session with PASS verdict never yields a corrective instruction to expand scope", () => {
  const session = createVerificationSession();
  const flagged = createVerifierFinding({ category: "SCOPE_DRIFT", claim: "let's also rebuild the API", evidenceGap: "n/a", correctiveInstruction: "expand scope", proposesScopeExpansion: true });
  const vres = createAgentResult({ resultId: "vr1", requestId: "v1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS", findings: [flagged] });
  const next = advanceVerificationSession(session, vres);
  assert.equal(next.status, "PASS");
  assert.equal(next.history[0].outOfBoundsCount, 1);
  assert.equal(next.history[0].findingsCount, 0);
});

// --- Spend/value tracking ---
test("verificationSpendSummary never fabricates tokens/runtime and reports correction count + outcome", () => {
  const session = createVerificationSession({ correctionCount: 1, status: "PASS" });
  const summary = verificationSpendSummary(session, {
    workerResults: [createAgentResult({ resultId: "wr1", requestId: "w1", routedBackTo: "Design" })],
    verifierResults: [createAgentResult({ resultId: "vr1", requestId: "v1", routedBackTo: "Design", metrics: { tokens: 1200 } })],
  });
  assert.equal(summary.correctionCount, 1);
  assert.equal(summary.passed, true);
  assert.equal(summary.escalated, false);
  assert.equal(summary.verifierTokensTotal, 1200);
  assert.equal(summary.workerTokensTotal, 0); // no metrics.tokens supplied — never fabricated
  assert.equal(summary.claimsChanged, true); // a correction pass occurred
});

// --- Deterministic preflight vs Verifier Agent separation (Issue #818 motivating example) ---
test("deterministic preflight catches a missing required heading WITHOUT any verifier-agent call or AgentRequest", () => {
  const intakeMissingHeadings = "# Issue #818\n\nSome body text with no required sections.";
  const result = checkRequiredHeadings(intakeMissingHeadings, ["## Scope", "## Required work"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingHeadings, ["## Scope", "## Required work"]);
});

test("deterministic preflight passes a well-formed intake and is independent of the VERIFIER_VERDICTS vocabulary", () => {
  const intakeOk = "# Issue #818\n\n## Scope\nx\n\n## Required work\ny\n";
  const result = checkRequiredHeadings(intakeOk, ["## Scope", "## Required work"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingHeadings, []);
  // checkRequiredHeadings returns no VERIFIER_VERDICTS-shaped verdict at all — it is not the Verifier Agent.
  assert.equal(result.verdict, undefined);
});
