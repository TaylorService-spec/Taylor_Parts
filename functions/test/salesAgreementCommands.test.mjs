// THE COMMERCIAL COMMITMENT — build, accept, and hand priced lines to a Sales Order.
//
// GOVERNANCE: Owner Decision 2 + Slice 4.
//
// Nothing owned commercial commitment. Opportunity carries one forecast number on its header and
// lines of `{ kind, ref, qty }` with no price, so WON -> Sales Order produced orders with no
// committed pricing — which is where the seven unpriced CONFIRMED records came from.
//
// Every case runs the REAL commands from the compiled lib and asserts on what they return or throw.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateSalesAgreement,
  buildAcceptSalesAgreement,
  deriveSalesOrderLinesFromAgreement,
  computeAgreementTotals,
  SalesAgreementCommandError,
} from "../lib/salesAgreement/salesAgreementCommands.js";
import { checkAgreementTransition, SALES_AGREEMENT_STATES } from "../lib/salesAgreement/salesAgreementLifecycle.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };
const base = (lines, extra = {}) => ({
  accountId: "acct-1", ownerEmployeeId: "emp-1", lines, ...extra,
});
const build = (lines, extra) => buildCreateSalesAgreement(base(lines, extra), CTX);
const priced = (unitPrice = 12000) => [{ kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 2, unitPrice }];
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof SalesAgreementCommandError && e.code === code);

// ═════════════════════════════════════════ a draft may be incomplete

test("a DRAFT may carry an unpriced line — that is what a draft is", () => {
  const a = build([{ kind: "PART", ref: "PRT-1", quantity: 1 }]);
  assert.equal(a.state, "DRAFT");
  assert.equal(a.lines[0].unitPrice, null);
  // No price means no extension, and NULL rather than 0 — zero would say the line is free.
  assert.equal(a.lines[0].extendedMinor, null);
});

test("a draft with any unpriced line has NO subtotal, total or balance", () => {
  // A partial sum presented as a total is a real number that is not what the customer would be
  // committing to, and somebody would sign it.
  const a = build([
    { kind: "PART", ref: "A", quantity: 1, unitPrice: 500 },
    { kind: "PART", ref: "B", quantity: 1 },
  ]);
  assert.equal(a.totals.subtotalMinor, null);
  assert.equal(a.totals.totalMinor, null);
  assert.equal(a.totals.balanceMinor, null);
});

// ═════════════════════════════════════════ the document's own arithmetic

test("subtotal, total and balance are COMPUTED, and agree with the lines", () => {
  const a = build(priced(12000), {
    shippingMinor: 5000, installChargeMinor: 25000, taxMinor: 3000,
    downPaymentMinor: 10000, tradeInMinor: 4000,
  });
  assert.equal(a.lines[0].extendedMinor, 24000);          // 2 x 12000
  assert.equal(a.totals.subtotalMinor, 24000);
  assert.equal(a.totals.totalMinor, 24000 + 5000 + 25000 + 3000);
  assert.equal(a.totals.balanceMinor, 57000 - 10000 - 4000);
});

test("charges default to zero when not supplied, and zero is a real amount", () => {
  const a = build(priced(1000));
  assert.equal(a.totals.shippingMinor, 0);
  assert.equal(a.totals.installChargeMinor, 0);
  assert.equal(a.totals.totalMinor, 2000);
  // A waived install and a zero trade-in are legitimate commercial acts.
  const waived = build(priced(1000), { installChargeMinor: 0, tradeInMinor: 0 });
  assert.equal(waived.totals.totalMinor, 2000);
  assert.equal(waived.totals.balanceMinor, 2000);
});

test("money must be integer minor units, non-negative, everywhere", () => {
  throwsCode(() => build([{ kind: "PART", ref: "A", quantity: 1, unitPrice: 12.5 }]), "MONEY_INVALID");
  throwsCode(() => build([{ kind: "PART", ref: "A", quantity: 1, unitPrice: -1 }]), "MONEY_INVALID");
  for (const field of ["shippingMinor", "installChargeMinor", "taxMinor", "downPaymentMinor", "tradeInMinor"]) {
    throwsCode(() => build(priced(), { [field]: 1.5 }), "MONEY_INVALID");
    throwsCode(() => build(priced(), { [field]: -1 }), "MONEY_INVALID");
  }
});

test("tax is INJECTED, never computed", () => {
  // No tax logic exists here, and none is invented. The number supplied is the number carried.
  const a = build(priced(1000), { taxMinor: 137 });
  assert.equal(a.totals.taxMinor, 137);
  assert.equal(a.totals.totalMinor, 2000 + 137);
});

// ═════════════════════════════════════════ acceptance is the pricing gate

test("ACCEPTANCE REQUIRES A PRICE ON EVERY LINE, and names every one missing", () => {
  const draft = build([
    { kind: "PART", ref: "PRT-A", quantity: 1 },
    { kind: "PART", ref: "PRT-B", quantity: 1, unitPrice: 500 },
    { kind: "SERVICE", ref: "SVC-C", businessUnitId: "SERVICE", quantity: 1 },
  ]);
  try {
    buildAcceptSalesAgreement(draft, CTX);
    assert.fail("expected UNPRICED_LINE");
  } catch (e) {
    assert.equal(e.code, "UNPRICED_LINE");
    assert.match(e.message, /PRT-A/);
    assert.match(e.message, /SVC-C/);
    assert.doesNotMatch(e.message, /PRT-B/, "a priced line must not be reported as unpriced");
  }
});

test("a fully priced draft accepts, and records who and when", () => {
  const accepted = buildAcceptSalesAgreement(build(priced()), CTX);
  assert.equal(accepted.state, "ACCEPTED");
  assert.equal(accepted.acceptedByUid, "uid-1");
  assert.equal(accepted.acceptedAtMillis, CTX.nowMillis);
});

test("a zero-price line is acceptable — absent is what is refused", () => {
  const zero = build([{ kind: "PART", ref: "FREE", quantity: 3, unitPrice: 0 }]);
  assert.equal(zero.lines[0].extendedMinor, 0);
  assert.equal(zero.totals.subtotalMinor, 0);
  assert.doesNotThrow(() => buildAcceptSalesAgreement(zero, CTX));
});

test("ACCEPTED and DECLINED are terminal, and nothing returns to DRAFT", () => {
  // An accepted commitment that could be un-accepted would let the prices a Sales Order was created
  // from change underneath it.
  assert.equal(checkAgreementTransition("ACCEPTED", "DECLINED").ok, false);
  assert.equal(checkAgreementTransition("DECLINED", "ACCEPTED").ok, false);
  assert.equal(checkAgreementTransition("DRAFT", "DRAFT").ok, false);
  assert.equal(checkAgreementTransition("DRAFT", "ACCEPTED").ok, true);
  throwsCode(() => buildAcceptSalesAgreement({ state: "ACCEPTED", lines: priced() }, CTX), "ILLEGAL_TRANSITION");
  assert.deepEqual([...SALES_AGREEMENT_STATES], ["DRAFT", "ACCEPTED", "DECLINED"]);
});

// ═════════════════════════════════════════ handing prices to the Sales Order

test("an accepted agreement yields Sales Order lines WITH their committed prices", () => {
  // The replacement for the unpriced shortcut. deriveSalesOrderLines mapped Opportunity lines
  // straight through with no price, because an Opportunity has none.
  const a = build([
    { kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 2, unitPrice: 500000 },
    { kind: "PART", ref: "PRT-1", quantity: 4, unitPrice: 2500 },
  ]);
  const lines = deriveSalesOrderLinesFromAgreement({ ...a, state: "ACCEPTED" });
  assert.deepEqual(lines, [
    // FIN-002: the reporting unit travels with the committed price.
    { kind: "EQUIPMENT_MODEL", ref: "C713", businessUnitId: "EQUIPMENT_SALES", orderedQty: 2, unitPrice: 500000 },
    { kind: "PART", ref: "PRT-1", businessUnitId: "PARTS", orderedQty: 4, unitPrice: 2500 },
  ]);
});

test("a DRAFT cannot seed a Sales Order — provisional prices are not a commitment", () => {
  throwsCode(() => deriveSalesOrderLinesFromAgreement(build(priced())), "ILLEGAL_TRANSITION");
});

test("multiple prices survive unchanged, and a zero survives as zero", () => {
  const a = build([
    { kind: "PART", ref: "A", quantity: 1, unitPrice: 1 },
    { kind: "PART", ref: "B", quantity: 1, unitPrice: 0 },
    { kind: "PART", ref: "C", quantity: 1, unitPrice: 999999 },
  ]);
  const lines = deriveSalesOrderLinesFromAgreement({ ...a, state: "ACCEPTED" });
  assert.deepEqual(lines.map((l) => l.unitPrice), [1, 0, 999999]);
});

// ═════════════════════════════════════════ the boundaries that must not move

test("a serialized reference is forbidden, exactly as on the Sales Order", () => {
  // Selling "this exact machine" before one has been picked is a promise the warehouse never made.
  for (const key of ["serial", "serialNumber", "serializedAssetId", "equipmentId"]) {
    throwsCode(
      () => build([{ kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 1, unitPrice: 1, [key]: "SN-1" }]),
      "SERIALIZED_LINE_FORBIDDEN",
    );
  }
});

test("quantity must be a positive integer", () => {
  for (const q of [0, -1, 1.5, "2"]) {
    throwsCode(() => build([{ kind: "PART", ref: "A", quantity: q, unitPrice: 1 }]), "QTY_INVALID");
  }
});

test("an agreement requires an account, an owner and at least one line", () => {
  throwsCode(() => buildCreateSalesAgreement({ ownerEmployeeId: "e", lines: priced() }, CTX), "ACCOUNT_REQUIRED");
  throwsCode(() => buildCreateSalesAgreement({ accountId: "a", lines: priced() }, CTX), "OWNER_REQUIRED");
  throwsCode(() => buildCreateSalesAgreement(base([]), CTX), "NO_LINES");
});

test("fulfillment intent is a closed set", () => {
  for (const intent of ["DELIVER", "INSTALL", "BOTH"]) {
    assert.equal(build(priced(), { fulfillmentIntent: intent }).fulfillmentIntent, intent);
  }
  throwsCode(() => build(priced(), { fulfillmentIntent: "SHIP_MAYBE" }), "INTENT_INVALID");
  // Absent is allowed: not every agreement states it.
  assert.equal(build(priced()).fulfillmentIntent, null);
});

test("the commercial facts the paper form carries are recorded, not dropped", () => {
  const a = build(priced(), {
    locationId: "loc-1", sourceOpportunityId: "opp-1", customerPO: " PO-77 ",
    isLease: true, shippingInstructions: "Rear dock", shipVia: "Own truck",
    specialInstructions: "Call ahead",
  });
  assert.equal(a.locationId, "loc-1");
  assert.equal(a.sourceOpportunityId, "opp-1");
  assert.equal(a.customerPO, "PO-77");   // trimmed
  assert.equal(a.isLease, true);
  assert.equal(a.shipVia, "Own truck");
  assert.equal(a.currency, "USD");        // server-set, never client-supplied
});

test("computeAgreementTotals is usable on its own and refuses bad money", () => {
  const lines = [{ lineId: "l1", ref: "A", quantity: 2, unitPrice: 100, extendedMinor: 200 }];
  assert.equal(computeAgreementTotals(lines, {}).totalMinor, 200);
  throwsCode(() => computeAgreementTotals(lines, { taxMinor: -5 }), "MONEY_INVALID");
});
