import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSalesAgreementIntelligence,
  toSalesAgreementModelInput,
  SALES_AGREEMENT_INTELLIGENCE_REASON as REASON,
} from "../src/domain/salesAgreementIntelligence.js";

const draft = (over = {}) => ({
  kind: "READY",
  id: "agreement-secret-id",
  salesAgreementNumber: "SA-2026-000777",
  state: "DRAFT",
  accountId: "account-secret",
  ownerEmployeeId: "owner-secret",
  currency: "USD",
  customerPO: "PO-SECRET",
  sourceOpportunityId: "opportunity-secret",
  salesOrderId: null,
  subtotalMinor: null,
  totalMinor: null,
  lines: [],
  ...over,
});

test("empty draft exposes only the existing acceptance blocker and no action", () => {
  const r = deriveSalesAgreementIntelligence(draft());
  assert.equal(r.speak, true);
  assert.equal(r.reason, REASON.READY);
  assert.equal(r.allowedRecommendation, null);
  assert.deepEqual(r.evidence.map((e) => e.kind), ["NO_LINES"]);
});

test("unpriced lines expose the pricing-completeness blocker without prices or references", () => {
  const r = deriveSalesAgreementIntelligence(draft({
    lines: [{ lineId: "line-secret", ref: "PART-SECRET", quantity: 3, unitPriceMinor: null }],
  }));
  assert.equal(r.speak, true);
  assert.deepEqual(r.evidence.map((e) => e.kind), ["UNPRICED_LINES"]);

  const input = toSalesAgreementModelInput(r);
  const serialized = JSON.stringify(input);
  for (const forbidden of ["agreement-secret-id", "account-secret", "owner-secret", "SA-2026-000777", "USD", "PO-SECRET", "PART-SECRET", "line-secret", "3"]) {
    assert.equal(serialized.includes(forbidden), false, `must not expose ${forbidden}`);
  }
});

test("acceptance-eligible draft stays silent", () => {
  const r = deriveSalesAgreementIntelligence(draft({
    lines: [{ lineId: "line-1", ref: "PART-1", quantity: 1, unitPriceMinor: 5000 }],
  }));
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.NO_ATTENTION);
});

test("terminal Agreements stay silent", () => {
  for (const state of ["ACCEPTED", "DECLINED"]) {
    const r = deriveSalesAgreementIntelligence(draft({ state }));
    assert.equal(r.speak, false);
    assert.equal(r.reason, REASON.TERMINAL);
  }
});

test("non-ready and unknown states fail closed", () => {
  assert.equal(deriveSalesAgreementIntelligence({ kind: "DENIED" }).reason, REASON.INPUT_INVALID);
  assert.equal(deriveSalesAgreementIntelligence(draft({ state: "UNKNOWN" })).reason, REASON.INPUT_INVALID);
  assert.equal(toSalesAgreementModelInput({ speak: true, reason: REASON.READY, evidence: [], allowedRecommendation: null }), null);
});
