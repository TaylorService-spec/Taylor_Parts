// BOUNDED DRAFT EDITING + AGREEMENT NUMBERING.
//
// GOVERNANCE: Owner Slice 4 §E/§H.
//
// A draft is a negotiation: prices move, lines are added and dropped, the PO arrives after the
// terms do. Without an edit path the only correction for a typo is a second agreement, and the
// counter carries the scars.
//
// The danger of an edit path is that it becomes a patch endpoint. Every case here is about what
// CANNOT be reached through it.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateSalesAgreement,
  buildAcceptSalesAgreement,
  buildUpdateSalesAgreementDraft,
  SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS,
  SalesAgreementCommandError,
} from "../lib/salesAgreement/salesAgreementCommands.js";
import { formatSalesAgreementNumber, salesAgreementCounterDocId } from "../lib/salesAgreement/salesAgreementNumbering.js";
import { formatSalesOrderNumber } from "../lib/salesOrder/salesOrderNumbering.js";
import { formatOpportunityNumber } from "../lib/opportunity/opportunityNumbering.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };
const LATER = { actorUid: "uid-2", nowMillis: 1_754_699_999_999 };
const draft = (over = {}) =>
  buildCreateSalesAgreement(
    { accountId: "acct-1", ownerEmployeeId: "emp-1", sourceOpportunityId: "opp-1", inheritedOperatingCompanyId: "taylor",
      lines: [{ kind: "PART", ref: "A", quantity: 2, unitPrice: 1000 }], ...over },
    CTX,
  );
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? e.message; } };

// ═════════════════════════════════════════ numbering derives from the convention

test("the Agreement reference follows the SAME shape as every other business reference", () => {
  // XX-YYYY-######, six digits, zero-padded. Derived from the convention, not chosen: inventing a
  // different shape for the seventh object would have been the decision.
  assert.equal(formatSalesAgreementNumber(2026, 1), "SA-2026-000001");
  assert.equal(formatSalesAgreementNumber(2026, 999999), "SA-2026-999999");
  assert.match(formatSalesAgreementNumber(2026, 42), /^SA-\d{4}-\d{6}$/);
  // Same year, same sequence, DIFFERENT prefix on each object — this is what makes the reference
  // say what kind of thing it names.
  const n = 7;
  assert.equal(formatSalesAgreementNumber(2026, n), "SA-2026-000007");
  assert.equal(formatSalesOrderNumber(2026, n), "SO-2026-000007");
  assert.equal(formatOpportunityNumber(2026, n), "OPP-2026-000007");
  assert.notEqual(formatSalesAgreementNumber(2026, n), formatSalesOrderNumber(2026, n));
});

test("the counter is the Agreement's OWN, so the sequences never interact", () => {
  // A shared counter would make agreement 41 and order 42 look like a numbering bug to anyone
  // reading them side by side, and would couple two objects' identity to each other.
  assert.equal(salesAgreementCounterDocId(2026), "sales_agreements_2026");
  assert.notEqual(salesAgreementCounterDocId(2026), "sales_orders_2026");
  assert.notEqual(salesAgreementCounterDocId(2026), salesAgreementCounterDocId(2027));
});

// ═════════════════════════════════════════ what a draft edit may reach

test("the allowlist is COMMERCIAL TERMS ONLY — identity, currency, acceptance and totals are absent", () => {
  const allowed = new Set(SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS);
  for (const forbidden of [
    "accountId", "sourceOpportunityId", "salesAgreementNumber", "currency", "state",
    "acceptedAtMillis", "acceptedByUid", "totals", "salesOrderId", "createdByUid", "createdAtMillis",
  ]) {
    assert.equal(allowed.has(forbidden), false, `${forbidden} must not be editable`);
  }
  assert.ok(allowed.has("lines") && allowed.has("customerPO") && allowed.has("taxMinor"));
});

test("an unknown or forbidden field is REJECTED, never silently ignored", () => {
  // Dropping it quietly lets a caller believe they changed something they did not, and a UI built
  // on that belief ships a control that does nothing.
  for (const field of ["accountId", "state", "acceptedByUid", "totals", "salesOrderId", "nonsense"]) {
    assert.equal(
      code(() => buildUpdateSalesAgreementDraft(draft(), { [field]: "x" }, LATER)),
      "FIELD_NOT_EDITABLE",
      `${field} must be refused`,
    );
  }
});

test("a real edit changes the named field and recomputes the totals", () => {
  const d = draft();
  const patch = buildUpdateSalesAgreementDraft(d, { customerPO: "  PO-77  ", taxMinor: 300 }, LATER);
  assert.equal(patch.customerPO, "PO-77", "trimmed");
  // Totals recomputed even though only a charge moved — the balance depends on both, and a patch
  // that changed tax without re-deriving the total leaves the document inconsistent.
  assert.equal(patch.totals.taxMinor, 300);
  assert.equal(patch.totals.subtotalMinor, 2000);
  assert.equal(patch.totals.totalMinor, 2300);
  assert.equal(patch.updatedAtMillis, LATER.nowMillis);
  assert.equal(patch.updatedByUid, "uid-2");
  // A patch, not a document: the identity fields are not restated, so they cannot move.
  for (const k of ["accountId", "sourceOpportunityId", "currency", "state"]) {
    assert.equal(k in patch, false, `${k} must not appear in the patch`);
  }
});

test("charges NOT named in the edit keep their current values", () => {
  // Otherwise every edit would silently zero the charges the caller did not mention.
  const d = draft({ shippingMinor: 500, installChargeMinor: 2500 });
  const patch = buildUpdateSalesAgreementDraft(d, { taxMinor: 100 }, LATER);
  assert.equal(patch.totals.shippingMinor, 500);
  assert.equal(patch.totals.installChargeMinor, 2500);
  assert.equal(patch.totals.totalMinor, 2000 + 500 + 2500 + 100);
});

test("edited lines run through the SAME validator the create path uses", () => {
  // A laxer rule on the edit path is how a serialized reference or a fractional price reaches a
  // document the create path would have refused — and the laxer one always wins, because it is the
  // one on the path that runs.
  const d = draft();
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "A", quantity: 1, unitPrice: 12.5 }] }, LATER)), "MONEY_INVALID");
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "A", quantity: 0, unitPrice: 1 }] }, LATER)), "QTY_INVALID");
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", quantity: 1, unitPrice: 1, serialNumber: "SN-1" }] }, LATER)), "SERIALIZED_LINE_FORBIDDEN");
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { lines: [] }, LATER)), "NO_LINES");
});

test("an explicit ZERO price survives an edit, and an absent one stays absent", () => {
  const d = draft();
  const zero = buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "FREE", quantity: 3, unitPrice: 0 }] }, LATER);
  assert.equal(zero.lines[0].unitPrice, 0, "a waived charge is a real commercial act");
  assert.equal(zero.totals.subtotalMinor, 0);

  const absent = buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "TBD", quantity: 1 }] }, LATER);
  assert.equal(absent.lines[0].unitPrice, null, "NULL, never 0 — zero would say the line is free");
  assert.equal(absent.totals.totalMinor, null, "and an unpriced line has no total");
});

test("clearing an optional field is a real edit, distinct from not mentioning it", () => {
  const d = draft({ customerPO: "PO-1", fulfillmentIntent: "INSTALL" });
  const cleared = buildUpdateSalesAgreementDraft(d, { customerPO: null, fulfillmentIntent: null }, LATER);
  assert.equal(cleared.customerPO, null);
  assert.equal(cleared.fulfillmentIntent, null);
  const untouched = buildUpdateSalesAgreementDraft(d, { taxMinor: 1 }, LATER);
  assert.equal("customerPO" in untouched, false, "not mentioned means not written");
});

test("isLease and fulfillmentIntent are closed vocabularies on the edit path too", () => {
  const d = draft();
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { isLease: "yes" }, LATER)), "INTENT_INVALID");
  assert.equal(code(() => buildUpdateSalesAgreementDraft(d, { fulfillmentIntent: "SHIP_MAYBE" }, LATER)), "INTENT_INVALID");
  assert.equal(buildUpdateSalesAgreementDraft(d, { isLease: true }, LATER).isLease, true);
  assert.equal(buildUpdateSalesAgreementDraft(d, { fulfillmentIntent: "BOTH" }, LATER).fulfillmentIntent, "BOTH");
});

// ═════════════════════════════════════════ the boundary that must not move

test("AN ACCEPTED AGREEMENT CANNOT BE EDITED — the prices a Sales Order used cannot move", () => {
  const d = draft();
  const accepted = { ...d, ...buildAcceptSalesAgreement(d, CTX) };
  const err = (() => { try { buildUpdateSalesAgreementDraft(accepted, { taxMinor: 1 }, LATER); return null; } catch (e) { return e; } })();
  assert.ok(err instanceof SalesAgreementCommandError);
  assert.equal(err.code, "ILLEGAL_TRANSITION");
  assert.match(err.message, /ACCEPTED/);
  // Even an edit that changes nothing commercially is refused: amendment is a new commercial
  // conversation, and modelling it means versioning, which is its own decision.
  assert.equal(code(() => buildUpdateSalesAgreementDraft(accepted, { customerPO: "PO-9" }, LATER)), "ILLEGAL_TRANSITION");
});

test("a DECLINED agreement cannot be edited back into life", () => {
  assert.equal(code(() => buildUpdateSalesAgreementDraft({ ...draft(), state: "DECLINED" }, { taxMinor: 1 }, LATER)), "ILLEGAL_TRANSITION");
});

test("an edited draft still has to pass the acceptance gate", () => {
  // Editing is not a way around pricing completeness: the gate lives on ACCEPT, and an edit that
  // removes a price makes the agreement unacceptable again.
  const d = draft();
  const patch = buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "TBD", quantity: 1 }] }, LATER);
  assert.equal(code(() => buildAcceptSalesAgreement({ state: "DRAFT", operatingCompanyId: d.operatingCompanyId, lines: patch.lines }, LATER)), "UNPRICED_LINE");
  const repriced = buildUpdateSalesAgreementDraft(d, { lines: [{ kind: "PART", ref: "TBD", quantity: 1, unitPrice: 900 }] }, LATER);
  assert.doesNotThrow(() => buildAcceptSalesAgreement({ state: "DRAFT", operatingCompanyId: d.operatingCompanyId, lines: repriced.lines }, LATER));
});
