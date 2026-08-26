// THE FIRST GOVERNED SALES ORDER RECOMMENDATION, AS ASSERTIONS.
//
// What must hold: EOS may only ever name an action it already has, the model may only ever see
// business-semantic words, and anything EOS cannot fully read produces silence rather than a
// confident recommendation over a document it does not understand.
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveGovernedSalesOrderAllocationRecommendation,
  acceptGovernedSalesOrderAllocationRecommendation,
  SALES_ORDER_ALLOCATE_ACTION_ID,
  SALES_ORDER_RECOMMENDATION_REASON as REASON,
} from "../src/domain/salesOrderGovernedRecommendation.js";
import {
  deriveSalesOrderIntelligence,
  buildSalesOrderInterpretationInput,
  AUTHORITY_STATE,
  NO_INSIGHT_REASON,
} from "../src/domain/salesOrderIntelligence.js";

const line = (over = {}) => ({ lineId: "l1", kind: "PART", ref: "X49463-3", orderedQty: 4, allocatedQty: 1, ...over });
const so = (over = {}) => ({
  id: "sodocidaaaaaaaaaaaaa",
  soNumber: "SO-2026-000141",
  state: "CONFIRMED",
  lines: [line()],
  ...over,
});

// ═════════════════════════════════════ THE HAPPY PATH IS NARROW

test("an outstanding PART line on an active order maps to the EXISTING allocate action", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: true });
  assert.equal(r.speak, true);
  assert.equal(r.reason, REASON.READY);
  assert.equal(r.recommendation.actionId, SALES_ORDER_ALLOCATE_ACTION_ID);
  assert.equal(r.recommendation.authority, "ALLOWED");
});

test("SEVERAL outstanding lines is NOT ambiguity — allocation is order-scoped", () => {
  // The Work Order recommendation fails closed on multiple shortages because choosing one would be
  // an AI prioritisation decision. allocateSalesOrder(salesOrderId) addresses them all at once, so
  // there is nothing to prioritise and refusing here would reject the commonest legitimate case.
  const r = deriveGovernedSalesOrderAllocationRecommendation(
    so({ lines: [line(), line({ lineId: "l2", kind: "SERVICE", orderedQty: 2, allocatedQty: 0 })] }),
    { canAllocate: true },
  );
  assert.equal(r.speak, true);
  assert.equal(r.evidence.outstandingLineCount, 2);
  assert.deepEqual(r.evidence.outstandingKinds, ["PART", "SERVICE"]);
});

// ═════════════════════════════════════ EVERY REFUSAL

test("a fully allocated order says nothing", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(
    so({ lines: [line({ allocatedQty: 4 })] }), { canAllocate: true });
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.FULLY_ALLOCATED);
});

test("a state the allocate command refuses is never recommended", () => {
  for (const state of ["DRAFT", "FULFILLED", "CLOSED", "CANCELLED", null, undefined]) {
    const r = deriveGovernedSalesOrderAllocationRecommendation(so({ state }), { canAllocate: true });
    assert.equal(r.speak, false, `state ${state} must not recommend`);
    assert.equal(r.reason, REASON.STATE_NOT_ELIGIBLE);
  }
});

test("EQUIPMENT-ONLY outstanding work FAILS CLOSED — allocation cannot resolve it today", () => {
  // allocateSalesOrder deliberately returns UNKNOWN for serialized equipment until the equipment
  // availability contract exists. Recommending it would be honest about the action and misleading
  // about the outcome.
  const r = deriveGovernedSalesOrderAllocationRecommendation(
    so({ lines: [line({ kind: "EQUIPMENT_MODEL", allocatedQty: 0 })] }), { canAllocate: true });
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.ONLY_EQUIPMENT_OUTSTANDING);
});

test("an equipment line alongside an actionable one does not block the recommendation", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(
    so({ lines: [line({ kind: "EQUIPMENT_MODEL", allocatedQty: 0 }), line({ lineId: "l2" })] }),
    { canAllocate: true },
  );
  assert.equal(r.speak, true);
  assert.deepEqual(r.evidence.outstandingKinds, ["PART"], "only kinds allocation can act on are cited");
});

test("WITHOUT THE CAPABILITY THE ACTION IS NEVER EXPOSED TO THE MODEL", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: false });
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.ALLOCATE_NOT_ELIGIBLE);
  assert.equal(r.authority, "DENIED");
  assert.equal(r.recommendation, null);
});

test("ABSENT AUTHORITY IS NOT AUTHORITY — the capability defaults to false", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(so());
  assert.equal(r.speak, false);
  assert.equal(r.authority, "DENIED");
});

test("DEGRADED LINE DATA STOPS THE WHOLE ORDER, not just the bad line", () => {
  const degraded = [
    { lines: [line({ orderedQty: Number.NaN })] },
    { lines: [line({ allocatedQty: undefined })] },
    { lines: [line({ orderedQty: -1 })] },
    { lines: [line({ allocatedQty: -2 })] },
    { lines: [line({ kind: "" })] },
    { lines: [line(), null] },
    // Allocated beyond ordered is CONFLICTING, not a rounding artefact.
    { lines: [line({ orderedQty: 2, allocatedQty: 5 })] },
    // One good line and one unreadable line still refuses.
    { lines: [line(), line({ lineId: "l2", orderedQty: "4" })] },
  ];
  for (const over of degraded) {
    const r = deriveGovernedSalesOrderAllocationRecommendation(so(over), { canAllocate: true });
    assert.equal(r.speak, false, `should fail closed: ${JSON.stringify(over)}`);
    assert.equal(r.reason, REASON.LINE_DATA_UNUSABLE);
  }
});

test("no projection, no lines array, no id — silence in every case", () => {
  for (const input of [null, undefined, {}, { state: "CONFIRMED" }, { state: "CONFIRMED", lines: "nope" }]) {
    assert.equal(deriveGovernedSalesOrderAllocationRecommendation(input, { canAllocate: true }).speak, false);
  }
  const r = deriveGovernedSalesOrderAllocationRecommendation(so({ id: "  " }), { canAllocate: true });
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.NO_PROJECTION);
});

// ═════════════════════════════════════ WHAT MAY CROSS TO THE MODEL

test("NO IDENTIFIER, QUANTITY OR MONEY REACHES THE MODEL DESCRIPTOR", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(
    so({ lines: [line({ unitPriceMinor: 129900, extendedMinor: 519600 })] }), { canAllocate: true });
  const exposed = JSON.stringify(r.recommendation);
  assert.deepEqual(Object.keys(r.recommendation).sort(), ["actionId", "authority", "label"]);
  for (const f of ["sodocidaaaaaaaaaaaaa", "X49463-3", "129900", "519600"]) {
    assert.ok(!exposed.includes(f), `descriptor leaked ${f}`);
  }
});

test("the execution object carries the id and is NEVER part of the model payload", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: true });
  assert.equal(r.execution.salesOrderId, "sodocidaaaaaaaaaaaaa");
  const intelligence = deriveSalesOrderIntelligence(so(), { canAllocate: true });
  const payload = buildSalesOrderInterpretationInput(intelligence, { salesOrderNumber: "SO-2026-000141" });
  assert.ok(!JSON.stringify(payload).includes("sodocidaaaaaaaaaaaaa"), "the model payload carries a document id");
});

test("the model subject is the GOVERNED REFERENCE or nothing — never the document id", () => {
  const intelligence = deriveSalesOrderIntelligence(so(), { canAllocate: true });
  assert.equal(
    buildSalesOrderInterpretationInput(intelligence, { salesOrderNumber: "SO-2026-000141" }).subjectReference,
    "SO-2026-000141",
  );
  for (const bad of [null, "", "sodocidaaaaaaaaaaaaa", "SO-141", "2026-000141"]) {
    assert.equal(
      buildSalesOrderInterpretationInput(intelligence, { salesOrderNumber: bad }).subjectReference,
      null,
      `${bad} must not become a subject reference`,
    );
  }
});

test("the model payload names ONLY the allowed action, and carries no execution field", () => {
  const intelligence = deriveSalesOrderIntelligence(so(), { canAllocate: true });
  const payload = buildSalesOrderInterpretationInput(intelligence, { salesOrderNumber: "SO-2026-000141" });
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["allowedRecommendation", "deterministicBusinessConsequence", "deterministicInterpretation",
      "evidence", "observedFact", "schemaVersion", "subjectReference"],
  );
  assert.equal(payload.allowedRecommendation.actionId, SALES_ORDER_ALLOCATE_ACTION_ID);
});

// ═════════════════════════════════════ THE INTELLIGENCE SIGNAL

test("silence maps every refusal to a stated reason, and DENIED is stated as authority", () => {
  assert.equal(deriveSalesOrderIntelligence(so({ state: "CLOSED" })).reason, NO_INSIGHT_REASON.NOT_IN_FULFILMENT);
  assert.equal(deriveSalesOrderIntelligence(so({ lines: [line({ allocatedQty: 4 })] }), { canAllocate: true }).reason,
    NO_INSIGHT_REASON.FULLY_ALLOCATED);
  assert.equal(deriveSalesOrderIntelligence(so({ lines: [line({ kind: "EQUIPMENT_MODEL", allocatedQty: 0 })] }), { canAllocate: true }).reason,
    NO_INSIGHT_REASON.ALLOCATION_CANNOT_RESOLVE);
  assert.equal(deriveSalesOrderIntelligence(so({ lines: [line({ orderedQty: Number.NaN })] }), { canAllocate: true }).reason,
    NO_INSIGHT_REASON.ORDER_STATE_DEGRADED);
  const denied = deriveSalesOrderIntelligence(so(), { canAllocate: false });
  assert.equal(denied.authority.state, AUTHORITY_STATE.DENIED);
  assert.equal(denied.recommendedAction, null);
  assert.equal(buildSalesOrderInterpretationInput(denied), null, "a silent signal builds no model payload");
});

test("the signal is DETERMINISTIC and says so — it must never be labelled AI", () => {
  const s = deriveSalesOrderIntelligence(so(), { canAllocate: true });
  assert.equal(s.origin, "DETERMINISTIC");
  assert.equal(s.authority.state, AUTHORITY_STATE.ALLOWED);
  assert.match(s.confidence.basis, /does not read, infer or predict inventory availability/);
});

test("the observed fact describes lines and kinds, never a quantity or a reference", () => {
  const s = deriveSalesOrderIntelligence(
    so({ lines: [line({ orderedQty: 40, allocatedQty: 7 })] }), { canAllocate: true });
  assert.match(s.observedFact, /1 line \(part\)/);
  assert.ok(!s.observedFact.includes("40") && !s.observedFact.includes("7"), "a quantity leaked into the fact");
  assert.ok(!s.observedFact.includes("X49463-3"), "a line reference leaked into the fact");
});

// ═════════════════════════════════════ ACCEPTANCE

test("ACCEPTANCE CALLS THE EXISTING SEAM AND NOTHING ELSE", () => {
  const r = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: true });
  const calls = [];
  acceptGovernedSalesOrderAllocationRecommendation({
    governedRecommendation: r,
    runAllocate: (args) => { calls.push(args); return { ok: true }; },
  });
  assert.deepEqual(calls, [{ salesOrderId: "sodocidaaaaaaaaaaaaa" }]);
});

test("acceptance refuses anything that is not the governed allocate recommendation", () => {
  const good = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: true });
  const runAllocate = () => ({ ok: true });
  assert.throws(() => acceptGovernedSalesOrderAllocationRecommendation({ governedRecommendation: null, runAllocate }));
  assert.throws(() => acceptGovernedSalesOrderAllocationRecommendation({
    governedRecommendation: { recommendation: { actionId: "transitionSalesOrder" }, execution: { actionId: "transitionSalesOrder" } },
    runAllocate,
  }));
  // A descriptor whose two halves disagree is a tampered object, not a recommendation.
  assert.throws(() => acceptGovernedSalesOrderAllocationRecommendation({
    governedRecommendation: { recommendation: good.recommendation, execution: { actionId: "createServiceForSalesOrder", salesOrderId: "x" } },
    runAllocate,
  }));
  assert.throws(() => acceptGovernedSalesOrderAllocationRecommendation({ governedRecommendation: good, runAllocate: null }),
    /Existing allocate action is required/);
});

test("acceptance never invents an identity", () => {
  const good = deriveGovernedSalesOrderAllocationRecommendation(so(), { canAllocate: true });
  assert.throws(() => acceptGovernedSalesOrderAllocationRecommendation({
    governedRecommendation: { ...good, execution: { actionId: SALES_ORDER_ALLOCATE_ACTION_ID, salesOrderId: "   " } },
    runAllocate: () => ({ ok: true }),
  }), /missing execution identity/);
});
