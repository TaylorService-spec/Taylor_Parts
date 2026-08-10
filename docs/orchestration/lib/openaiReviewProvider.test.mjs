import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewInvocation, estimateCost, guardBudget, parseOpenAIResult, runOpenAIReview, resolveConcreteModel, estTokens, extractSemanticFields, assembleReviewEnvelope, SEMANTIC_REVIEW_FIELDS, PILOT_BUDGET, PLACEHOLDER_MODELS, DEFAULT_PRICING_ESTIMATE } from "./openaiReviewProvider.mjs";
import { consumeReviewResult } from "./reviewTrigger.mjs";

const SUFFICIENT_PKG = { governingAuthority: "orch-operating-model", sufficiency: "SUFFICIENT", required: [{ id: "orch-operating-model", authority: "AI Engineering Operating Model", retrievalPath: "docs/orchestration/continuous-workstream-orchestrator.md" }] };
const MODEL = "gpt-5.6-terra";
const REQ = { requestId: "R1", reviewClass: "INDEPENDENT_AI", subject: "review PR #900", reviewerRole: "independent-architecture-review", selectedModel: MODEL, routedBackTo: "Orchestration" };

// A mock transport: records calls, never receives a key, returns a canned structured response.
function mockTransport({ response, throwErr } = {}) {
  const calls = [];
  const fn = async (invocation) => {
    calls.push(invocation);
    if (throwErr) throw new Error(throwErr);
    return response ?? { ok: true, review: { verdict: "CONCUR", conclusion: "looks correct", corrections: [] }, usage: { inputTokens: 1200, outputTokens: 300 } };
  };
  fn.calls = calls;
  return fn;
}

test("serves INDEPENDENT_AI only — any other class is refused with no invocation", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: { ...REQ, reviewClass: "ROUTINE_AI" }, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, false);
  assert.equal(r.failureKind, "TRIGGER_FAILED");
  assert.equal(t.calls.length, 0);
});

test("insufficient C-7 context → CONTEXT_INSUFFICIENT, no invocation", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: REQ, contextPackage: { ...SUFFICIENT_PKG, sufficiency: "EVIDENCE_REQUIRED" }, diff: "x", transport: t });
  assert.equal(r.failureKind, "CONTEXT_INSUFFICIENT");
  assert.equal(t.calls.length, 0);
});

test("invocation uses MINIMUM C-7 context (governing authority + inlined content + diff), not the whole repo", () => {
  const b = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "DIFF-BODY", model: MODEL, contextText: "INLINED-CTX" });
  assert.equal(b.ok, true);
  assert.equal(b.invocation.model, MODEL);          // concrete configured model, no fallback
  const userMsg = b.invocation.messages.find((m) => m.role === "user").content;
  assert.match(userMsg, /orch-operating-model/);
  assert.match(userMsg, /INLINED-CTX/);             // inlined minimum context is present
  assert.match(userMsg, /DIFF-BODY/);
  assert.ok(b.invocation.inputTokensEstimate > 0);
});

// ── Pre-flight corrections: fail-closed model + complete-payload estimate ──────

test("resolveConcreteModel: placeholders/empty fail; a real id passes", () => {
  for (const p of PLACEHOLDER_MODELS) assert.equal(resolveConcreteModel(p).ok, false);
  assert.equal(resolveConcreteModel(null).ok, false);
  const ok = resolveConcreteModel("gpt-5.6-terra");
  assert.equal(ok.ok, true);
  assert.equal(ok.model, "gpt-5.6-terra");
});

test("missing OPENAI_REVIEW_MODEL (empty selectedModel) → live REFUSES before any provider call", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: { ...REQ, selectedModel: "" }, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, false);
  assert.equal(r.failureKind, "TRIGGER_FAILED");
  assert.match(r.reason, /MODEL_NOT_CONFIGURED/);
  assert.equal(t.calls.length, 0);                  // no provider call
});

test("invalid model configuration (placeholder gpt-mid-tier) → fail closed, no call", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: { ...REQ, selectedModel: "gpt-mid-tier" }, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, false);
  assert.match(r.reason, /MODEL_NOT_CONFIGURED/);
  assert.equal(t.calls.length, 0);
});

test("selectedModel == gpt-5.6-terra reaches the provider invocation with that exact model", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, true);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].model, "gpt-5.6-terra");  // the concrete configured model is what is sent
});

test("estimated input reflects the COMPLETE transmitted messages (system + user, incl. inlined context + diff)", () => {
  const contextText = "GOVERNING-AUTHORITY-CONTENT ".repeat(200);
  const diff = "DIFF-LINE\n".repeat(100);
  const b = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff, model: MODEL, contextText });
  const summed = b.invocation.messages.reduce((s, m) => s + estTokens(m.content), 0);
  assert.equal(b.invocation.inputTokensEstimate, summed);   // estimate == tokens over the full payload
  // and it materially reflects the inlined content (not the 221-token pointers-only undercount)
  assert.ok(b.invocation.inputTokensEstimate > estTokens(contextText) * 0.9);
});

test("per-review ceiling → refuse, NO invocation (budget guard, no auto-recharge)", async () => {
  const t = mockTransport();
  // pricing so tiny input exceeds $0.25/review
  const pricing = { inputPerM: 1000, outputPerM: 1000, source: "test" };
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t, pricing });
  assert.equal(r.ok, false);
  assert.match(r.reason, /per-review ceiling/);
  assert.equal(r.usage.invoked, false);
  assert.equal(t.calls.length, 0);
});

test("pilot total ceiling → refuse when cumulative + this would exceed $10", async () => {
  const g = guardBudget({ estCostUsd: 0.2, spentSoFarUsd: 9.95 });
  assert.equal(g.ok, false);
  assert.match(g.reason, /pilot ceiling/);
  assert.equal(PILOT_BUDGET.autoRecharge, false);
});

test("successful mock response → structured result via the contract; verdict preserved", async () => {
  const t = mockTransport();
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, true);
  assert.equal(r.result.verdict, "CONCUR");
  assert.equal(r.result.provider, "OPENAI");
  assert.equal(t.calls.length, 1);
  assert.ok(r.usage.actualCostUsd >= 0);
});

test("provider error → PROVIDER_FAILED, no continuation", async () => {
  const t = mockTransport({ throwErr: "429 rate limit" });
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.ok, false);
  assert.equal(r.failureKind, "PROVIDER_FAILED");
});

test("provider error status object → PROVIDER_FAILED", async () => {
  const t = mockTransport({ response: { ok: false, error: "server_error" } });
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.failureKind, "PROVIDER_FAILED");
});

test("malformed provider output → MALFORMED_RESULT (unknown verdict), no continuation", async () => {
  const t = mockTransport({ response: { ok: true, review: { verdict: "LGTM" } } });
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.failureKind, "MALFORMED_RESULT");
});

test("no transport injected → not configured (activation boundary), no fabricated result", async () => {
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: undefined });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured|activation boundary/i);
});

test("no API key is ever stored/serialized by the adapter (transport is the only secret holder)", async () => {
  const FAKE_KEY = "sk-THIS-MUST-NEVER-APPEAR";
  // transport is the only thing that knows a key; the adapter never receives it
  const t = async (inv) => { void FAKE_KEY; return { ok: true, review: { verdict: "CONCUR" }, usage: { inputTokens: 100, outputTokens: 50 } }; };
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(FAKE_KEY));      // key never leaks into the result/usage
  assert.ok(!serialized.includes("Authorization"));
});

test("a reviewer verdict never authorizes a protected action (gate stays in consumeReviewResult)", async () => {
  const t = mockTransport(); // returns CONCUR
  const r = await runOpenAIReview({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "x", transport: t });
  assert.equal(r.result.verdict, "CONCUR");
  const consumed = consumeReviewResult({ result: r.result, targetsProtectedAction: true });
  assert.equal(consumed.consumable, false);
  assert.equal(consumed.disposition, "NEEDS_OWNER");
});

test("estimateCost is linear in tokens and pricing (never fabricated — pricing is an input)", () => {
  const c = estimateCost({ inputTokens: 30000, outputTokens: 1500, pricing: DEFAULT_PRICING_ESTIMATE });
  assert.ok(Math.abs(c - (30000 / 1e6 * DEFAULT_PRICING_ESTIMATE.inputPerM + 1500 / 1e6 * DEFAULT_PRICING_ESTIMATE.outputPerM)) < 1e-9);
  assert.equal(DEFAULT_PRICING_ESTIMATE.model, "gpt-5.6-terra");
});

// ── Dry-run / live payload parity + system-owned metadata (first-live reconciliation) ──────────────

const CTX_TEXT = "GOVERNING-AUTHORITY-CONTENT ".repeat(300); // ~8KB inlined content
const EOS_META = {
  contextPackageRef: { mapVersion: "1.0.0", sourceCommit: "abc123", governingAuthority: "orch-operating-model" },
  provenance: { sourceFreshness: "CURRENT", sourceCommit: "abc123" },
  triggerKind: "MANUAL_RUNTIME_TRIGGER",
  timestamps: { requestedAt: "2026-01-01T00:00:00Z", triggeredAt: "2026-01-01T00:00:01Z", completedAt: "2026-01-01T00:00:05Z" },
};

test("1. dry-run and live use the SAME canonical provider payload (exact object transmitted)", async () => {
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "DIFF", model: MODEL, contextText: CTX_TEXT });
  assert.equal(built.ok, true);
  const t = mockTransport();
  const r = await runOpenAIReview({ request: REQ, invocation: built.invocation, transport: t, ...EOS_META });
  assert.equal(r.ok, true);
  assert.equal(t.calls.length, 1);
  assert.strictEqual(t.calls[0], built.invocation); // the EXACT object the dry-run would estimate is transmitted
  // and the canonical builder is deterministic for the same inputs
  const built2 = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "DIFF", model: MODEL, contextText: CTX_TEXT });
  assert.deepEqual(built2.invocation.messages, built.invocation.messages);
});

test("2. inlined governing content is present in the ACTUAL transmitted request (not pointers-only)", async () => {
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "DIFF", model: MODEL, contextText: CTX_TEXT });
  const t = mockTransport();
  await runOpenAIReview({ request: REQ, invocation: built.invocation, transport: t, ...EOS_META });
  const transmittedUser = t.calls[0].messages.find((m) => m.role === "user").content;
  assert.match(transmittedUser, /GOVERNING-AUTHORITY-CONTENT/); // the inlined content actually left the building
  assert.ok(t.calls[0].inputTokensEstimate > 1500);             // reflects real content, not ~300 pointers
});

test("3. token estimate examines EXACTLY the transmitted input messages", async () => {
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "DIFF", model: MODEL, contextText: CTX_TEXT });
  const t = mockTransport();
  await runOpenAIReview({ request: REQ, invocation: built.invocation, transport: t, ...EOS_META });
  const transmitted = t.calls[0];
  const summed = transmitted.messages.reduce((s, m) => s + estTokens(m.content), 0);
  assert.equal(transmitted.inputTokensEstimate, summed); // estimate == tokens over exactly what was sent
});

test("4. system-owned metadata cannot be overwritten/fabricated by the model", async () => {
  // a hostile/confused model tries to set system fields — they must be IGNORED
  const t = mockTransport({ response: { ok: true, review: { verdict: "CONCUR", conclusion: "ok", exchangeId: "HACKED", provenance: { spoofed: true }, requestedAt: "1999", selectedModel: "gpt-evil", triggerKind: "HACK", disposition: "CONSUMED" } } });
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "D", model: MODEL, contextText: CTX_TEXT });
  const r = await runOpenAIReview({ request: REQ, invocation: built.invocation, transport: t, ...EOS_META });
  assert.equal(r.ok, true);
  assert.equal(r.result.exchangeId, "rev:R1");                       // EOS, not "HACKED"
  assert.equal(r.result.requestedAt, "2026-01-01T00:00:00Z");        // EOS timestamp, not "1999"
  assert.equal(r.result.selectedModel, "gpt-5.6-terra");             // the transmitted model, not "gpt-evil"
  assert.equal(r.result.triggerKind, "MANUAL_RUNTIME_TRIGGER");      // EOS, not "HACK"
  assert.deepEqual(r.result.provenance, EOS_META.provenance);        // EOS, not {spoofed:true}
  assert.equal(r.result.disposition, "OPEN");                        // EOS default, not model's "CONSUMED"
});

test("5. extractSemanticFields returns ONLY the semantic fields (drops anything else)", () => {
  const s = extractSemanticFields({ verdict: "CONCUR", conclusion: "c", corrections: ["x"], evidenceRefs: [], ownerDecisionRequired: false, exchangeId: "nope", provenance: { a: 1 }, requestedAt: "nope" });
  assert.equal(s.ok, true);
  assert.deepEqual(Object.keys(s.semantic).sort(), [...SEMANTIC_REVIEW_FIELDS].sort());
  assert.equal(extractSemanticFields({ verdict: "LGTM" }).ok, false); // unknown verdict → malformed
});

test("6. EOS assembles the envelope with authoritative runtime metadata (no nulls where EOS owns them)", () => {
  const env = assembleReviewEnvelope({ request: REQ, invocation: { model: MODEL }, semantic: { verdict: "CONCUR", conclusion: "ok" }, ...EOS_META });
  assert.equal(env.ok, true);
  assert.equal(env.result.requestId, "R1");
  assert.equal(env.result.selectedModel, MODEL);
  assert.equal(env.result.triggerKind, "MANUAL_RUNTIME_TRIGGER");
  assert.deepEqual(env.result.contextPackageRef, EOS_META.contextPackageRef);
  assert.equal(env.result.requestedAt, "2026-01-01T00:00:00Z");
  assert.equal(env.result.triggeredAt, "2026-01-01T00:00:01Z");
  assert.equal(env.result.completedAt, "2026-01-01T00:00:05Z");
  assert.equal(env.result.sourceFreshness, "CURRENT");
});

test("7. missing required evidence still returns EVIDENCE_REQUIRED through the envelope", async () => {
  const t = mockTransport({ response: { ok: true, review: { verdict: "EVIDENCE_REQUIRED", conclusion: "governing content not sufficient" } } });
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "D", model: MODEL, contextText: CTX_TEXT });
  const r = await runOpenAIReview({ request: REQ, invocation: built.invocation, transport: t, ...EOS_META });
  assert.equal(r.ok, true);
  assert.equal(r.result.verdict, "EVIDENCE_REQUIRED");
  assert.equal(r.result.evidenceRequired, true);
});

test("8. no API key leaks into the request payload, the result envelope, or usage", async () => {
  const FAKE_KEY = "sk-LEAK-CANARY-9999";
  const transport = async (inv) => { void FAKE_KEY; return { ok: true, review: { verdict: "CONCUR", conclusion: "ok" }, usage: { inputTokens: 2000, outputTokens: 100 } }; };
  const built = buildReviewInvocation({ request: REQ, contextPackage: SUFFICIENT_PKG, diff: "D", model: MODEL, contextText: CTX_TEXT });
  const r = await runOpenAIReview({ request: REQ, invocation: built.invocation, transport, ...EOS_META });
  const blob = JSON.stringify(built.invocation) + JSON.stringify(r);
  assert.ok(!blob.includes(FAKE_KEY));
  assert.ok(!blob.includes("Authorization"));
});
