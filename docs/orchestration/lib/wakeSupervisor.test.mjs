import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessReadiness, nextBackoffMs, buildClaudeInvocation, DEFAULT_GUARDRAILS,
  TRIGGER_MECHANISMS, TRIGGER_KINDS, buildExecutionOutputContract,
} from "./wakeSupervisor.mjs";

const okItem = (over = {}) => ({ id: "W-1", status: "READY", authorized: true, protectedBoundary: null, scope: ["orchestration"], sha: "abc", ...over });
const okCtx = (over = {}) => ({ governor: { remoteAiUsed: 0, remoteAiMax: 2 }, network: "NORMAL", budgetRemainingUsd: 5, triggerKind: "AUTOMATIC_TRIGGER", ...over });

test("TRIGGER only when READY + authorized + repo-safe + slot free + network NORMAL + budget ok", () => {
  const r = assessReadiness(okItem(), okCtx());
  assert.equal(r.decision, "TRIGGER");
  assert.equal(r.triggerMechanism, "AUTOMATIC");
  assert.equal(r.guardrails, DEFAULT_GUARDRAILS);
});

test("THE INVARIANT: READY but NOT authorized → HOLD (READY is not authorization)", () => {
  const r = assessReadiness(okItem({ authorized: false }), okCtx());
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /not authorization/);
  assert.equal(r.guardrails, null);
});

test("a protected boundary is NEVER auto-triggered", () => {
  const r = assessReadiness(okItem({ protectedBoundary: "deploy" }), okCtx());
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /protected boundary/);
});

test("respects the 2/1/1 governor — no free REMOTE_AI slot → HOLD", () => {
  const r = assessReadiness(okItem(), okCtx({ governor: { remoteAiUsed: 2, remoteAiMax: 2 } }));
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /2\/1\/1 governor/);
});

test("holds on network pressure and on exhausted budget", () => {
  assert.equal(assessReadiness(okItem(), okCtx({ network: "NETWORK_PRESSURE" })).decision, "HOLD");
  assert.equal(assessReadiness(okItem(), okCtx({ budgetRemainingUsd: 0 })).decision, "HOLD");
});

test("no-overnight window holds (supervised pilot)", () => {
  assert.equal(assessReadiness(okItem(), okCtx({ overnight: true })).decision, "HOLD");
});

test("dedup: the same item at the same SHA does not re-fire", () => {
  const r = assessReadiness(okItem(), okCtx({ lastRun: { itemId: "W-1", sha: "abc" } }));
  assert.equal(r.decision, "HOLD");
  assert.match(r.reason, /dedup/);
  // a new SHA re-enables the trigger
  assert.equal(assessReadiness(okItem({ sha: "def" }), okCtx({ lastRun: { itemId: "W-1", sha: "abc" } })).decision, "TRIGGER");
});

test("nothing READY → CHECKPOINT, not a trigger", () => {
  assert.equal(assessReadiness(null, okCtx()).decision, "CHECKPOINT");
  assert.equal(assessReadiness(okItem({ status: "OWNER_DECISION" }), okCtx()).decision, "CHECKPOINT");
});

test("a MANUAL runtime trigger is recorded distinctly from AUTOMATIC", () => {
  const r = assessReadiness(okItem(), okCtx({ triggerKind: "MANUAL_RUNTIME_TRIGGER" }));
  assert.equal(r.triggerMechanism, "MANUAL");
  assert.equal(r.triggerKind, "MANUAL_RUNTIME_TRIGGER");
  assert.ok(TRIGGER_KINDS.includes(r.triggerKind) && TRIGGER_MECHANISMS.includes(r.triggerMechanism));
});

test("backoff is exponential and capped", () => {
  assert.equal(nextBackoffMs(0), 60_000);
  assert.equal(nextBackoffMs(3), 480_000);
  assert.equal(nextBackoffMs(99), 900_000); // capped
});

test("the constructed invocation is fully guardrailed and never uses bypass permissions", () => {
  const inv = buildClaudeInvocation({ contextPackage: { role: "worker", scope: ["orchestration"] } });
  assert.equal(inv.bin, "claude");
  const s = inv.argv.join(" ");
  assert.match(s, /--permission-mode dontAsk/);
  assert.doesNotMatch(s, /--max-budget-usd/, "subscription-backed Claude has no implicit modeled-dollar stop");
  const capped = buildClaudeInvocation({ contextPackage: { role: "worker", scope: ["orchestration"] }, guardrails: { ...DEFAULT_GUARDRAILS, maxBudgetUsd: 2 } }).argv.join(" ");
  assert.match(capped, /--max-budget-usd 2/, "an explicit economic-cost cap remains enforceable");
  // The DEFAULT/FALLBACK profile is READ_ONLY_ANALYSIS (least privilege): a bounded 40-turn ceiling, NO
  // Edit/Write, recorded in telemetry alongside the profile name.
  assert.match(s, /--max-turns 40/);
  assert.equal(inv.turnCeiling, 40);
  assert.equal(inv.profile, "READ_ONLY_ANALYSIS");
  assert.ok(!/--allowedTools (Edit|Write)\b/.test(s), "default analysis wake grants NO Edit/Write");
  assert.match(s, /--output-format json/);
  assert.ok(!/bypass|dangerously/i.test(s), "must never use bypass/dangerous permissions");
  assert.ok(!/--allowedTools Bash(\s|$)/.test(s) && !/--allowedTools Bash\(\s*\*/.test(s), "never unrestricted Bash");
  assert.ok(inv.argv.includes("--allowedTools") && !s.includes("WebFetch") || s.includes("--disallowedTools WebFetch"));
  assert.ok(inv.wallClockSec >= 1);
  // A differentiated profile can be requested BY NAME only (governed selection happens upstream): READ_ONLY_VERIFY
  // carries the 60-turn ceiling and still no Write; PATCH_PRODUCER carries 80 with Write.
  const verify = buildClaudeInvocation({ contextPackage: { role: "worker", scope: ["orchestration"] }, profile: "READ_ONLY_VERIFY" });
  assert.equal(verify.turnCeiling, 60);
  assert.ok(!verify.argv.join(" ").includes("--allowedTools Write"), "read-only verify grants no Write");
  const patch = buildClaudeInvocation({ contextPackage: { role: "worker", scope: ["orchestration"] }, profile: "PATCH_PRODUCER" });
  assert.equal(patch.turnCeiling, 80);
  assert.ok(patch.argv.join(" ").includes("--allowedTools Write"), "patch producer grants Write");
  assert.throws(() => buildClaudeInvocation({ contextPackage: { role: "w", scope: [] }, profile: "NOPE" }), /unknown profile/);
  assert.throws(() => buildClaudeInvocation({}), /contextPackage is required/); // must bootstrap via the shared package
});

// --- governed output contract (gate↔worker seam) ---------------------------------------------------
// Regression cover for the defect where classifyCompletion required `receipts:["tests"]` but nothing ever
// asked the worker for them, so correct work landed as BLOCKED_EXECUTION purely on issue-body wording.

test("output contract names every required receipt and the exact evidence shape the gate reads", () => {
  const c = buildExecutionOutputContract({ requiredExecutionReceipts: ["tests"], expectedArtifactClass: "PATCH", verifierRequired: true });
  assert.match(c, /"receipts": \["tests"\]/);
  assert.match(c, /"evidence"/);
  assert.match(c, /"executionCapable"/);
  assert.match(c, /"toolPermissionBlocked"/);
  assert.match(c, /PATCH/);
  assert.match(c, /verifier/);
});

test("a contract requiring nothing produces no contract text", () => {
  assert.equal(buildExecutionOutputContract({ requiredExecutionReceipts: [], expectedArtifactClass: "NONE", verifierRequired: false }), "");
  assert.equal(buildExecutionOutputContract({}), "");
});

test("receipts are requested honestly — never instructed to claim an unearned one", () => {
  const c = buildExecutionOutputContract({ requiredExecutionReceipts: ["tests"] });
  assert.match(c, /ONLY after you actually performed it/);
  assert.match(c, /Never claim it because tests merely exist/);
  assert.match(c, /toolPermissionBlocked` to true/);
});

test("non-string / malformed receipt entries are filtered, not emitted", () => {
  const c = buildExecutionOutputContract({ requiredExecutionReceipts: ["tests", "", null, 7] });
  assert.match(c, /"receipts": \["tests"\]/);
});

test("buildClaudeInvocation APPENDS the contract to the C-7 package without replacing it", () => {
  const withC = buildClaudeInvocation({ contextPackage: "C7-PACKAGE-BODY", profile: "READ_ONLY_ANALYSIS", executionContract: { requiredExecutionReceipts: ["tests"] } });
  const prompt = withC.argv[withC.argv.indexOf("-p") + 1];
  assert.match(prompt, /C7-PACKAGE-BODY/);
  assert.match(prompt, /REQUIRED OUTPUT CONTRACT/);
});

test("omitting the contract leaves the prompt byte-identical to the prior behavior", () => {
  const a = buildClaudeInvocation({ contextPackage: "PKG", profile: "READ_ONLY_ANALYSIS" });
  assert.equal(a.argv[a.argv.indexOf("-p") + 1], "PKG");
});

test("the contract conveys no authority — argv guardrails are unchanged by it", () => {
  const a = buildClaudeInvocation({ contextPackage: "PKG", profile: "READ_ONLY_ANALYSIS" });
  const b = buildClaudeInvocation({ contextPackage: "PKG", profile: "READ_ONLY_ANALYSIS", executionContract: { requiredExecutionReceipts: ["tests"], expectedArtifactClass: "PATCH" } });
  const strip = (x) => x.argv.filter((_, i) => i !== x.argv.indexOf("-p") + 1);
  assert.deepEqual(strip(b), strip(a));
  assert.equal(b.profile, a.profile);
  assert.equal(b.turnCeiling, a.turnCeiling);
});
