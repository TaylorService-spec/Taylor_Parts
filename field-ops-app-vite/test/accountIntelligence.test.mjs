import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAccountIntelligence,
  toAccountModelInput,
  ACCOUNT_INTELLIGENCE_REASON as REASON,
} from "../src/domain/accountIntelligence.js";

const READY = "ready";
const projection = (items = [], sourceStatus = { ar: READY, workOrder: READY }) => ({ items, sourceStatus });
const ar = (over = {}) => ({
  attentionItemId: "account:ar:secret-account:secret-invoice",
  domain: "ar",
  objectType: "invoice",
  objectId: "secret-invoice",
  accountId: "secret-account",
  reason: "OVERDUE",
  invoiceNumber: "INV-999",
  outstandingText: "$9,999.00",
  daysOverdueText: "45 days",
  deepLink: "/customers/secret-account#account-ar-section",
  ...over,
});
const wo = (over = {}) => ({
  attentionItemId: "wo:secret-work-order:past-due",
  domain: "workOrder",
  objectType: "workOrder",
  objectId: "secret-work-order",
  reason: "PAST_DUE",
  deepLink: "/work-orders/secret-work-order",
  ...over,
});

test("AR overdue becomes a bounded deterministic Account fact with NO recommendation", () => {
  const r = deriveAccountIntelligence(projection([ar()]));
  assert.equal(r.speak, true);
  assert.equal(r.reason, REASON.READY);
  assert.equal(r.allowedRecommendation, null);
  assert.deepEqual(r.evidence.map((e) => e.key), ["AR_OVERDUE"]);
});

test("past-due service becomes its own established Account fact", () => {
  const r = deriveAccountIntelligence(projection([wo()]));
  assert.equal(r.speak, true);
  assert.deepEqual(r.evidence.map((e) => e.key), ["WORK_ORDER_PAST_DUE"]);
});

test("the two unlike conditions coexist without ranking or inventing a combined action", () => {
  const r = deriveAccountIntelligence(projection([wo(), ar()]));
  assert.equal(r.speak, true);
  assert.deepEqual(r.evidence.map((e) => e.key), ["AR_OVERDUE", "WORK_ORDER_PAST_DUE"]);
  assert.equal(r.allowedRecommendation, null);
});

test("healthy confirmed sources produce silence", () => {
  const r = deriveAccountIntelligence(projection([]));
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.NO_ATTENTION);
});

test("ANY degraded source makes the Account story fail closed", () => {
  for (const status of ["loading", "denied", "unavailable", undefined, null]) {
    const arBad = deriveAccountIntelligence(projection([wo()], { ar: status, workOrder: READY }));
    assert.equal(arBad.speak, false);
    assert.equal(arBad.reason, REASON.SOURCE_DEGRADED);
    const woBad = deriveAccountIntelligence(projection([ar()], { ar: READY, workOrder: status }));
    assert.equal(woBad.speak, false);
    assert.equal(woBad.reason, REASON.SOURCE_DEGRADED);
  }
});

test("the model payload strips ids, deep links, amounts, invoice numbers and dates", () => {
  const input = toAccountModelInput(deriveAccountIntelligence(projection([ar(), wo()])));
  assert.ok(input);
  assert.equal(input.allowedRecommendation, null);
  const json = JSON.stringify(input);
  for (const forbidden of [
    "secret-account", "secret-invoice", "secret-work-order", "INV-999", "$9,999.00",
    "45 days", "/customers/", "/work-orders/", "objectId", "accountId", "deepLink",
  ]) {
    assert.equal(json.includes(forbidden), false, `model payload leaked ${forbidden}`);
  }
});

test("silence is never sent to a model", () => {
  assert.equal(toAccountModelInput(deriveAccountIntelligence(projection([]))), null);
  assert.equal(toAccountModelInput(deriveAccountIntelligence(null)), null);
});
