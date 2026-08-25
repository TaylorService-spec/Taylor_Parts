import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkOrderIntelligenceContext,
  deriveWorkOrderIntelligence,
  INTELLIGENCE_ORIGIN,
  CONFIDENCE,
  AUTHORITY_STATE,
  NO_INSIGHT_REASON,
} from "../src/domain/workOrderIntelligence.js";

const wo = (over = {}) => ({
  id: "cIk3hlPDTXH5IB3VHdLy",
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "REPAIR",
  priority: "P2",
  customerId: "aBcDeFgHiJkLmNoPqRsT",
  scheduledTechId: "uVwXyZ0123456789AbCd",
  inventorySnapshot: [
    { partId: "V4otE0s7EAp7ABCZEjam", name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2 },
    { partId: "Z9otE0s7EAp7ABCZEjaQ", name: "Seal Kit", sku: "S-100", qtyPlanned: 1 },
  ],
  ...over,
});

test("the context is an explicit model-safe shape, not a database handle", () => {
  const context = buildWorkOrderIntelligenceContext(wo());
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.subject.reference, "WO-2026-000873");
  assert.equal(context.subject.status, "DISPATCHED");
  assert.equal(context.parts.plannedLineCount, 2);
  assert.equal(context.parts.plannedQuantity, 3);
  assert.equal(context.parts.readinessAuthorityAvailable, false);

  const encoded = JSON.stringify(context);
  assert.doesNotMatch(encoded, /cIk3hlPDTXH5IB3VHdLy/);
  assert.doesNotMatch(encoded, /aBcDeFgHiJkLmNoPqRsT/);
  assert.doesNotMatch(encoded, /uVwXyZ0123456789AbCd/);
  assert.doesNotMatch(encoded, /V4otE0s7EAp7ABCZEjam/);
  assert.equal("id" in context.subject, false);
  assert.equal("customerId" in context.subject, false);
});

test("planned parts produce one truthful deterministic readiness signal", () => {
  const signal = deriveWorkOrderIntelligence(wo());
  assert.equal(signal.speak, true);
  assert.equal(signal.origin, INTELLIGENCE_ORIGIN.DETERMINISTIC);
  assert.equal(signal.key, "parts-readiness-unverified");
  assert.match(signal.observedFact, /3 planned units across 2 parts/i);
  assert.match(signal.interpretation, /no governed truck or staging availability signal/i);
  assert.match(signal.businessConsequence, /readiness cannot be confirmed/i);
  assert.equal(signal.confidence.level, CONFIDENCE.HIGH);
  assert.equal(signal.recommendedAction, null);
  assert.equal(signal.authority.state, AUTHORITY_STATE.NOT_APPLICABLE);
  assert.equal(signal.evidence.length, 1);
  assert.equal(signal.evidence[0].kind, "WORK_ORDER_PARTS_PLAN");
  assert.equal(signal.evidence[0].subjectReference, "WO-2026-000873");
  assert.equal(signal.evidence[0].facts.plannedLineCount, 2);
  assert.equal(signal.outcome, null);
});

test("the visible deterministic attention copy states uncertainty, not an invented shortage", () => {
  const { attentionItem } = deriveWorkOrderIntelligence(wo());
  assert.equal(attentionItem.severity, "ATTENTION");
  assert.match(attentionItem.fact, /cannot be confirmed/i);
  assert.match(attentionItem.fact, /no governed truck or staging availability signal/i);

  // These would assert operational facts EOS does not possess today.
  assert.doesNotMatch(attentionItem.fact, /\bon truck\b/i);
  assert.doesNotMatch(attentionItem.fact, /\bstaged\b(?! availability)/i);
  assert.doesNotMatch(attentionItem.fact, /\bmissing\b/i);
  assert.doesNotMatch(attentionItem.fact, /\bshortage\b/i);
  assert.doesNotMatch(attentionItem.fact, /\blate\b/i);
  assert.doesNotMatch(attentionItem.fact, /\bETA\b/i);
});

test("no parts plan stays quiet because the existing attention rule already owns that fact", () => {
  const signal = deriveWorkOrderIntelligence(wo({ inventorySnapshot: [] }));
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.NO_GOVERNED_PARTS_PLAN);
  assert.equal(signal.attentionItem, null);
  assert.equal(signal.evidence.length, 0);
});

test("completed, closed, and cancelled Work Orders stay quiet", () => {
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    const signal = deriveWorkOrderIntelligence(wo({ status }));
    assert.equal(signal.speak, false, status);
    assert.equal(signal.reason, NO_INSIGHT_REASON.RECORD_CLOSED, status);
    assert.equal(signal.attentionItem, null, status);
  }
});

test("missing record is a no-insight state, not an exception", () => {
  const signal = deriveWorkOrderIntelligence(null);
  assert.equal(signal.speak, false);
  assert.equal(signal.reason, NO_INSIGHT_REASON.NO_ACTIONABLE_SIGNAL);
  assert.equal(signal.context, null);
});

test("recommendation and authority remain empty until an existing governed action is actually proposed", () => {
  const signal = deriveWorkOrderIntelligence(wo());
  assert.equal(signal.recommendedAction, null);
  assert.deepEqual(signal.authority, {
    state: AUTHORITY_STATE.NOT_APPLICABLE,
    action: null,
    reason: "No governed readiness action is proposed until availability evidence exists.",
  });
});

test("the entire intelligence payload excludes raw document ids", () => {
  const payload = deriveWorkOrderIntelligence(wo());
  const encoded = JSON.stringify(payload);
  const RAW = /\b[A-Za-z0-9]{20}\b/;
  assert.doesNotMatch(encoded, RAW, "a Firestore-shaped id crossed the intelligence boundary");
});
