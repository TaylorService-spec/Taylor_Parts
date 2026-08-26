import test from "node:test";
import assert from "node:assert/strict";
import { deriveDispatchIntelligence, buildDispatchInterpretationInput, DISPATCH_INTELLIGENCE_REASON as REASON } from "../src/domain/dispatchIntelligence.js";

const item = (reason, over = {}) => ({
  attentionItemId: `workOrder:${reason}:secret-wo`,
  domain: "workOrder",
  objectType: "workOrder",
  objectId: "secret-wo",
  workOrderId: "secret-wo",
  woNumber: "WO-999",
  deepLink: "/service/work-orders/secret-wo",
  attentionType: "ACTION_ITEM",
  requiresAction: true,
  recipientRole: "DISPATCHER",
  sectionLabel: "x",
  reason,
  scheduledStartMillis: 1900000000000,
  techId: "secret-tech",
  shortfallCount: 4,
  ...over,
});

test("established dispatch signals become semantic evidence without ranking", () => {
  const r = deriveDispatchIntelligence([
    item("READY_TO_DISPATCH"), item("PAST_DUE"), item("OVERLAP"), item("SHORT"), item("PROCUREMENT_PENDING", { attentionType: "NOTIFICATION", requiresAction: false }),
  ], { projectionComplete: true });
  assert.equal(r.speak, true);
  assert.deepEqual(r.evidence.map((e) => e.key), ["READY_TO_SCHEDULE", "PAST_DUE_WORK", "SCHEDULING_CONFLICT", "PARTS_BLOCKED", "PROCUREMENT_PENDING"]);
  assert.equal(r.allowedRecommendation, null);
});

test("a caller that cannot assert projection completeness gets silence", () => {
  const r = deriveDispatchIntelligence([item("PAST_DUE")]);
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.INPUT_INCOMPLETE);
});

test("confirmed no-attention is silent", () => {
  const r = deriveDispatchIntelligence([], { projectionComplete: true });
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.NO_ATTENTION);
});

test("foreign/malformed items fail the whole synthesis closed", () => {
  for (const items of [null, [null], [item("PAST_DUE"), { domain: "parts" }]]) {
    const r = deriveDispatchIntelligence(items, { projectionComplete: true });
    assert.equal(r.speak, false);
    assert.equal(r.reason, REASON.INPUT_INVALID);
  }
});

test("model input strips work-order ids, numbers, dates, people, counts and deep links", () => {
  const input = buildDispatchInterpretationInput(deriveDispatchIntelligence([
    item("PAST_DUE"), item("OVERLAP"), item("SHORT"),
  ], { projectionComplete: true }));
  assert.ok(input);
  const json = JSON.stringify(input);
  for (const forbidden of ["secret-wo", "WO-999", "secret-tech", "/service/work-orders/", "1900000000000", "shortfallCount", "techId", "objectId", "workOrderId", "deepLink"]) {
    assert.equal(json.includes(forbidden), false, `model payload leaked ${forbidden}`);
  }
  assert.equal(input.allowedRecommendation, null);
});

test("silent intelligence never reaches a model", () => {
  assert.equal(buildDispatchInterpretationInput(deriveDispatchIntelligence([], { projectionComplete: true })), null);
});
