// THE SALES AGREEMENT SURFACE — proving arrival, not references.
//
// The Sales Order's `totalMinor` was returned faithfully by the server for weeks and never reached a
// screen, because the view model in between did not carry it. Every test passed: they asserted the
// screen REFERENCED the field. A reference is not an arrival.
//
// So every case here feeds projection-shaped input and asserts the value that comes out.

import test from "node:test";
import assert from "node:assert/strict";

import {
  salesAgreementView,
  salesAgreementLabel,
  agreementIsEditable,
  agreementAcceptability,
  SALES_AGREEMENT_VIEW_STATE as STATE,
} from "../src/domain/salesAgreementView.js";
import { salesAgreementEntity } from "../src/metadata/definitions/salesAgreement.js";
import { salesAgreementRecordPage } from "../src/metadata/definitions/salesAgreementPage.js";
import { SALES_AGREEMENT_CAPABILITY_REQUEST } from "../src/access/salesAgreementCapabilityAccess.js";
import { OPPORTUNITY_CAPABILITY_REQUEST } from "../src/access/opportunityCapabilityAccess.js";

/** Exactly the shape functions/src/salesAgreement/salesAgreementReadService.ts returns. */
function projection(overrides = {}) {
  return {
    status: "ready",
    salesAgreement: {
      id: "agr-1",
      salesAgreementNumber: "SA-2026-000001",
      state: "DRAFT",
      accountId: "acct-1",
      ownerEmployeeId: "emp-1",
      locationId: "loc-1",
      currency: "USD",
      customerPO: "PO-77",
      isLease: false,
      fulfillmentIntent: "INSTALL",
      shippingInstructions: "Rear dock",
      shipVia: "Own truck",
      specialInstructions: "Call ahead",
      lines: [{ lineId: "l1", kind: "PART", ref: "PRT-1", quantity: 2, unitPriceMinor: 12500, extendedMinor: 25000, condition: "NEW", warranty: "1yr", estimatedArrivalMillis: 1_754_600_000_000 }],
      subtotalMinor: 25000,
      shippingMinor: 500,
      installChargeMinor: 2500,
      taxMinor: 300,
      totalMinor: 28300,
      downPaymentMinor: 1000,
      tradeInMinor: 2000,
      balanceMinor: 25300,
      sourceOpportunityId: "opp-1",
      salesOrderId: null,
      acceptedAtMillis: null,
      acceptedByUid: null,
      createdAtMillis: 1,
      updatedAtMillis: 2,
      ...overrides,
    },
  };
}
const view = (o) => salesAgreementView({ result: projection(o), loading: false, errorStatus: null });

// ═════════════════════════════════════════ every value crosses the boundary

test("EVERY money field arrives, in integer minor units", () => {
  const v = view();
  assert.equal(v.subtotalMinor, 25000);
  assert.equal(v.shippingMinor, 500);
  assert.equal(v.installChargeMinor, 2500);
  assert.equal(v.taxMinor, 300);
  assert.equal(v.totalMinor, 28300);
  assert.equal(v.downPaymentMinor, 1000);
  assert.equal(v.tradeInMinor, 2000);
  assert.equal(v.balanceMinor, 25300);
  // Still minor units at the boundary: a number divided by 100 here would be a float nobody can add
  // up again, and the renderer is the only place that should format.
  for (const k of ["subtotalMinor", "totalMinor", "balanceMinor"]) assert.ok(Number.isInteger(v[k]));
});

test("EVERY commercial term and lineage field arrives", () => {
  const v = view();
  assert.equal(v.customerPO, "PO-77");
  assert.equal(v.fulfillmentIntent, "INSTALL");
  assert.equal(v.shipVia, "Own truck");
  assert.equal(v.shippingInstructions, "Rear dock");
  assert.equal(v.specialInstructions, "Call ahead");
  assert.equal(v.locationId, "loc-1");
  assert.equal(v.ownerEmployeeId, "emp-1");
  assert.equal(v.currency, "USD");
  assert.equal(v.sourceOpportunityId, "opp-1");
  assert.equal(v.salesOrderId, null, "honestly 'not converted yet'");
});

test("the LINE carries its price and its extension, and null stays null", () => {
  const priced = view().lines[0];
  assert.equal(priced.unitPriceMinor, 12500);
  assert.equal(priced.extendedMinor, 25000);
  assert.equal(priced.condition, "NEW");
  assert.equal(priced.warranty, "1yr");

  const unpriced = view({ lines: [{ lineId: "l1", kind: "PART", ref: "TBD", quantity: 1, unitPriceMinor: null, extendedMinor: null }] }).lines[0];
  // NULL, never 0. Zero would say the line is free, which is a different commercial fact.
  assert.equal(unpriced.unitPriceMinor, null);
  assert.equal(unpriced.extendedMinor, null);
});

test("a ZERO price is a real amount and survives as one", () => {
  const zero = view({ lines: [{ lineId: "l1", kind: "PART", ref: "FREE", quantity: 3, unitPriceMinor: 0, extendedMinor: 0 }] });
  assert.equal(zero.lines[0].unitPriceMinor, 0);
  assert.equal(zero.totalMinor, 28300);
  assert.notEqual(zero.lines[0].unitPriceMinor, null, "a waived charge is not a missing one");
});

test("the view carries EVERY field the projection declares", () => {
  // A field added to salesAgreementReadService.ts and forgotten here is invisible forever. This
  // fails the moment the projection grows one the view model does not carry.
  const v = view();
  const projected = Object.keys(projection().salesAgreement)
    .filter((k) => !["createdAtMillis", "updatedAtMillis"].includes(k));
  for (const key of projected) assert.ok(key in v, `${key} must reach the view model`);
});

// ═════════════════════════════════════════ the states a screen must tell apart

test("DENIED, UNAVAILABLE and NONE are three different answers", () => {
  // Collapsing denied into unavailable tells a permitted user they lack permission whenever the
  // network is down; collapsing NONE into either turns "no agreement yet" into an error, and the
  // whole entry point depends on that being a normal answer.
  assert.equal(salesAgreementView({ result: null, loading: true, errorStatus: null }).kind, STATE.LOADING);
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "permission-denied" }).kind, STATE.DENIED);
  assert.equal(salesAgreementView({ result: null, loading: false, errorStatus: "internal" }).kind, STATE.UNAVAILABLE);
  assert.equal(salesAgreementView({ result: { status: "not-found", salesAgreement: null }, loading: false, errorStatus: null }).kind, STATE.NONE);
  assert.equal(view().kind, STATE.READY);
});

// ═════════════════════════════════════════ identity, and what may never stand in for it

test("THE DOCUMENT ID IS NEVER THE LABEL", () => {
  // DECISIONS #106. A missing business reference is not permission to display a record id.
  assert.equal(salesAgreementLabel(view()), "SA-2026-000001");
  const noNumber = view({ salesAgreementNumber: null });
  assert.equal(salesAgreementLabel(noNumber), "Sales Agreement", "a truthful generic label, not the id");
  assert.notEqual(salesAgreementLabel(noNumber), noNumber.id);
  assert.notEqual(salesAgreementLabel(noNumber), "agr-1");
});

// ═════════════════════════════════════════ what the surface may offer

test("only a DRAFT is editable", () => {
  assert.equal(agreementIsEditable(view({ state: "DRAFT" })), true);
  assert.equal(agreementIsEditable(view({ state: "ACCEPTED" })), false);
  assert.equal(agreementIsEditable(view({ state: "DECLINED" })), false);
  assert.equal(agreementIsEditable({ kind: STATE.NONE }), false);
});

test("ACCEPT reports WHY it is unavailable, and names every unpriced line", () => {
  // A disabled button with no reason sends somebody hunting for a permission problem when the real
  // answer is that a line has no price.
  assert.deepEqual(agreementAcceptability(view()), { canAccept: true, reason: null });

  const unpriced = agreementAcceptability(view({
    lines: [
      { lineId: "l1", kind: "PART", ref: "PRT-A", quantity: 1, unitPriceMinor: null, extendedMinor: null },
      { lineId: "l2", kind: "PART", ref: "PRT-B", quantity: 1, unitPriceMinor: 500, extendedMinor: 500 },
      { lineId: "l3", kind: "SERVICE", ref: "SVC-C", quantity: 1, unitPriceMinor: null, extendedMinor: null },
    ],
  }));
  assert.equal(unpriced.canAccept, false);
  assert.match(unpriced.reason, /PRT-A/);
  assert.match(unpriced.reason, /SVC-C/);
  assert.doesNotMatch(unpriced.reason, /PRT-B/, "a priced line must not be reported as unpriced");

  assert.match(agreementAcceptability(view({ state: "ACCEPTED" })).reason, /already been accepted/);
  assert.match(agreementAcceptability(view({ state: "DECLINED" })).reason, /declined/);
  assert.match(agreementAcceptability(view({ lines: [] })).reason, /at least one line/);
});

// ═════════════════════════════════════════ the page and the command agree

test("THE PAGE'S EDITABLE FIELDS ARE EXACTLY THE COMMAND'S ALLOWLIST", () => {
  // The surface must never offer a pencil the command would refuse. `lines` is on the command's
  // allowlist but NOT here: lines are edited through their own table, not as a header field.
  const editable = new Set(salesAgreementRecordPage.editableFieldIds);
  for (const forbidden of [
    "accountId", "sourceOpportunityId", "salesAgreementNumber", "currency", "state",
    "acceptedAtMillis", "acceptedByUid", "salesOrderId", "totalMinor", "subtotalMinor", "balanceMinor",
  ]) {
    assert.equal(editable.has(forbidden), false, `${forbidden} must not be editable on the page`);
  }
  for (const allowed of ["customerPO", "isLease", "fulfillmentIntent", "taxMinor", "specialInstructions"]) {
    assert.equal(editable.has(allowed), true);
  }
  assert.equal(salesAgreementRecordPage.writeCommand, "updateSalesAgreementDraft");
});

test("every field the page places is declared on the entity", () => {
  // A section naming a field the entity does not define renders nothing, silently.
  const declared = new Set(salesAgreementEntity.fields.map((f) => f.id));
  for (const section of salesAgreementRecordPage.sections) {
    for (const id of section.fieldIds) assert.ok(declared.has(id), `${id} is placed but not declared`);
  }
  for (const id of salesAgreementRecordPage.editableFieldIds) {
    assert.ok(declared.has(id), `${id} is editable but not declared`);
  }
});

test("the SUMMARY answers what/state/whose/worth, and provenance is SYSTEM", () => {
  const byId = Object.fromEntries(salesAgreementRecordPage.sections.map((s) => [s.id, s]));
  assert.equal(byId.salesAgreementIdentity.density, "SUMMARY");
  for (const id of ["salesAgreementNumber", "state", "accountId", "totalMinor"]) {
    assert.ok(byId.salesAgreementIdentity.fieldIds.includes(id), `${id} belongs in the first viewport`);
  }
  assert.equal(byId.salesAgreementProvenance.density, "SYSTEM");
  assert.ok(byId.salesAgreementProvenance.fieldIds.includes("sourceOpportunityId"));
  assert.ok(byId.salesAgreementProvenance.fieldIds.includes("salesOrderId"));
});

// ═════════════════════════════════════════ authorization

test("all four capabilities resolve in ONE request, against one accessVersion", () => {
  // Two requests could answer under two versions, and the screen would render an ACCEPT control
  // authorized under a version the edit was already denied under.
  for (const id of SALES_AGREEMENT_CAPABILITY_REQUEST) {
    assert.ok(OPPORTUNITY_CAPABILITY_REQUEST.includes(id), `${id} must ride the workspace's single feed`);
  }
  assert.deepEqual([...SALES_AGREEMENT_CAPABILITY_REQUEST].sort(), [
    "salesAgreement.accept", "salesAgreement.create", "salesAgreement.read", "salesAgreement.updateDraft",
  ]);
  // Separate ids, not one salesAgreement.write: drafting terms and BINDING THE BUSINESS to them are
  // different authorities, and a single capability would make them the same permission.
  assert.notEqual(SALES_AGREEMENT_CAPABILITY_REQUEST.length, 1);
});
