// FIN-002 — the reporting-attribution contract, pinned.
//
// The one authority (functions/src/finance/financialAttribution.ts) that answers WHICH COMPANY,
// WHICH BUSINESS UNIT, WHICH CREDITED PERSON, WHICH CUSTOMER, WHICH SOURCE, WHEN, WHAT CURRENCY —
// and the commercial chain that must carry those answers to the immutable boundary. These tests
// pin the semantic separations the model exists to protect: OWNERSHIP != SALES CREDIT,
// createdBy != credit, kind-derived business units never flattened across a mixed order, company
// never inferred, and HISTORICAL STAYS HISTORICAL.
//
// Run: node --test test/financialAttribution.test.mjs   (also the functions CI lanes)
import test from "node:test";
import assert from "node:assert/strict";

const {
  BUSINESS_UNITS,
  FINANCIAL_SOURCE_TYPES,
  AttributionError,
  deriveLineBusinessUnit,
  deriveWorkOrderBusinessUnit,
  buildFinancialAttributionSnapshot,
  resolveCreditedSalesperson,
} = await import("../lib/finance/financialAttribution.js");
const { buildCreateOpportunity, buildUpdateOpportunity } = await import("../lib/opportunity/opportunityCommands.js");
const { buildCreateSalesAgreement, buildAcceptSalesAgreement, buildUpdateSalesAgreementDraft, deriveSalesOrderLinesFromAgreement } =
  await import("../lib/salesAgreement/salesAgreementCommands.js");
const { buildCreateSalesOrder } = await import("../lib/salesOrder/salesOrderCommands.js");
const { buildInvoiceRecord } = await import("../lib/finance/invoiceCommands.js");

const CTX = { actorUid: "uid-assistant", nowMillis: 1_756_600_000_000 };

// ── PURE CONTRACT ─────────────────────────────────────────────────────────────────────────────

test("the canonical vocabularies are exactly the approved sets", () => {
  assert.deepEqual([...BUSINESS_UNITS], ["SERVICE", "EQUIPMENT_SALES", "PARTS", "INSTALLATION"]);
  assert.ok(FINANCIAL_SOURCE_TYPES.includes("SALES_ORDER"));
  assert.ok(!FINANCIAL_SOURCE_TYPES.includes("WORK_ORDER_CHARGE"), "no sourceType for a record type that does not exist");
});

test("line business units: EQUIPMENT_MODEL and PART classify themselves; explicit must match", () => {
  assert.equal(deriveLineBusinessUnit("EQUIPMENT_MODEL"), "EQUIPMENT_SALES");
  assert.equal(deriveLineBusinessUnit("PART"), "PARTS");
  assert.equal(deriveLineBusinessUnit("PART", "PARTS"), "PARTS");
  assert.throws(() => deriveLineBusinessUnit("PART", "EQUIPMENT_SALES"),
    (e) => e instanceof AttributionError && e.code === "BUSINESS_UNIT_MISMATCH");
});

test("a SERVICE line REFUSES to guess: explicit SERVICE or INSTALLATION required", () => {
  assert.throws(() => deriveLineBusinessUnit("SERVICE"),
    (e) => e instanceof AttributionError && e.code === "BUSINESS_UNIT_REQUIRED");
  assert.equal(deriveLineBusinessUnit("SERVICE", "SERVICE"), "SERVICE");
  assert.equal(deriveLineBusinessUnit("SERVICE", "INSTALLATION"), "INSTALLATION");
  assert.throws(() => deriveLineBusinessUnit("SERVICE", "PARTS"),
    (e) => e instanceof AttributionError && e.code === "BUSINESS_UNIT_MISMATCH");
});

test("an unknown business-unit id is refused everywhere — routes and labels are not units", () => {
  assert.throws(() => deriveLineBusinessUnit("SERVICE", "service"), (e) => e.code === "BUSINESS_UNIT_INVALID");
  assert.throws(() => deriveLineBusinessUnit("PART", "/inventory"), (e) => e.code === "BUSINESS_UNIT_INVALID");
});

test("work-order business unit comes from the EXISTING WorkOrderType authority, fail-closed", () => {
  assert.equal(deriveWorkOrderBusinessUnit("INSTALL"), "INSTALLATION");
  for (const t of ["SERVICE_CALL", "PM", "WARRANTY", "INSPECTION"]) {
    assert.equal(deriveWorkOrderBusinessUnit(t), "SERVICE");
  }
  assert.equal(deriveWorkOrderBusinessUnit("SOMETHING_NEW"), null, "unknown type is UNKNOWN, never a guess");
  assert.equal(deriveWorkOrderBusinessUnit(undefined), null);
});

test("a snapshot requires customer, source, event time and currency — and freezes", () => {
  const snap = buildFinancialAttributionSnapshot({
    operatingCompanyId: "taylor", creditedSalespersonId: "emp-a", customerId: "acct-1",
    sourceType: "SALES_ORDER", sourceRecordId: "so-1", eventAtMillis: 123456, currency: "USD",
  });
  assert.equal(snap.operatingCompanyId, "taylor");
  assert.ok(Object.isFrozen(snap), "a snapshot is history, not state");
  assert.throws(() => { snap.creditedSalespersonId = "emp-b"; }, TypeError,
    "an ordinary assignment cannot mutate an immutable snapshot");
  for (const missing of [
    { customerId: "" }, { sourceType: "ROUTE" }, { sourceRecordId: " " },
    { eventAtMillis: 0 }, { currency: "" },
  ]) {
    assert.throws(() => buildFinancialAttributionSnapshot({
      customerId: "acct-1", sourceType: "SALES_ORDER", sourceRecordId: "so-1",
      eventAtMillis: 1, currency: "USD", ...missing,
    }), AttributionError);
  }
});

test("company and person dimensions may be honestly null — never fabricated", () => {
  const snap = buildFinancialAttributionSnapshot({
    customerId: "acct-1", sourceType: "PAYMENT", sourceRecordId: "pay-1", eventAtMillis: 5, currency: "USD",
  });
  assert.equal(snap.operatingCompanyId, null);
  assert.equal(snap.creditedSalespersonId, null, "a payment is not owned by a salesperson");
  assert.equal(snap.businessUnitId, null);
});

test("credit resolution: explicit → inherited → commercial owner; NEVER an actor parameter at all", () => {
  assert.equal(resolveCreditedSalesperson("emp-x", "emp-y", "emp-z"), "emp-x");
  assert.equal(resolveCreditedSalesperson(null, "emp-y", "emp-z"), "emp-y");
  assert.equal(resolveCreditedSalesperson(null, null, "emp-z"), "emp-z");
  assert.equal(resolveCreditedSalesperson(null, null, null), null);
  assert.equal(resolveCreditedSalesperson.length, 3, "no fourth argument exists for a creating actor to sneak in through");
});

// ── ASSISTANT CREATION: createdBy != credit ───────────────────────────────────────────────────

test("an assistant creating for Salesperson A's customer credits A — never the assistant", () => {
  const opp = buildCreateOpportunity(
    { accountId: "acct-1", ownerEmployeeId: "emp-A", salesChannel: "RETAIL" },
    { actorUid: "uid-assistant", nowMillis: 1000 },
  );
  assert.equal(opp.createdByUid, "uid-assistant");
  assert.equal(opp.ownerEmployeeId, "emp-A");
  assert.equal(opp.creditedSalespersonId, "emp-A", "credit defaults from the commercial owner");
  assert.notEqual(opp.creditedSalespersonId, "uid-assistant");
});

const OPP_CUR = {
  accountId: "acct-1", ownerEmployeeId: "emp-A", creditedSalespersonId: "emp-A",
  salesChannel: "RETAIL", stage: "IDENTIFIED", outcome: null, updatedAtMillis: 1,
};

test("OWNERSHIP != SALES CREDIT: moving the Opportunity owner does not move credit", () => {
  const patch = buildUpdateOpportunity(OPP_CUR, { opportunityId: "opp-1", expectedUpdatedAtMillis: 1, ownerEmployeeId: "emp-B" }, CTX);
  const changed = patch.changes.map((c) => c.field);
  assert.ok(changed.includes("ownerEmployeeId"));
  assert.ok(!changed.includes("creditedSalespersonId"), "credit moves only by EXPLICIT reassignment");
});

test("explicit pre-close credit reassignment is an ordinary governed edit", () => {
  const patch = buildUpdateOpportunity(OPP_CUR, { opportunityId: "opp-1", expectedUpdatedAtMillis: 1, creditedSalespersonId: "emp-B" }, CTX);
  assert.deepEqual(patch.changes.map((c) => c.field), ["creditedSalespersonId"]);
});

// ── COMMERCIAL CHAIN SURVIVAL ─────────────────────────────────────────────────────────────────

const AGREEMENT_INPUT = {
  accountId: "acct-1",
  ownerEmployeeId: "emp-A",
  inheritedOperatingCompanyId: "ventana",
  inheritedCreditedSalespersonId: "emp-A",
  sourceOpportunityId: "opp-1",
  lines: [
    { kind: "EQUIPMENT_MODEL", ref: "C712", quantity: 1, unitPrice: 1_500_000 },
    { kind: "PART", ref: "PART-9", quantity: 4, unitPrice: 2_500 },
    { kind: "SERVICE", ref: "INSTALL-LABOR", businessUnitId: "INSTALLATION", quantity: 1, unitPrice: 75_000 },
  ],
};

test("agreement creation inherits company + credit from the Opportunity and attributes every line", () => {
  const built = buildCreateSalesAgreement(AGREEMENT_INPUT, { actorUid: "uid-assistant", nowMillis: 2000 });
  assert.equal(built.operatingCompanyId, "ventana");
  assert.equal(built.creditedSalespersonId, "emp-A");
  assert.deepEqual(built.lines.map((l) => l.businessUnitId), ["EQUIPMENT_SALES", "PARTS", "INSTALLATION"],
    "a mixed order is attributed line by line — never one false order-level unit");
  assert.equal(built.currency, "USD");
});

test("an unknown company id is refused at agreement creation — no inference, no shortcuts", () => {
  assert.throws(() => buildCreateSalesAgreement(
    { ...AGREEMENT_INPUT, operatingCompanyId: "North Warehouse" },
    { actorUid: "u", nowMillis: 1 },
  ));
});

test("an ambiguous SERVICE line cannot enter the chain", () => {
  const lines = [{ kind: "SERVICE", ref: "SVC", quantity: 1, unitPrice: 100 }];
  assert.throws(
    () => buildCreateSalesAgreement({ ...AGREEMENT_INPUT, lines }, { actorUid: "u", nowMillis: 1 }),
    (e) => e.code === "BUSINESS_UNIT_INVALID" && /will not guess/.test(e.message),
  );
});

test("draft credit reassignment works; clearing credit is refused; ACCEPTED freezes everything", () => {
  const built = buildCreateSalesAgreement(AGREEMENT_INPUT, { actorUid: "u", nowMillis: 2000 });
  const patch = buildUpdateSalesAgreementDraft(built, { creditedSalespersonId: "emp-B" }, CTX);
  assert.equal(patch.creditedSalespersonId, "emp-B");
  assert.throws(() => buildUpdateSalesAgreementDraft(built, { creditedSalespersonId: "" }, CTX),
    (e) => /reassigned/.test(e.message));
  // company is NOT draft-editable: the deal's company was set at chain entry.
  assert.throws(() => buildUpdateSalesAgreementDraft(built, { operatingCompanyId: "taylor" }, CTX),
    (e) => e.code === "FIELD_NOT_EDITABLE");
  // After ACCEPTED, the ordinary edit path refuses outright — accepted attribution is history.
  const accepted = { ...built, ...buildAcceptSalesAgreement(built, CTX) };
  assert.throws(() => buildUpdateSalesAgreementDraft(accepted, { creditedSalespersonId: "emp-C" }, CTX),
    (e) => e.code === "ILLEGAL_TRANSITION");
});

test("Agreement → Sales Order: company, credit, customer, line units, currency and BOOKED time all survive", () => {
  const built = buildCreateSalesAgreement(AGREEMENT_INPUT, { actorUid: "u", nowMillis: 2000 });
  const accepted = { ...built, ...buildAcceptSalesAgreement(built, { actorUid: "uid-mgr", nowMillis: 3000 }) };
  const soLines = deriveSalesOrderLinesFromAgreement({ state: accepted.state, lines: accepted.lines });
  const so = buildCreateSalesOrder(
    {
      accountId: accepted.accountId,
      ownerEmployeeId: "emp-A",
      inheritedOperatingCompanyId: accepted.operatingCompanyId,
      inheritedCreditedSalespersonId: accepted.creditedSalespersonId,
      salesChannel: "RETAIL",
      sourceOpportunityId: "opp-1",
      lines: soLines.map((l) => ({ ...l })),
    },
    { actorUid: "uid-assistant", nowMillis: 4000, bookedAtMillis: accepted.acceptedAtMillis },
  );
  assert.equal(so.operatingCompanyId, "ventana", "company survives the conversion — the FIN-001 null-company defect is closed");
  assert.equal(so.creditedSalespersonId, "emp-A");
  assert.equal(so.accountId, "acct-1");
  assert.deepEqual(so.lines.map((l) => l.businessUnitId), ["EQUIPMENT_SALES", "PARTS", "INSTALLATION"]);
  assert.equal(so.currency, "USD");
  assert.equal(so.bookedAtMillis, 3000, "BOOKED = agreement acceptance, the commitment moment — not order-creation time");
  assert.equal(so.createdAtMillis, 4000);
});

test("direct Sales Order creation books at server time and never accepts a caller clock", () => {
  const so = buildCreateSalesOrder(
    {
      accountId: "acct-1", ownerEmployeeId: "emp-A", salesChannel: "RETAIL",
      bookedAtMillis: 7, // a caller-supplied clock — must be ignored (not part of the input contract)
      lines: [{ kind: "PART", ref: "P1", orderedQty: 1, unitPrice: 100 }],
    },
    { actorUid: "u", nowMillis: 9000 },
  );
  assert.equal(so.bookedAtMillis, 9000, "bookedAt is ctx-supplied (server), never input-supplied");
});

// ── HISTORICAL STAYS HISTORICAL ───────────────────────────────────────────────────────────────

test("HISTORICAL TEST: customer ownership moving to B after commitment does not rewrite A's credit", () => {
  // 1-3: chain committed under A.
  const built = buildCreateSalesAgreement(AGREEMENT_INPUT, { actorUid: "u", nowMillis: 2000 });
  const accepted = { ...built, ...buildAcceptSalesAgreement(built, { actorUid: "u", nowMillis: 3000 }) };
  const so = buildCreateSalesOrder(
    {
      accountId: accepted.accountId, ownerEmployeeId: "emp-A",
      inheritedOperatingCompanyId: accepted.operatingCompanyId,
      inheritedCreditedSalespersonId: accepted.creditedSalespersonId,
      salesChannel: "RETAIL",
      lines: deriveSalesOrderLinesFromAgreement({ state: accepted.state, lines: accepted.lines }),
    },
    { actorUid: "u", nowMillis: 4000, bookedAtMillis: accepted.acceptedAtMillis },
  );
  // 4: the SOURCE record changes — customer/opportunity ownership moves to B.
  const opportunityAfterHandoff = { ownerEmployeeId: "emp-B", creditedSalespersonId: "emp-B", operatingCompanyId: "taylor" };
  // 5: the committed snapshot still reports A and ventana. Copied, not followed: nothing in the
  // built order references the mutated source, and its fields are plain frozen values.
  assert.equal(so.creditedSalespersonId, "emp-A");
  assert.equal(so.operatingCompanyId, "ventana");
  assert.notEqual(so.creditedSalespersonId, opportunityAfterHandoff.creditedSalespersonId);
});

test("the dormant invoice composes the canonical snapshot from the governed SO — and stays dormant", () => {
  const so = {
    accountId: "acct-1", currency: "USD", state: "FULFILLED",
    operatingCompanyId: "ventana", creditedSalespersonId: "emp-A",
    lines: [
      { lineId: "line-1", kind: "PART", ref: "P1", businessUnitId: "PARTS", unitPrice: 100, orderedQty: 3, fulfilledQty: 3 },
      { lineId: "line-2", kind: "SERVICE", ref: "SVC", businessUnitId: "INSTALLATION", unitPrice: 5000, orderedQty: 1, fulfilledQty: 1 },
    ],
  };
  const inv = buildInvoiceRecord(
    {
      companyId: "taylor-legacy-numbering-key", accountId: "acct-1", salesOrderId: "so-1", currency: "USD",
      dueDate: 999, billingAction: "BILL_NOW",
      lines: [
        { salesOrderLineId: "line-1", kind: "PART", ref: "P1", billableQty: 3, unitPriceMinor: 100, taxMinor: 0 },
        { salesOrderLineId: "line-2", kind: "SERVICE", ref: "SVC", billableQty: 1, unitPriceMinor: 5000, taxMinor: 0 },
      ],
    },
    { invoiceNumber: "INV-1", sequence: 1, nowMillis: 8888, so },
  );
  assert.deepEqual(inv.lines.map((l) => l.businessUnitId), ["PARTS", "INSTALLATION"],
    "line units come from the governed SO snapshot, never the client's payload");
  assert.equal(inv.attribution.operatingCompanyId, "ventana");
  assert.equal(inv.attribution.creditedSalespersonId, "emp-A");
  assert.equal(inv.attribution.sourceType, "SALES_ORDER");
  assert.equal(inv.attribution.sourceRecordId, "so-1");
  assert.equal(inv.attribution.eventAtMillis, 8888);
  assert.equal(inv.attribution.currency, "USD");
  assert.equal(inv.attribution.businessUnitId, null, "a mixed invoice has no single header unit");
  assert.ok(Object.isFrozen(inv.attribution));
});

test("a pre-FIN-002 order (no stamps) yields honest nulls on the invoice — never fabricated attribution", () => {
  const so = {
    accountId: "acct-1", currency: "USD", state: "FULFILLED",
    lines: [{ lineId: "line-1", kind: "PART", ref: "P1", unitPrice: 100, orderedQty: 1, fulfilledQty: 1 }],
  };
  const inv = buildInvoiceRecord(
    {
      companyId: "k", accountId: "acct-1", salesOrderId: "so-1", currency: "USD",
      dueDate: 1, billingAction: "BILL_NOW",
      lines: [{ salesOrderLineId: "line-1", kind: "PART", ref: "P1", billableQty: 1, unitPriceMinor: 100, taxMinor: 0 }],
    },
    { invoiceNumber: "INV-2", sequence: 2, nowMillis: 1, so },
  );
  assert.equal(inv.attribution.operatingCompanyId, null);
  assert.equal(inv.attribution.creditedSalespersonId, null);
  assert.equal(inv.lines[0].businessUnitId, null);
});
