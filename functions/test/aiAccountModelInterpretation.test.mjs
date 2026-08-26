import test from "node:test";
import assert from "node:assert/strict";
import { verifyAccountModelInterpretation } from "../lib/ai/accountModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  observedFact: "This customer has both overdue receivables and past-due service work.",
  evidence: Object.freeze([
    Object.freeze({ key: "AR_OVERDUE", kind: "AR_OVERDUE", summary: "Accounts receivable is overdue." }),
    Object.freeze({ key: "WORK_ORDER_PAST_DUE", kind: "WORK_ORDER_PAST_DUE", summary: "Service work is past due." }),
  ]),
  allowedRecommendation: null,
});

const candidate = (over = {}) => ({
  interpretation: "Commercial and service attention are present at the same customer.",
  businessConsequence: "The customer relationship needs informed human review across both contexts.",
  confidence: "HIGH",
  confidenceBasis: "Both conditions were established by governed EOS evidence.",
  evidenceRefs: ["AR_OVERDUE", "WORK_ORDER_PAST_DUE"],
  recommendedActionId: null,
  ...over,
});

test("grounded synthesis is accepted while the EOS fact is copied", () => {
  const v = verifyAccountModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.observedFact, INPUT.observedFact);
  assert.equal(v.recommendedAction, null);
  assert.deepEqual(v.evidence.map((e) => e.key), ["AR_OVERDUE", "WORK_ORDER_PAST_DUE"]);
});

test("THE MODEL CANNOT INVENT ANY ACCOUNT ACTION", () => {
  for (const action of ["contactCustomer", "collectInvoice", "updateAccount", "createTask", "scheduleWorkOrder"]) {
    const v = verifyAccountModelInterpretation(INPUT, candidate({ recommendedActionId: action }));
    assert.equal(v.speak, false, `${action} must be refused`);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("THE MODEL CANNOT INVENT EVIDENCE", () => {
  const v = verifyAccountModelInterpretation(INPUT, candidate({ evidenceRefs: ["CUSTOMER_CHURN_RISK"] }));
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
});

test("THE MODEL CANNOT INVENT ACCOUNT FIGURES, MONEY OR DATES", () => {
  for (const field of ["interpretation", "businessConsequence", "confidenceBasis"]) {
    for (const prose of [
      "The account is 45 days overdue.",
      "The customer owes $900.",
      "Revenue risk is 30 percent.",
      "The account is worth USD value.",
    ]) {
      const v = verifyAccountModelInterpretation(INPUT, candidate({ [field]: prose }));
      assert.equal(v.speak, false, `${field}: ${prose}`);
      assert.equal(v.reason, "MODEL_OUTPUT_FACT_FABRICATION");
    }
  }
});

test("unknown candidate fields are refused instead of silently ignored", () => {
  const v = verifyAccountModelInterpretation(INPUT, { ...candidate(), accountId: "secret" });
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
});

test("ungrounded candidates cannot speak", () => {
  for (const refs of [[], null, [""], [null]]) {
    const v = verifyAccountModelInterpretation(INPUT, candidate({ evidenceRefs: refs }));
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_UNGROUNDED");
  }
});

test("malformed or action-bearing EOS input is itself refused", () => {
  const bad = [
    { ...INPUT, evidence: [] },
    { ...INPUT, schemaVersion: 2 },
    { ...INPUT, allowedRecommendation: { actionId: "contactCustomer" } },
    { ...INPUT, evidence: [{ key: "OTHER", kind: "OTHER", summary: "Other" }] },
  ];
  for (const input of bad) {
    const v = verifyAccountModelInterpretation(input, candidate());
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
  }
});
