import test from "node:test";
import assert from "node:assert/strict";
import {
  preflightSubmission, reviewReturn, detectProtectedActions, checkBudgetFields, pathInScope,
  applyIntakeLabelAfterPreflight, MAX_CORRECTION_ATTEMPTS,
} from "./gatewayVerifier.mjs";

const REPO = "TaylorService-spec/Taylor_Parts";

// A known-good, #815/#817-shaped Issue event: trusted author, correct label, all four required
// sections present and non-empty, unambiguous repo-safe Scope.
function goodEvent(overrides = {}) {
  return {
    action: "labeled",
    label: { name: "eos-intake" },
    sender: { login: "TaylorService-spec" },
    repository: { owner: { login: "TaylorService-spec" }, name: "Taylor_Parts", full_name: REPO },
    issue: {
      number: 817,
      state: "open",
      title: "EOS runtime hardening closeout",
      body: "## Purpose\nHarden the EOS runtime dispatch path.\n\n## Scope\n- docs/orchestration/lib/**\n- docs/orchestration/context/**\n\n## Required work\nAdd the missing guard and its regression test.\n\n## Completion\nReturn COMPLETE with changed files/tests and evidence.",
      author_association: "OWNER",
      html_url: `https://github.com/${REPO}/issues/817`,
      created_at: "2026-08-12T07:00:00Z",
      updated_at: "2026-08-12T07:00:00Z",
      user: { login: "TaylorService-spec" },
    },
    ...overrides,
  };
}

// #818-shaped regression: missing the literal `## Scope` / `## Required work` sections.
function malformedEvent818() {
  return goodEvent({
    issue: {
      ...goodEvent().issue,
      number: 818,
      body: "## Purpose\nDo something useful.\n\n## Completion\nBe done.",
      html_url: `https://github.com/${REPO}/issues/818`,
    },
  });
}

function malformedEvent829() {
  const current = goodEvent().issue.body;
  return goodEvent({ issue: { ...goodEvent().issue, number: 829, html_url: `https://github.com/${REPO}/issues/829`, body: current.replace(/## Purpose[\s\S]*?(?=## Scope)/, "").replace(/## Completion[\s\S]*$/, "") } });
}

test("known-good #817-shaped submission passes preflight unchanged", () => {
  const result = preflightSubmission(goodEvent(), { expectedRepoFullName: REPO });
  assert.equal(result.outcome, "PASS");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.escalations, []);
});

test("#818 regression: missing literal ## Scope / ## Required work fails deterministic preflight before eos-intake", () => {
  const result = preflightSubmission(malformedEvent818(), { expectedRepoFullName: REPO });
  assert.equal(result.outcome, "REJECT_CORRECTABLE");
  const details = result.errors.map((e) => e.detail).join(";");
  assert.match(details, /## Scope/);
  assert.match(details, /## Required work/);
});

test("exact #829 rejected shape: missing Purpose and Completion is REJECT_CORRECTABLE", () => {
  const result = preflightSubmission(malformedEvent829(), { expectedRepoFullName: REPO });
  assert.equal(result.outcome, "REJECT_CORRECTABLE");
  assert.match(result.errors.map((e) => e.detail).join(";"), /## Purpose/);
  assert.match(result.errors.map((e) => e.detail).join(";"), /## Completion/);
});

test("corrected #829 shape passes", () => assert.equal(preflightSubmission(goodEvent({ issue: { ...goodEvent().issue, number: 829 } }), { expectedRepoFullName: REPO }).outcome, "PASS"));
test("known-good #815/#817 bodies pass unchanged", () => {
  const bodies = [
    "## Purpose\nValidate the hardened GitHub Issue to EOS runtime path with a read-only request that must produce only governed EOS artifacts.\n\n## Scope\n- docs/orchestration/context/issue-intake-writeback.mjs\n\n## Required work\n- Read the scoped file.\n- Report its exported functions.\n- Do not modify repository files.\n\n## Completion\nReturn a concise successful result through the normal EOS status, result, and review-ready artifacts.",
    "## Purpose\nRe-validate the hardened GitHub Issue → EOS → Claude → EOS completion path using a harmless read-only task.\n\n## Scope\nRead-only inspection limited to docs/DECISIONS.md and EOS verification records.\n\n## Required work\n- Verify the adapter record.\n- Confirm only permitted artifacts persist.\n- Do not modify workflows or production state.\n\n## Completion\nComplete through the normal governed EOS/Claude workflow and emit COMPLETE and REVIEW_READY.",
  ];
  for (const [index, body] of bodies.entries()) assert.equal(preflightSubmission(goodEvent({ issue: { ...goodEvent().issue, number: index ? 817 : 815, body } }), { expectedRepoFullName: REPO }).outcome, "PASS");
});
test("preflight failure cannot apply eos-intake", async () => { let called=false; const out=await applyIntakeLabelAfterPreflight(malformedEvent829(), { expectedRepoFullName: REPO }, async()=>{called=true;}); assert.equal(out.labelApplied,false); assert.equal(called,false); });
test("preflight PASS can apply eos-intake and proceed to existing path", async () => { const labels=[]; const out=await applyIntakeLabelAfterPreflight(goodEvent(), { expectedRepoFullName: REPO }, async(label)=>labels.push(label)); assert.equal(out.labelApplied,true); assert.deepEqual(labels,["eos-intake"]); });

test("wrong repo/project routing is rejected even with an otherwise valid submission", () => {
  const result = preflightSubmission(goodEvent(), { expectedRepoFullName: "someone-else/other-repo" });
  assert.equal(result.outcome, "REJECT_CORRECTABLE");
  assert.ok(result.errors.some((e) => e.code === "WRONG_REPO"));
});

test("protected/high-risk action language escalates rather than rejects-correctable", () => {
  const event = goodEvent({
    issue: { ...goodEvent().issue, body: goodEvent().issue.body.replace("Purpose\nHarden", "Purpose\nDeploy to production and rotate the credential\n\nCompleted") },
  });
  const result = preflightSubmission(event, { expectedRepoFullName: REPO });
  assert.equal(result.outcome, "ESCALATE");
  assert.ok(result.escalations.some((e) => e.code === "PROTECTED_ACTION"));
});

test("detectProtectedActions names the matched categories", () => {
  assert.deepEqual(detectProtectedActions("please deploy this and update firestore.rules"), ["DEPLOY", "SECURITY_RULES"]);
  assert.deepEqual(detectProtectedActions("just a normal bug fix"), []);
});

test("stale intake: an existing work.json artifact blocks a duplicate/stale dispatch", () => {
  const result = preflightSubmission(goodEvent(), { expectedRepoFullName: REPO, existingWorkArtifact: true });
  assert.equal(result.outcome, "REJECT_CORRECTABLE");
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_INTAKE"));
});

test("bad budget/cost/concurrency fields are rejected", () => {
  assert.deepEqual(checkBudgetFields({ maxSpendUsd: 5, maxConcurrency: 2 }), []);
  const bad = checkBudgetFields({ maxSpendUsd: -1, maxConcurrency: 1.5 });
  assert.equal(bad.length, 2);
});

test("bounded correction exhaustion: after MAX_CORRECTION_ATTEMPTS a still-broken submission escalates and stops", () => {
  const event = malformedEvent818();
  const first = preflightSubmission(event, { expectedRepoFullName: REPO, attempt: 0 });
  const second = preflightSubmission(event, { expectedRepoFullName: REPO, attempt: 1 });
  const exhausted = preflightSubmission(event, { expectedRepoFullName: REPO, attempt: MAX_CORRECTION_ATTEMPTS });
  assert.equal(first.outcome, "REJECT_CORRECTABLE");
  assert.equal(second.outcome, "REJECT_CORRECTABLE");
  assert.equal(exhausted.outcome, "ESCALATE");
  assert.match(exhausted.reason, /correction attempts exhausted/);
});

// ---- Return review ----

const requestedScope = ["docs/orchestration/lib/", "docs/orchestration/context/"];

function completeStatus(overrides = {}) {
  return {
    state: "COMPLETE",
    resultRef: { location: "docs/orchestration/work-intake/results/EOS-ISSUE-817/x.result.json", sha256: "a".repeat(64) },
    ownerActionRequired: false,
    ownerQuestion: null,
    ...overrides,
  };
}

function completeResult(overrides = {}) {
  return {
    contentLocation: "docs/orchestration/work-intake/results/EOS-ISSUE-817/x.content.md",
    verdict: "NOT_APPLICABLE",
    summary: "Added the guard and a regression test.",
    evidence: [{ artifactLocation: "docs/orchestration/lib/gatewayVerifier.mjs" }],
    ...overrides,
  };
}

test("return review: durable terminal state + expected artifacts pass unchanged", () => {
  const result = reviewReturn({ status: completeStatus(), result: completeResult(), requestedScope });
  assert.equal(result.outcome, "PASS");
  assert.deepEqual(result.downgrades, []);
});

test("return review: a non-terminal status is rejected — nothing is ready to report complete", () => {
  const result = reviewReturn({ status: { state: "ACTIVE" }, requestedScope });
  assert.equal(result.outcome, "REJECT_CORRECTABLE");
  assert.ok(result.errors.some((e) => e.code === "NOT_TERMINAL"));
});

test("return review: COMPLETE with no resolvable result artifact is rejected", () => {
  const result = reviewReturn({ status: completeStatus(), result: null, requestedScope });
  assert.ok(result.errors.some((e) => e.code === "MISSING_ARTIFACT"));
});

test("return review: an asserted verdict with no supporting evidence is downgraded to UNVERIFIED", () => {
  const result = reviewReturn({
    status: completeStatus(),
    result: completeResult({ verdict: "CONFIRMED", evidence: [] }),
    requestedScope,
  });
  assert.equal(result.outcome, "PASS"); // a downgrade is not itself a rejection
  assert.ok(result.downgrades.some((d) => d.action === "DOWNGRADED_TO_UNVERIFIED" && d.claim === "CONFIRMED"));
});

test("return review: an unsupported/hedged claim against authoritative repo evidence is downgraded, not overstated", () => {
  const evidenceChecker = (path) => path !== "docs/orchestration/lib/does-not-exist.mjs";
  const result = reviewReturn({
    status: completeStatus(),
    result: completeResult({ evidence: [{ artifactLocation: "docs/orchestration/lib/does-not-exist.mjs" }] }),
    requestedScope,
    evidenceChecker,
  });
  assert.ok(result.downgrades.some((d) => d.claim === "docs/orchestration/lib/does-not-exist.mjs" && d.action === "DOWNGRADED_TO_UNVERIFIED"));
});

test("return review: stale/unsupported hedge language in the summary is flagged", () => {
  const result = reviewReturn({
    status: completeStatus(),
    result: completeResult({ summary: "This should work but is not fully verified." }),
    requestedScope,
  });
  assert.ok(result.downgrades.some((d) => d.action === "FLAGGED_UNSUPPORTED_LANGUAGE"));
});

test("return review: completion outside the requested scope escalates rather than silently passing", () => {
  const result = reviewReturn({
    status: completeStatus(),
    result: completeResult({ evidence: [{ artifactLocation: "functions/scripts/unrelated.js" }] }),
    requestedScope,
  });
  assert.equal(result.outcome, "ESCALATE");
  assert.ok(result.escalations.some((e) => e.code === "SCOPE_MISMATCH"));
});

test("return review: a genuine Owner decision is surfaced distinctly from implementation-detail defects", () => {
  const result = reviewReturn({
    status: completeStatus({ ownerActionRequired: true, ownerQuestion: "Approve the new external dependency?" }),
    result: completeResult(),
    requestedScope,
  });
  assert.equal(result.ownerDecisionRequired, true);
  assert.equal(result.outcome, "PASS");
});

test("return review: ownerActionRequired without a recorded question is a correctable defect, not silently accepted", () => {
  const result = reviewReturn({
    status: completeStatus({ ownerActionRequired: true, ownerQuestion: null }),
    result: completeResult(),
    requestedScope,
  });
  assert.ok(result.errors.some((e) => e.code === "MISSING_OWNER_QUESTION"));
});

test("return review: a second review of the same terminal result is a no-op, avoiding duplicate completion review", () => {
  const result = reviewReturn({ status: completeStatus(), result: completeResult(), requestedScope, alreadyReviewed: true });
  assert.equal(result.outcome, "PASS");
  assert.equal(result.duplicate, true);
});

test("pathInScope: a glob root prefix match, not a substring match", () => {
  assert.equal(pathInScope("docs/orchestration/lib/gatewayVerifier.mjs", ["docs/orchestration/lib/**"]), true);
  assert.equal(pathInScope("functions/scripts/x.js", ["docs/orchestration/lib/**"]), false);
});

// ---- Separation from the internal Agent Manager Verifier (#819) ----
// The Gateway Verifier operates ONLY on the ChatGPT<->EOS boundary artifacts (the raw GitHub Issue
// event, and the durable status/result manifests). It never receives or inspects an in-EOS worker's
// internal reasoning/tool-call trace — that is the Agent Manager Verifier's (#819) surface, not
// this module's. This test documents that boundary: the public API surface takes only
// boundary-level shapes, never an agent trace/tool-log shape.
test("Gateway Verifier's public API only accepts boundary artifacts, not internal agent traces", () => {
  const result = reviewReturn({
    status: completeStatus(),
    result: completeResult(),
    requestedScope,
    // an internal agent trace, if accidentally passed through, is simply ignored — it is not part
    // of this module's contract and must not change the outcome.
    agentTrace: { toolCalls: [{ name: "Bash", input: "rm -rf /" }] },
  });
  assert.equal(result.outcome, "PASS");
});
