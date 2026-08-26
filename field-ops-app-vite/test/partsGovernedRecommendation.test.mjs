import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveGovernedPartsStartPurchasingRecommendation,
  acceptGovernedPartsStartPurchasingRecommendation,
  PARTS_START_PURCHASING_ACTION_ID,
  PARTS_RECOMMENDATION_REASON as REASON,
} from "../src/domain/partsGovernedRecommendation.js";
import {
  derivePartsIntelligence,
  buildPartsInterpretationInput,
  PARTS_INTELLIGENCE_REASON,
} from "../src/domain/partsIntelligence.js";

const assigned = (over = {}) => ({
  attentionItemId: "parts:reorderRequest:rr-secret",
  domain: "parts",
  objectType: "reorderRequest",
  objectId: "rr-secret",
  partId: "part-secret",
  attentionType: "ACTION_ITEM",
  requiresAction: true,
  recipientUserId: "user-assignee",
  sectionLabel: "Assigned to You",
  deepLink: "/inventory/part-secret?requestId=rr-secret",
  urgency: "HIGH",
  ...over,
});

test("the assigned caller may be offered only the EXISTING startPurchasing action", () => {
  const r = deriveGovernedPartsStartPurchasingRecommendation(assigned(), { currentUserId: "user-assignee" });
  assert.equal(r.speak, true);
  assert.equal(r.reason, REASON.READY);
  assert.equal(r.recommendation.actionId, PARTS_START_PURCHASING_ACTION_ID);
  assert.equal(r.recommendation.authority, "ALLOWED");
  assert.equal(r.execution.reorderRequestId, "rr-secret");
});

test("another caller never sees the action", () => {
  for (const currentUserId of ["someone-else", null, "", undefined]) {
    const r = deriveGovernedPartsStartPurchasingRecommendation(assigned(), { currentUserId });
    assert.equal(r.speak, false);
    assert.equal(r.reason, REASON.CALLER_NOT_ASSIGNEE);
    assert.equal(r.authority, "DENIED");
    assert.equal(r.recommendation, null);
  }
});

test("other Parts workflow stages are not repurposed into AI decisions", () => {
  const variants = [
    { sectionLabel: "Pending Review", recipientRole: "REVIEWER" },
    { sectionLabel: "Ready for Parts Manager", recipientRole: "PARTS_MANAGER" },
    { sectionLabel: "Purchasing Started", recipientUserId: "user-assignee" },
    { attentionType: "NOTIFICATION", sectionLabel: "Assigned to You" },
    { requiresAction: false, sectionLabel: "Assigned to You" },
  ];
  for (const over of variants) {
    const r = deriveGovernedPartsStartPurchasingRecommendation(assigned(over), { currentUserId: "user-assignee" });
    assert.equal(r.speak, false, JSON.stringify(over));
    assert.equal(r.reason, REASON.NOT_ASSIGNED_PURCHASING_ITEM);
  }
});

test("human acceptance delegates to the existing startPurchasing seam with EOS-only identity", async () => {
  const governed = deriveGovernedPartsStartPurchasingRecommendation(assigned(), { currentUserId: "user-assignee" });
  let called = null;
  const result = await acceptGovernedPartsStartPurchasingRecommendation({
    governedRecommendation: governed,
    runStartPurchasing: async (requestId) => { called = requestId; return "ok"; },
  });
  assert.equal(result, "ok");
  assert.equal(called, "rr-secret");
});

test("the model payload contains no record/user/part ids, deep links, urgency or procurement figures", () => {
  const intelligence = derivePartsIntelligence(assigned(), { currentUserId: "user-assignee" });
  assert.equal(intelligence.speak, true);
  assert.equal(intelligence.reason, PARTS_INTELLIGENCE_REASON.READY);
  const input = buildPartsInterpretationInput(intelligence);
  assert.ok(input);
  const json = JSON.stringify(input);
  for (const forbidden of [
    "rr-secret", "part-secret", "user-assignee", "/inventory/", "HIGH",
    "reorderRequestId", "objectId", "partId", "recipientUserId", "deepLink", "urgency",
  ]) {
    assert.equal(json.includes(forbidden), false, `model payload leaked ${forbidden}`);
  }
  assert.equal(input.allowedRecommendation.actionId, "startPurchasing");
});

test("denied or non-applicable intelligence is never sent to the model", () => {
  const denied = derivePartsIntelligence(assigned(), { currentUserId: "other" });
  assert.equal(denied.speak, false);
  assert.equal(buildPartsInterpretationInput(denied), null);

  const notApplicable = derivePartsIntelligence(assigned({ sectionLabel: "Pending Review" }), { currentUserId: "user-assignee" });
  assert.equal(notApplicable.speak, false);
  assert.equal(buildPartsInterpretationInput(notApplicable), null);
});
