// THE SALES ORDER VERIFIER CANNOT BE TALKED INTO AUTHORITY.
//
// Every test below hands the verifier untrusted model output and asserts it is refused, or accepted
// only in exactly the shape EOS supplied. The commercial rules are the ones worth staring at: an
// invented price or quantity on a Sales Order is not a cosmetic defect, it is a claim about money
// the business is owed.
import test from "node:test";
import assert from "node:assert/strict";
import { verifySalesOrderModelInterpretation } from "../lib/ai/salesOrderModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  subjectReference: "SO-2026-000141",
  observedFact: "The Sales Order records 2 lines (part and service) not fully allocated.",
  deterministicInterpretation: "Allocation has not been completed for every line this order can currently allocate.",
  deterministicBusinessConsequence: "Fulfilment cannot be treated as ready for these lines.",
  evidence: Object.freeze([
    Object.freeze({ key: "sales-order-outstanding-allocation", kind: "SALES_ORDER_OUTSTANDING_ALLOCATION", summary: "Lines where allocated is below ordered." }),
  ]),
  allowedRecommendation: Object.freeze({ actionId: "allocateSalesOrder", label: "Allocate", authority: "ALLOWED" }),
});

const candidate = (over = {}) => ({
  interpretation: "Some ordered lines have not been allocated yet.",
  businessConsequence: "The order is not ready to fulfil until allocation runs.",
  confidence: "HIGH",
  confidenceBasis: "Stated directly by the order's own allocation record.",
  evidenceRefs: ["sales-order-outstanding-allocation"],
  recommendedActionId: "allocateSalesOrder",
  ...over,
});

test("a grounded candidate is accepted, and EOS-owned fields are COPIED not trusted", () => {
  const v = verifySalesOrderModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.origin, "MODEL");
  assert.equal(v.observedFact, INPUT.observedFact, "observed fact must come from EOS");
  assert.equal(v.subjectReference, "SO-2026-000141");
  assert.equal(v.recommendedAction.actionId, "allocateSalesOrder");
  assert.equal(v.evidence[0].summary, INPUT.evidence[0].summary);
});

test("THE MODEL CANNOT OVERWRITE THE OBSERVED FACT OR THE SUBJECT", () => {
  const v = verifySalesOrderModelInterpretation(INPUT, candidate({}));
  assert.equal(v.observedFact, INPUT.observedFact);
  // Even a candidate that tries to carry them is refused for having unknown keys.
  const sneaky = verifySalesOrderModelInterpretation(INPUT, { ...candidate(), observedFact: "everything is fine" });
  assert.equal(sneaky.speak, false);
  assert.equal(sneaky.reason, "MODEL_OUTPUT_INVALID");
});

// ═════════════════════════════════════ COMMERCIAL FABRICATION

test("A NUMBER IN MODEL PROSE IS REFUSED — quantities and prices may not originate in the model", () => {
  for (const field of ["interpretation", "businessConsequence", "confidenceBasis"]) {
    for (const prose of [
      "3 lines are short",
      "about 40% of the order",
      "the customer owes 1299.00",
    ]) {
      const v = verifySalesOrderModelInterpretation(INPUT, candidate({ [field]: prose }));
      assert.equal(v.speak, false, `${field}: "${prose}" should be refused`);
      assert.equal(v.reason, "MODEL_OUTPUT_COMMERCIAL_FABRICATION");
    }
  }
});

test("A CURRENCY ASSERTED BY THE MODEL IS A TERM NOBODY AGREED TO", () => {
  for (const prose of ["priced in USD", "worth about $ten thousand", "roughly £ value", "a percent of the total"]) {
    const v = verifySalesOrderModelInterpretation(INPUT, candidate({ businessConsequence: prose }));
    assert.equal(v.speak, false, `"${prose}" should be refused`);
    assert.equal(v.reason, "MODEL_OUTPUT_COMMERCIAL_FABRICATION");
  }
});

test("prose that explains without asserting figures is accepted", () => {
  const v = verifySalesOrderModelInterpretation(INPUT, candidate({
    interpretation: "Part and service lines remain unallocated on an active order.",
    businessConsequence: "Fulfilment should not be promised until allocation has run.",
  }));
  assert.equal(v.speak, true);
});

// ═════════════════════════════════════ ACTION AUTHORITY

test("THE MODEL CANNOT NAME AN ACTION EOS DID NOT ALLOW", () => {
  for (const id of ["transitionSalesOrder", "createServiceForSalesOrder", "cancelSalesOrder", "deleteSalesOrder"]) {
    const v = verifySalesOrderModelInterpretation(INPUT, candidate({ recommendedActionId: id }));
    assert.equal(v.speak, false, `${id} must be refused`);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("A DENIED RECOMMENDATION MAY NOT BE ECHOED — denied is not a weaker allowed", () => {
  const denied = { ...INPUT, allowedRecommendation: { actionId: "allocateSalesOrder", label: "Allocate", authority: "DENIED" } };
  const v = verifySalesOrderModelInterpretation(denied, candidate());
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
});

test("when EOS allows NO action, naming any action is refused; naming none is accepted", () => {
  const none = { ...INPUT, allowedRecommendation: null };
  assert.equal(verifySalesOrderModelInterpretation(none, candidate()).speak, false);
  const quiet = verifySalesOrderModelInterpretation(none, candidate({ recommendedActionId: null }));
  assert.equal(quiet.speak, true);
  assert.equal(quiet.recommendedAction, null);
});

// ═════════════════════════════════════ GROUNDING

test("EVIDENCE MUST BE EOS-OWNED — an invented key is refused", () => {
  for (const refs of [["made-up-key"], ["sales-order-outstanding-allocation", "made-up-key"]]) {
    const v = verifySalesOrderModelInterpretation(INPUT, candidate({ evidenceRefs: refs }));
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
  }
});

test("UNGROUNDED OUTPUT IS REFUSED — an interpretation must cite something", () => {
  for (const refs of [[], null, "sales-order-outstanding-allocation", [""], [3]]) {
    const v = verifySalesOrderModelInterpretation(INPUT, candidate({ evidenceRefs: refs }));
    assert.equal(v.speak, false, `refs ${JSON.stringify(refs)} should be refused`);
    assert.equal(v.reason, "MODEL_OUTPUT_UNGROUNDED");
  }
});

test("duplicate refs resolve once, in EOS order", () => {
  const v = verifySalesOrderModelInterpretation(INPUT, candidate({
    evidenceRefs: ["sales-order-outstanding-allocation", "sales-order-outstanding-allocation"],
  }));
  assert.equal(v.speak, true);
  assert.equal(v.evidence.length, 1);
});

// ═════════════════════════════════════ SHAPE

test("unknown keys, wrong types and empty prose are all refused", () => {
  assert.equal(verifySalesOrderModelInterpretation(INPUT, null).reason, "MODEL_OUTPUT_INVALID");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, []).reason, "MODEL_OUTPUT_INVALID");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, "hello").reason, "MODEL_OUTPUT_INVALID");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ extra: 1 })).reason, "MODEL_OUTPUT_INVALID");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ confidence: "VERY_HIGH" })).reason, "MODEL_OUTPUT_INVALID");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ interpretation: "   " })).reason, "MODEL_OUTPUT_EMPTY");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ businessConsequence: "" })).reason, "MODEL_OUTPUT_EMPTY");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ confidenceBasis: null })).reason, "MODEL_OUTPUT_EMPTY");
  assert.equal(verifySalesOrderModelInterpretation(INPUT, candidate({ recommendedActionId: "  " })).reason, "MODEL_OUTPUT_INVALID");
});

test("THERE IS NO PARTIAL SALVAGE — one bad field rejects the whole interpretation", () => {
  const v = verifySalesOrderModelInterpretation(INPUT, candidate({ evidenceRefs: ["nope"] }));
  assert.equal(v.speak, false);
  assert.deepEqual(Object.keys(v).sort(), ["origin", "reason", "speak"]);
  assert.equal(v.interpretation, undefined, "a rejection must not leak partial model prose");
});
