// Tests for the Shared Agent Manager stack (request/result contracts, resource
// governor, network state, dispatcher). Run:
//   node --test docs/orchestration/lib/agentManager.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRequest, validateAgentRequest, requestFingerprint, AGENT_MODES, MODEL_TIERS, BUDGET_CLASSES, EXECUTION, REQUEST_STATUS } from "./agentRequest.mjs";
import { createAgentResult, validateAgentResult, isReusableResult, RESULT_STATUS, VERDICTS } from "./agentResult.mjs";
import { CAPACITY, classifyResourceNeed, allocate, capacitySnapshot } from "./resourceGovernor.mjs";
import { transition, remotePolicy, NETWORK_STATES, SIGNALS } from "./networkState.mjs";
import { decideDispatch, findEquivalentResult, selectNextQueuedRequest, efficiencyMetrics, planIntegrationBacklog, DISPATCH_DECISIONS } from "./agentManager.mjs";

const req = (over = {}) => createAgentRequest({ requestId: "r1", requestedByWorkstream: "Design", purpose: "verify X", outputContract: "PASS/FAIL", ...over });

// Lock the exported vocabularies by name (closes the DR-001-R1 nuance: previously exercised only transitively).
test("exported vocabularies have their expected membership (guards silent drift)", () => {
  assert.deepEqual([...AGENT_MODES], ["DISCOVERY", "VERIFICATION", "REVIEW", "PERSONA", "GENERAL"]);
  assert.deepEqual([...MODEL_TIERS], ["economy", "standard", "advanced"]);
  assert.deepEqual([...BUDGET_CLASSES], ["TINY", "SMALL", "MEDIUM", "LARGE"]);
  assert.deepEqual([...EXECUTION], ["REMOTE", "LOCAL"]);
  assert.ok(REQUEST_STATUS.includes("READY_BUT_WAITING_RESOURCE") && REQUEST_STATUS.includes("DISPATCHED"));
  assert.deepEqual([...RESULT_STATUS], ["COMPLETE", "FAILED"]);
  assert.deepEqual([...VERDICTS], ["PASS", "FAIL", "NOT_APPLICABLE"]);
  assert.deepEqual([...NETWORK_STATES], ["NORMAL", "NETWORK_PRESSURE", "NETWORK_UNAVAILABLE", "RECOVERY"]);
  assert.ok(SIGNALS.includes("UNAVAILABLE_DETECTED") && SIGNALS.includes("STABILITY_WINDOW_ELAPSED"));
  assert.deepEqual([...DISPATCH_DECISIONS], ["REJECT_INVALID", "DEDUPE_REUSE", "WAIT_NETWORK", "READY_BUT_WAITING_RESOURCE", "DISPATCH"]);
});

// --- Request contract ---
test("a well-formed request validates; missing required fields are caught", () => {
  assert.deepEqual(validateAgentRequest(req()), []);
  assert.ok(validateAgentRequest(createAgentRequest({ requestId: "r" })).length > 0); // no workstream/purpose/outputContract
});

test("requiresBrowser implies REMOTE execution", () => {
  const bad = createAgentRequest({ requestId: "r", requestedByWorkstream: "UX", purpose: "p", outputContract: "o", requiresBrowser: true, execution: "LOCAL" });
  assert.ok(validateAgentRequest(bad).some((e) => /requiresBrowser implies/.test(e)));
});

test("fingerprint is stable across id/priority and ignores ordering of surfaces", () => {
  const a = req({ requestId: "a", priority: 1, allowedSurfaces: ["x", "y"] });
  const b = req({ requestId: "b", priority: 9, allowedSurfaces: ["y", "x"] });
  assert.equal(requestFingerprint(a), requestFingerprint(b));
});

// --- Result contract ---
test("result validates and reusability excludes contaminated/retracted/failed", () => {
  const good = createAgentResult({ resultId: "res1", requestId: "r1", routedBackTo: "Design", status: "COMPLETE", verdict: "PASS" });
  assert.deepEqual(validateAgentResult(good), []);
  assert.ok(isReusableResult(good));
  assert.ok(!isReusableResult(createAgentResult({ resultId: "x", requestId: "r1", routedBackTo: "Design", status: "COMPLETE", retracted: true })));
  assert.ok(!isReusableResult(createAgentResult({ resultId: "x", requestId: "r1", routedBackTo: "Design", status: "FAILED" })));
});

test("result never fabricates tokens — metrics.tokens only when a number", () => {
  const r = createAgentResult({ resultId: "res", requestId: "r1", routedBackTo: "Design" });
  assert.equal(r.metrics.tokens, undefined); // absent, not zero
});

// --- Resource governor ---
test("LOCAL work consumes no REMOTE_AI slot; REMOTE work consumes one", () => {
  assert.equal(classifyResourceNeed(req({ execution: "LOCAL" })).remoteAi, 0);
  assert.equal(classifyResourceNeed(req({ execution: "REMOTE" })).remoteAi, 1);
});

test("global REMOTE_AI cap = 2; the 3rd concurrent remote agent waits", () => {
  const need = classifyResourceNeed(req());
  const two = [need, need];
  assert.equal(allocate(two, need).decision, "WAIT_RESOURCE");
  assert.deepEqual(allocate(two, need).waitingOn, ["REMOTE_AI"]);
  assert.equal(allocate([need], need).decision, "GRANT"); // 2nd is fine
});

test("browser cap = 1 and mutating remote is sequential (cap 1)", () => {
  const browser = classifyResourceNeed(req({ requiresBrowser: true }));
  assert.equal(allocate([browser], browser).waitingOn.includes("BROWSER_REMOTE"), true);
  const mut = classifyResourceNeed(req({ mutating: true }));
  assert.equal(allocate([mut], mut).waitingOn.includes("MUTATING_REMOTE"), true);
});

test("capacitySnapshot reports used/total per resource", () => {
  const snap = capacitySnapshot([classifyResourceNeed(req())]);
  assert.deepEqual(snap.remoteAi, { used: 1, total: CAPACITY.REMOTE_AI });
});

// --- Network state ---
test("network transitions: unavailable → recovery → normal only after a stability window", () => {
  let s = "NORMAL";
  s = transition(s, "UNAVAILABLE_DETECTED"); assert.equal(s, "NETWORK_UNAVAILABLE");
  s = transition(s, "RECOVERED"); assert.equal(s, "RECOVERY");
  s = transition(s, "STABILITY_WINDOW_ELAPSED"); assert.equal(s, "NORMAL");
});

test("no new remote work while unavailable/recovery; local always continues; no aggressive retry", () => {
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").allowNewRemote, false);
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").continueLocal, true);
  assert.equal(remotePolicy("NETWORK_UNAVAILABLE").retry, "NONE");
  assert.equal(remotePolicy("RECOVERY").allowNewRemote, false);
  assert.equal(remotePolicy("NORMAL").allowNewRemote, true);
});

// --- Dispatcher ---
test("invalid request → REJECT_INVALID", () => {
  const d = decideDispatch({ request: createAgentRequest({ requestId: "x" }) });
  assert.equal(d.decision, "REJECT_INVALID");
});

test("equivalent existing result → DEDUPE_REUSE (avoid rerun when nothing changed)", () => {
  const request = req();
  const requestsById = new Map([["r1", request]]);
  const results = [createAgentResult({ resultId: "res", requestId: "r1", routedBackTo: "Design", status: "COMPLETE" })];
  const again = req({ requestId: "r2" }); // same fingerprint, different id
  const d = decideDispatch({ request: again, results, requestsById });
  assert.equal(d.decision, "DEDUPE_REUSE");
});

test("remote request while NETWORK_UNAVAILABLE → WAIT_NETWORK (local would still dispatch)", () => {
  assert.equal(decideDispatch({ request: req(), networkState: "NETWORK_UNAVAILABLE" }).decision, "WAIT_NETWORK");
  assert.equal(decideDispatch({ request: req({ requestId: "r9", execution: "LOCAL" }), networkState: "NETWORK_UNAVAILABLE" }).decision, "DISPATCH");
});

test("no free slot → READY_BUT_WAITING_RESOURCE; else DISPATCH", () => {
  const need = classifyResourceNeed(req());
  assert.equal(decideDispatch({ request: req(), allocations: [need, need] }).decision, "READY_BUT_WAITING_RESOURCE");
  assert.equal(decideDispatch({ request: req() }).decision, "DISPATCH");
});

test("queue selection: blocking first, then priority, then declared order", () => {
  const requests = [
    req({ requestId: "a", priority: 1, blocking: false }),
    req({ requestId: "b", priority: 9, blocking: true }),
    req({ requestId: "c", priority: 2, blocking: false }),
  ];
  assert.equal(selectNextQueuedRequest(requests).requestId, "b"); // blocking wins despite worse priority
});

test("efficiency metrics derive from durable records; tokens only where reported", () => {
  const requests = [req({ requestId: "a", status: "PENDING" }), req({ requestId: "b", status: "DEDUPED" })];
  const results = [createAgentResult({ resultId: "res", requestId: "a", routedBackTo: "Design", findings: ["f1", "f2"], metrics: { tokens: 1000 } })];
  const m = efficiencyMetrics(requests, results);
  assert.equal(m.requestsCreated, 2);
  assert.equal(m.dedupedOrReused, 1);
  assert.equal(m.acceptedFindings, 2);
  assert.equal(m.tokensReported, 1);
  assert.equal(m.tokensTotal, 1000);
});

const integration = (requestId, over = {}) => ({
  requestId, target: { repo: "TaylorService-spec/Taylor_Parts", branch: "main" },
  approvedArtifact: { kind: "PATCH", location: `results/${requestId}.patch`, sha256: "a".repeat(64) },
  priority: 50, integrityPriority: "NORMAL", dependencies: [], paths: [`src/${requestId}.mjs`], overlappingPaths: [],
  verificationState: "PASS", scopeState: "PASS", hashState: "PASS", approvalState: "APPROVED", integrationReadiness: "READY", blocker: null, ...over,
});

test("integration backlog orders dependencies before security/integrity priority", () => {
  const plan = planIntegrationBacklog([
    integration("dependent", { dependencies: ["base"], integrityPriority: "SECURITY" }),
    integration("base", { priority: 99 }),
    integration("integrity", { integrityPriority: "INTEGRITY", priority: 1 }),
  ]);
  assert.deepEqual(plan.ordered.map((item) => item.requestId), ["integrity", "base", "dependent"]);
});

test("conflicting patches are adjacent, overlap is tracked, and same target exposes one next item", () => {
  const plan = planIntegrationBacklog([
    integration("a", { priority: 2, paths: ["src/shared.mjs"] }),
    integration("independent", { priority: 1 }),
    integration("b", { priority: 3, paths: ["src/shared.mjs"] }),
  ]);
  assert.deepEqual(plan.ordered.map((item) => item.requestId), ["a", "b", "independent"]);
  assert.deepEqual(plan.ordered[0].overlappingPaths, ["src/shared.mjs"]);
  assert.equal(plan.nextByTarget["TaylorService-spec/Taylor_Parts#main"].requestId, "a");
});

test("independent targets retain normal priority/order", () => {
  const plan = planIntegrationBacklog([integration("later", { priority: 9 }), integration("first", { priority: 1, target: { repo: "other/repo", branch: "release" } })]);
  assert.deepEqual(plan.ordered.map((item) => item.requestId), ["first", "later"]);
});

test("blocked or unverified work never becomes integration-ready", () => {
  const plan = planIntegrationBacklog([integration("blocked", { blocker: "Owner approval required" }), integration("unverified", { verificationState: "PENDING" }), integration("bad-hash", { hashState: "FAILED" })]);
  assert.equal(plan.ordered.length, 0);
  assert.deepEqual(plan.blocked.map((item) => item.requestId), ["blocked", "unverified", "bad-hash"]);
});

test("dependency cycles fail closed instead of looping", () => {
  const plan = planIntegrationBacklog([integration("a", { dependencies: ["b"] }), integration("b", { dependencies: ["a"] })]);
  assert.equal(plan.ordered.length, 0);
  assert.ok(plan.blocked.every((item) => /cycle/.test(item.blocker)));
});

test("a valid INTEGRATED record satisfies its dependent", () => {
  const plan = planIntegrationBacklog([integration("done", { integrationReadiness: "INTEGRATED" }), integration("next", { dependencies: ["done"] })]);
  assert.deepEqual(plan.ordered.map((item) => item.requestId), ["next"]);
  assert.equal(plan.blocked.length, 0);
});

test("INTEGRATED with failed verification does not satisfy its dependent", () => {
  const plan = planIntegrationBacklog([integration("done", { integrationReadiness: "INTEGRATED", verificationState: "FAILED" }), integration("next", { dependencies: ["done"] })]);
  assert.equal(plan.ordered.length, 0);
  assert.match(plan.blocked.find((item) => item.requestId === "done").blocker, /verification/);
  assert.match(plan.blocked.find((item) => item.requestId === "next").blocker, /dependency/);
});

test("INTEGRATED with failed scope, hash, or approval never satisfies dependents", () => {
  for (const invalid of [{ scopeState: "FAILED" }, { hashState: "FAILED" }, { approvalState: "REJECTED" }]) {
    const plan = planIntegrationBacklog([integration("done", { integrationReadiness: "INTEGRATED", ...invalid }), integration("next", { dependencies: ["done"] })]);
    assert.equal(plan.ordered.length, 0);
    assert.ok(plan.blocked.some((item) => item.requestId === "done"));
    assert.ok(plan.blocked.some((item) => item.requestId === "next"));
  }
});

test("ordinary Agent Manager selection is unchanged with no integration backlog item", () => {
  const requests = [req({ requestId: "normal", priority: 3 })];
  assert.equal(selectNextQueuedRequest(requests).requestId, "normal");
  assert.deepEqual(planIntegrationBacklog([]), { ordered: [], nextByTarget: {}, blocked: [] });
});

// ── decideIntakeDispatch: don't re-run completed worker jobs (Agent Manager DEDUPE_REUSE for intake) ──────
import { decideIntakeDispatch } from "./agentManager.mjs";

const completeStatus = (sha) => ({ state: "COMPLETE", pointer: "status://EOS-ISSUE-9", result: "result://EOS-ISSUE-9", resultRef: { location: "docs/.../x.result.json", sha256: "b".repeat(64) }, workArtifact: { location: "docs/.../EOS-ISSUE-9.work.json", sha256: sha } });

test("decideIntakeDispatch: a COMPLETE status for the same work sha => DEDUPE_REUSE (skip, don't re-run)", () => {
  const d = decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "a".repeat(64), committedStatus: completeStatus("a".repeat(64)) });
  assert.equal(d.decision, "DEDUPE_REUSE");
  assert.ok(d.resultRef);
});

test("decideIntakeDispatch: no status / non-terminal / FAILED / changed sha => DISPATCH (runs, self-heals)", () => {
  assert.equal(decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "a".repeat(64), committedStatus: null }).decision, "DISPATCH");
  assert.equal(decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "a".repeat(64), committedStatus: { state: "FAILED" } }).decision, "DISPATCH");
  assert.equal(decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "a".repeat(64), committedStatus: { state: "CORRECTING", workArtifact: { sha256: "a".repeat(64) } } }).decision, "DISPATCH");
  // COMPLETE but the authorized work changed (new sha) => re-dispatch
  assert.equal(decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "c".repeat(64), committedStatus: completeStatus("a".repeat(64)) }).decision, "DISPATCH");
  // COMPLETE but missing resultRef (incomplete record) => don't trust it, re-dispatch
  assert.equal(decideIntakeDispatch({ requestId: "EOS-ISSUE-9", workSha256: "a".repeat(64), committedStatus: { state: "COMPLETE", workArtifact: { sha256: "a".repeat(64) } } }).decision, "DISPATCH");
});

// ── Smarter-manager: concurrent write sectors, throttle-read, adaptive concurrency, bounded retry ─────────
import { planConcurrentWriteSectors, detectThrottle, adaptConcurrency, decideRetry } from "./agentManager.mjs";

test("planConcurrentWriteSectors: disjoint file-sets run in ONE wave; overlapping sectors serialize", () => {
  const items = [
    { requestId: "A", paths: ["a.js"] },
    { requestId: "B", paths: ["b.js"] },
    { requestId: "C", paths: ["a.js", "c.js"] }, // overlaps A on a.js → later wave
    { requestId: "D", paths: ["d.js"] },
  ];
  const waves = planConcurrentWriteSectors(items);
  // wave 0 = max concurrently-writable disjoint sectors: A, B, D  (C conflicts with A)
  assert.deepEqual(waves[0].map((i) => i.requestId), ["A", "B", "D"]);
  assert.deepEqual(waves[1].map((i) => i.requestId), ["C"]);
  // the #826/#827 case: two "different" fixes sharing a registry file must NOT be in the same wave
  const shared = planConcurrentWriteSectors([
    { requestId: "updateWO", paths: ["createWorkOrder skip", "access.ts", "auditEventWriter.ts"] },
    { requestId: "createWO", paths: ["createWorkOrder.ts", "access.ts", "auditEventWriter.ts"] },
  ]);
  assert.equal(shared.length, 2, "shared registry file forces serialization — no fratricide");
});

test("planConcurrentWriteSectors: an item with NO declared paths is fail-safe (own wave, never shares)", () => {
  const waves = planConcurrentWriteSectors([{ requestId: "X", paths: [] }, { requestId: "Y", paths: ["y.js"] }]);
  assert.equal(waves.length, 2, "unknown scope cannot be proven disjoint → serialized alone");
  assert.deepEqual(waves[0].map((i) => i.requestId), ["X"]);
});

test("planConcurrentWriteSectors: directory containment counts as overlap (not just exact equality)", () => {
  // A owns the directory scope src/foo; B writes a file INSIDE it → same sector → must serialize.
  const waves = planConcurrentWriteSectors([
    { requestId: "A", paths: ["src/foo"] },
    { requestId: "B", paths: ["src/foo/bar.js"] },
  ]);
  assert.equal(waves.length, 2, "src/foo ∋ src/foo/bar.js → overlap → serialized");
  // But a mere string-prefix that is NOT a path-segment boundary is NOT an overlap.
  const sibling = planConcurrentWriteSectors([
    { requestId: "A", paths: ["src/foo"] },
    { requestId: "C", paths: ["src/foobar.js"] },
  ]);
  assert.equal(sibling.length, 1, "src/foo vs src/foobar.js are different sectors → same wave");
});

test("planConcurrentWriteSectors: a glob/wildcard scope is unprovable → fail-safe own wave", () => {
  const waves = planConcurrentWriteSectors([
    { requestId: "GLOB", paths: ["src/**/*.ts"] },
    { requestId: "CONCRETE", paths: ["docs/readme.md"] },
  ]);
  assert.equal(waves.length, 2, "an unexpanded glob can't be proven disjoint → runs alone");
  assert.deepEqual(waves[0].map((i) => i.requestId), ["GLOB"]);
});

test("planConcurrentWriteSectors: path normalization makes ./ and backslash forms compare equal", () => {
  const waves = planConcurrentWriteSectors([
    { requestId: "A", paths: ["./src/a.ts"] },
    { requestId: "B", paths: ["src\\a.ts"] }, // same concrete file after normalization → overlap
  ]);
  assert.equal(waves.length, 2, "normalized to the same path → serialized, not falsely parallel");
});

test("detectThrottle reads 429 / rate-limit / overloaded / retry-after from an outcome", () => {
  assert.equal(detectThrottle({ diagnostic: "HTTP 429 rate_limited" }).throttled, true);
  assert.equal(detectThrottle({ failureDetail: "overloaded, retry-after: 30" }).retryAfterSec, 30);
  assert.equal(detectThrottle({ statusCode: 429 }).throttled, true);
  assert.equal(detectThrottle({ throttled: true }).throttled, true);
  assert.equal(detectThrottle({ diagnostic: "nonzero exit — file not found" }).throttled, false);
  assert.equal(detectThrottle({}).throttled, false);
});

test("adaptConcurrency: AIMD — halve on throttle, grow after a clear streak, bounded", () => {
  assert.equal(adaptConcurrency({ current: 4, throttle: true }).concurrency, 2, "multiplicative back-off");
  assert.equal(adaptConcurrency({ current: 1, throttle: true, min: 1 }).concurrency, 1, "floored at min");
  assert.equal(adaptConcurrency({ current: 2, clearStreak: 3, max: 4 }).concurrency, 3, "additive grow after streak");
  assert.equal(adaptConcurrency({ current: 4, clearStreak: 5, max: 4 }).concurrency, 4, "capped at max");
  assert.equal(adaptConcurrency({ current: 2, clearStreak: 1 }).concurrency, 2, "hold before the streak");
});

test("decideRetry: bounded attempts then ESCALATE_OWNER; backoff between retries; non-failed PROCEEDs", () => {
  assert.equal(decideRetry({ state: "COMPLETE" }).decision, "PROCEED");
  assert.equal(decideRetry({ state: "FAILED", attempts: 0, sinceLastAttemptSec: 10000 }).decision, "RETRY");
  assert.equal(decideRetry({ state: "BLOCKED_EXECUTION", attempts: 1, sinceLastAttemptSec: 10 }).decision, "HOLD_BACKOFF");
  assert.equal(decideRetry({ state: "FAILED", attempts: 3, maxAttempts: 3 }).decision, "ESCALATE_OWNER");
  assert.equal(decideRetry({ state: "CORRECTING", attempts: 5, maxAttempts: 3 }).decision, "ESCALATE_OWNER");
});

// ── decideIntakeDispatch: a deterministic block must not be re-dispatched forever ────────────
const blockedStatus = (sha, state = "BLOCKED_EXECUTION", currentWork = "required execution receipts missing: tests") => ({
  state, currentWork, workArtifact: { sha256: sha },
});

test("DEFECT GUARD: BLOCKED_EXECUTION on the SAME work sha => SKIP, not re-dispatch", () => {
  // 2026-08-16: seven items in this state were re-attempted by EVERY execute run, burning 30+
  // minutes per run on work that could not succeed and starving new intake off the one runner.
  const sha = "b".repeat(64);
  const d = decideIntakeDispatch({ requestId: "EOS-ISSUE-1056", workSha256: sha, committedStatus: blockedStatus(sha) });
  assert.equal(d.decision, "SKIP_DETERMINISTIC_BLOCK");
  assert.equal(d.state, "BLOCKED_EXECUTION");
  assert.match(d.reason, /nothing has changed/);
  assert.match(d.blocker, /receipts missing/);
});

test("FAILED on the same work sha is equally terminal until the work changes", () => {
  const sha = "c".repeat(64);
  const d = decideIntakeDispatch({ requestId: "EOS-ISSUE-868", workSha256: sha, committedStatus: blockedStatus(sha, "FAILED", "worker failed") });
  assert.equal(d.decision, "SKIP_DETERMINISTIC_BLOCK");
  assert.equal(d.state, "FAILED");
});

test("DEFECT GUARD: editing the work artifact makes a blocked item eligible again", () => {
  // The work sha IS the state change. This is how a human fixes a blocked item: change the work,
  // re-run. Without this the skip would be a permanent grave rather than a pause.
  const d = decideIntakeDispatch({
    requestId: "EOS-ISSUE-1056",
    workSha256: "d".repeat(64),                       // artifact edited -> new sha
    committedStatus: blockedStatus("b".repeat(64)),   // blocked against the OLD sha
  });
  assert.equal(d.decision, "DISPATCH");
});

test("a blocked status with no recorded work artifact still dispatches — never skip on a guess", () => {
  const d = decideIntakeDispatch({
    requestId: "EOS-ISSUE-1", workSha256: "e".repeat(64),
    committedStatus: { state: "BLOCKED_EXECUTION", currentWork: "x" },
  });
  assert.equal(d.decision, "DISPATCH");
});

test("in-flight and fresh states are unaffected", () => {
  const sha = "f".repeat(64);
  for (const state of ["EXECUTING", "STAGED", "QUEUED", undefined]) {
    const d = decideIntakeDispatch({ requestId: "X", workSha256: sha, committedStatus: state ? { state, workArtifact: { sha256: sha } } : null });
    assert.equal(d.decision, "DISPATCH", `state ${state} should still dispatch`);
  }
});
