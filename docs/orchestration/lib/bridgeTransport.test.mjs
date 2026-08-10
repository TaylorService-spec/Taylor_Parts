import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockTransport, BRIDGE_API, FUTURE_SEAMS, PC_DEPENDENCE } from "./bridgeTransport.mjs";

const review = (over = {}) => ({
  requestId: "C-1", projectId: "taylor-parts", source: "CLAUDE", target: "CHATGPT",
  requestType: "AI_REVIEW", authorityClass: "RECOMMEND", subject: "review the proposed Rule", ...over,
});

test("the mock can NEVER report itself live (structural honesty guard)", () => {
  assert.equal(createMockTransport().isLive(), false);
});

test("full round-trip: request → deliver → responder lists/answers → requester consumes → close", () => {
  const t = createMockTransport();
  const { request } = t.submitRequest(review());
  assert.equal(request.status, "DELIVERED");

  // ChatGPT (responder) side — narrow API only.
  const pending = t.listPendingRequests("CHATGPT");
  assert.equal(pending.length, 1);
  assert.equal(t.getRequest("C-1").requestId, "C-1");
  const responded = t.submitResponse("C-1", { reviewVerdict: "CONCUR_WITH_CORRECTION", note: "narrow the uid list" });
  assert.equal(responded.status, "RESPONDED");
  assert.equal(responded.reviewVerdict, "CONCUR_WITH_CORRECTION");

  // Claude (requester) side — the consumption seam surfaces the unconsumed response.
  const toConsume = t.pendingConsumption("CLAUDE");
  assert.equal(toConsume.length, 1);
  const consumed = t.consume("C-1");
  assert.equal(consumed.status, "CONSUMED");
  assert.equal(t.pendingConsumption("CLAUDE").length, 0);
});

test("duplicate submission is deduped — the responder never sees it twice", () => {
  const t = createMockTransport();
  t.submitRequest(review());
  const again = t.submitRequest(review()); // same idempotencyKey
  assert.equal(again.deduped, true);
  assert.equal(t.listPendingRequests("CHATGPT").length, 1);
});

test("escalation is re-derivable from persisted state (cold-start recovery) and never auto-approves", () => {
  const t = createMockTransport();
  t.submitRequest(review({ escalateAfter: 1000 })); // delivered, awaiting responder
  const escalated = t.escalateOverdue(5000);
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0].disposition, "NEEDS_OWNER"); // silence -> Owner, not approval
});

test("an unknown request id is an explicit error, never a silent no-op", () => {
  const t = createMockTransport();
  assert.throws(() => t.submitResponse("nope", {}), /unknown/);
  assert.throws(() => t.consume("nope"), /unknown/);
});

test("BRIDGE_API names the four narrow operations (no arbitrary Firestore access)", () => {
  assert.deepEqual(BRIDGE_API, ["listPendingRequests", "getRequest", "submitResponse", "acknowledgeResponse"]);
});

test("FUTURE_SEAMS + PC_DEPENDENCE are honestly registered (nothing claimed live)", () => {
  assert.ok(FUTURE_SEAMS.every((s) => s.class === "FUTURE_SEAM"));
  assert.ok(FUTURE_SEAMS.some((s) => s.id === "chatgpt-trigger"));
  assert.ok(FUTURE_SEAMS.some((s) => s.id === "claude-autonomous-wake"));
  // The PC-dependence register marks the Claude session + browser as non-portable today.
  const claudeDep = PC_DEPENDENCE.find((d) => d.dependency.startsWith("Claude session"));
  assert.equal(claudeDep.portable, false);
});
