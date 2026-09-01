// ACCEPTED COMMITMENT -> OPERATIONAL ORDER.
//
// GOVERNANCE: Owner Slice 4 D2.
//
// ════════════════════ WHAT THIS REPLACES ════════════════════
//
// `deriveSalesOrderLines` mapped Opportunity `{ kind, ref, qty }` straight through with NO price,
// because an Opportunity has none — it carries `expectedValue`, one forecast number on the header.
// Every order that route produced was unpriced, and invoicing refuses to bill an unpriced line.
// That is the contradiction the seven sandbox records demonstrate.
//
// It existed on TWO paths — createSalesOrderFromOpportunity and the atomic closeOpportunityAsWon —
// and fixing one would have left the hole open through the route that actually runs.
//
// Every case here runs the REAL validators and mappers from the compiled lib and asserts on values.

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAgreementConvertible,
  salesOrderLinesFromAgreement,
  salesOrderFieldsFromAgreement,
} from "../lib/salesAgreement/agreementToSalesOrder.js";
import { buildCreateSalesAgreement, buildAcceptSalesAgreement } from "../lib/salesAgreement/salesAgreementCommands.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };
const OPP = { id: "opp-1", accountId: "acct-1" };

/** A real agreement, built through the real command, then accepted through the real command. */
function acceptedAgreement(lines, extra = {}) {
  const a = buildCreateSalesAgreement(
    // Company-authority correction: ACCEPT is the company gate, so a fixture that accepts must
    // carry a governed company, exactly as a real chain would (inherited from its Opportunity).
    { accountId: "acct-1", ownerEmployeeId: "emp-1", sourceOpportunityId: "opp-1", inheritedOperatingCompanyId: "taylor", lines, ...extra },
    CTX,
  );
  const accepted = buildAcceptSalesAgreement(a, CTX);
  return { ...a, ...accepted, exists: true };
}
const PRICED = [{ kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 2, unitPrice: 500000 }];
const msg = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// ═════════════════════════════════════════ preconditions, fail closed

test("an opportunity with NO agreement cannot produce a Sales Order", () => {
  // No fallback to Opportunity lines, and none to expectedValue. This is the point of putting the
  // Agreement in the middle.
  const m = msg(() => assertAgreementConvertible({ exists: false }, OPP));
  assert.match(m, /no sales agreement/i);
  assert.match(m, /forecast, not prices/i);
});

test("a DRAFT agreement cannot produce a Sales Order", () => {
  const draft = { ...acceptedAgreement(PRICED), state: "DRAFT" };
  assert.match(msg(() => assertAgreementConvertible(draft, OPP)), /has not been accepted/i);
});

test("a DECLINED agreement cannot produce a Sales Order", () => {
  const declined = { ...acceptedAgreement(PRICED), state: "DECLINED" };
  assert.match(msg(() => assertAgreementConvertible(declined, OPP)), /has not been accepted/i);
});

test("an ACCEPTED agreement passes every precondition", () => {
  assert.doesNotThrow(() => assertAgreementConvertible(acceptedAgreement(PRICED), OPP));
});

test("the agreement must belong to THIS opportunity", () => {
  const other = { ...acceptedAgreement(PRICED), sourceOpportunityId: "opp-OTHER" };
  assert.match(msg(() => assertAgreementConvertible(other, OPP)), /different opportunity/i);
});

test("the agreement's ACCOUNT must match the opportunity's", () => {
  const other = { ...acceptedAgreement(PRICED), accountId: "acct-OTHER" };
  assert.match(msg(() => assertAgreementConvertible(other, OPP)), /different customer/i);
});

test("ownership is reported BEFORE state — a caller on the wrong document is told that", () => {
  // Telling somebody an agreement is unaccepted sends them to chase a signature on a document that
  // was never theirs.
  const wrongAndDraft = { ...acceptedAgreement(PRICED), sourceOpportunityId: "opp-OTHER", state: "DRAFT" };
  assert.match(msg(() => assertAgreementConvertible(wrongAndDraft, OPP)), /different opportunity/i);
});

test("an agreement with no lines is refused", () => {
  const empty = { ...acceptedAgreement(PRICED), lines: [] };
  assert.match(msg(() => assertAgreementConvertible(empty, OPP)), /no lines/i);
});

// ═════════════════════════════════════════ value arrival

test("exact quantity and integer price survive Agreement -> Sales Order", () => {
  const lines = salesOrderLinesFromAgreement(acceptedAgreement(PRICED));
  // FIN-002: the line's reporting unit travels with its committed price.
  assert.deepEqual(lines, [{ kind: "EQUIPMENT_MODEL", ref: "C713", businessUnitId: "EQUIPMENT_SALES", orderedQty: 2, unitPrice: 500000 }]);
});

test("multiple prices survive unchanged, and a zero survives as zero", () => {
  const a = acceptedAgreement([
    { kind: "PART", ref: "A", quantity: 1, unitPrice: 1 },
    { kind: "PART", ref: "B", quantity: 3, unitPrice: 0 },
    { kind: "SERVICE", ref: "C", businessUnitId: "SERVICE", quantity: 2, unitPrice: 999999 },
  ]);
  const lines = salesOrderLinesFromAgreement(a);
  assert.deepEqual(lines.map((l) => l.unitPrice), [1, 0, 999999]);
  assert.deepEqual(lines.map((l) => l.orderedQty), [1, 3, 2]);
});

test("the committed price reaches a BUILT Sales Order, through the real order command", () => {
  // The whole chain in one assertion: agreement -> lines -> buildCreateSalesOrder. A price that
  // arrives here is a price the order will store.
  const a = acceptedAgreement(PRICED);
  const lines = salesOrderLinesFromAgreement(a);
  const so = buildCreateSalesOrder(
    // Company travels with the chain (company-authority correction): the order inherits the
    // accepted agreement's frozen company, exactly as the real conversion callables pass it.
    { accountId: "acct-1", ownerEmployeeId: "emp-1", inheritedOperatingCompanyId: a.operatingCompanyId, salesChannel: "RETAIL", lines },
    CTX,
  );
  assert.equal(so.state, "CONFIRMED");
  assert.equal(so.lines[0].unitPrice, 500000);
  assert.equal(so.lines[0].orderedQty, 2);
  assert.equal(so.currency, "USD");
});

test("expectedValue is NEVER substituted for a line price", () => {
  // An Opportunity forecast is not a commitment, and allocating it across lines would invent
  // prices nobody agreed. The agreement carries its own, and nothing here reads a forecast.
  const a = acceptedAgreement([{ kind: "PART", ref: "A", quantity: 1, unitPrice: 700 }]);
  const withForecast = { ...a, expectedValue: 999999 };
  const lines = salesOrderLinesFromAgreement(withForecast);
  assert.equal(lines[0].unitPrice, 700);
  assert.equal(lines.length, 1);
});

// ═════════════════════════════════════════ the mapping decision

test("only operationally-required facts travel to the order", () => {
  const fields = salesOrderFieldsFromAgreement({
    locationId: "loc-1", customerPO: "PO-77", specialInstructions: "Call ahead",
  });
  // Location and PO: fulfillment cannot ask the Agreement at pick time, and the PO appears on the
  // pick ticket and the invoice. specialInstructions maps to `notes`, the one commercial note with
  // an operational consumer.
  assert.deepEqual(fields, { locationId: "loc-1", customerPO: "PO-77", notes: "Call ahead" });
});

test("commercial-only terms are NOT copied onto the order", () => {
  // isLease, shipVia, fulfillmentIntent, warranty, condition, estimatedArrival and the totals stay
  // on the Agreement, reachable through sourceAgreementId. Copying them would make the order a
  // second commercial record, and the two would drift the moment either was amended.
  const fields = salesOrderFieldsFromAgreement({ locationId: null, customerPO: null, specialInstructions: null });
  assert.deepEqual(Object.keys(fields).sort(), ["customerPO", "locationId", "notes"]);
  for (const forbidden of ["isLease", "shipVia", "fulfillmentIntent", "warranty", "totals", "subtotalMinor"]) {
    assert.equal(forbidden in fields, false, `${forbidden} must not travel to the Sales Order`);
  }
});

test("absent agreement fields become undefined, so the order's own values win", () => {
  // `?? undefined` rather than null: buildCreateSalesOrder treats undefined as "not supplied", and
  // a null would overwrite a caller's real value with nothing.
  const fields = salesOrderFieldsFromAgreement({ locationId: null, customerPO: null, specialInstructions: null });
  assert.equal(fields.locationId, undefined);
  assert.equal(fields.customerPO, undefined);
  assert.equal(fields.notes, undefined);
});

// ═════════════════════════════════════════ the boundaries that must not move

test("a serialized reference cannot reach the order through the agreement", () => {
  // Blocked at agreement creation, so it can never be in the lines this conversion reads.
  assert.throws(
    () => acceptedAgreement([{ kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 1, unitPrice: 1, serialNumber: "SN-1" }]),
    (e) => e.code === "SERIALIZED_LINE_FORBIDDEN",
  );
});

test("an accepted agreement can never yield an unpriced order line", () => {
  // Acceptance already refuses unpriced lines; this is the second gate, on the path that hands
  // prices to the order.
  const smuggled = { ...acceptedAgreement(PRICED), lines: [{ lineId: "line-1", kind: "PART", ref: "X", quantity: 1, unitPrice: null }] };
  assert.match(msg(() => salesOrderLinesFromAgreement(smuggled)), /no committed price/i);
});
