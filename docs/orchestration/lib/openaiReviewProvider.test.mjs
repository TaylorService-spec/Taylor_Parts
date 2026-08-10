import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewInvocation, estimateCost, guardBudget, parseOpenAIResult, runOpenAIReview, resolveConcreteModel, estTokens, PILOT_BUDGET, PLACEHOLDER_MODELS, DEFAULT_PRICING_ESTIMATE } from "./openaiReviewProvider.mjs";
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
