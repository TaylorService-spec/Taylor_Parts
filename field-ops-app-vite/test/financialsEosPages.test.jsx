// FINANCIALS ON EOS -- THE ACCEPTANCE RUN (Firebase exit B1, DECISIONS #B1): the Receivables, Accounts Receivable, Settlements and their
// record pages, rendered from the EOS Finance register with Firebase BLOCKED -- the Firebase finance callables (`listFinancialFacts`,
// `listAccountInvoiceAr`) and the Firestore `employees` listener are spies that fail the run if touched.
//
// What these prove: the pages render the register's own figures and relationships (invoice detail, settlements, history); a field the
// register does not carry is shown as NOT SUPPLIED and named as a model decision (never invented); a restricted reader is told it sees a
// part of the book; only declared Finance READ operations are made; and not one Firebase finance call happens.
//
// Run: npx vitest run test/financialsEosPages.test.jsx
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const fb = vi.hoisted(() => ({ callables: [], firestore: [], ops: [] }));
// The signed-in principal (hooks/useEosFinanceRead.js keys its read by it, as hooks/useAccountAr.js does).
const auth = vi.hoisted(() => ({ uid: "uid-A" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: auth.uid } }) }));

// BLOCKED: the Firebase finance callable client and the Firestore directory. Any call fails the run.
vi.mock("../src/services/financeReadCallableClient.js", () => ({
  fetchFinancialFacts: (...a) => { fb.callables.push(["listFinancialFacts", a]); throw new Error("Firebase is blocked"); },
  fetchAccountInvoiceAr: (...a) => { fb.callables.push(["listAccountInvoiceAr", a]); throw new Error("Firebase is blocked"); },
}));
vi.mock("../src/hooks/useEmployeeDirectory.js", () => ({
  useEmployeeDirectory: () => { fb.firestore.push("employees"); throw new Error("Firebase is blocked"); },
  resolveActorDisplayName: () => null,
  UNKNOWN_ACTOR_DISPLAY_NAME: "Unknown user",
}));

// The EOS Finance route: a stand-in server, recording every operation.
let api = () => ({ ok: false, code: "INTERNAL" });
vi.mock("../src/services/financeApiClient.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, callFinanceApi: async (operation, input) => { fb.ops.push([operation, input]); return api(operation, input); } };
});
vi.mock("../src/hooks/useAccountNames.js", () => ({ useAccountNames: () => new Map([["acct-t", "Harbor Grill"], ["acct-z", "Zeta Foods"]]) }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", () => ({
  useGovernedEmployeeDirectory: () => ({ byEmployeeId: new Map([["e-s1", { displayName: "Sam Seller" }]]), byUserId: new Map(), loading: false, error: null }),
}));

import FinancialsReceivablesEos from "../src/modules/financials/FinancialsReceivablesEos.jsx";
import FinancialsAccountsReceivableEos from "../src/modules/financials/FinancialsAccountsReceivableEos.jsx";
import FinancialsSettlementsEos from "../src/modules/financials/FinancialsSettlementsEos.jsx";
import FinancialsReceivableDetailEos from "../src/modules/financials/FinancialsReceivableDetailEos.jsx";
import FinancialsSettlementDetailEos from "../src/modules/financials/FinancialsSettlementDetailEos.jsx";
import { FINANCE_READ_OPERATIONS } from "../src/services/financeApiClient.js";

const row = (over = {}) => ({
  id: "obl_aaaaaaaa-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", sourceDomain: "BILLING_PACKAGE", sourceRecordId: "bp-1",
  dueOn: "2026-01-15", overdue: true, originatedMinor: "40000", settledMinor: "16000", outstandingMinor: "24000",
  counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-t", name: "Harbor Grill" }, ...over,
});
const settlement = (over = {}) => ({
  id: "stl_1", operatingCompanyId: "taylor", counterpartyId: "cp", kind: "CUSTOMER_PAYMENT", direction: "RECEIPT", amountMinor: "10000", currency: "USD",
  businessDate: "2026-10-01", recordedAt: "2026-10-01T15:00:00.000Z", sourceReference: "ACH-1001", method: "ACH", status: "RECORDED", notes: null, voidReason: null,
  replacesSettlementId: null, appliedMinor: "10000", unappliedMinor: "0", reconciliationStatus: "UNRECONCILED",
  applications: [{ id: "sap_1", obligationId: "obl_aaaaaaaa-1", amountMinor: "10000", status: "APPLIED", appliedBy: "p", appliedAt: "2026-10-01T15:00:00.000Z", reversalReason: null }],
  reconciliations: [], ...over,
});
const currencyRow = { currency: "USD", count: 1, openCount: 1, overdueCount: 1, billedMinor: "40000", collectedMinor: "16000", outstandingMinor: "24000",
  aging: { currentMinor: "0", days1to30Minor: "0", days31to60Minor: "0", days61PlusMinor: "24000", unagedMinor: "0" } };
const detail = (over = {}) => ({
  ...row(), recordedAt: "2026-03-01T00:00:00.000Z", sourceSalesOrder: { id: "so-1", salesOrderNumber: "SO-2026-000001" },
  attribution: { state: "ATTRIBUTED", creditedSalespersonEmployeeId: "e-s1", recordedAt: "2026-03-01T00:00:00.000Z" },
  facts: [
    { id: "f1", factClass: "OBLIGATION", factType: "RECEIVABLE_ORIGINATED", amountMinor: "40000", effectiveAt: "2026-03-01T00:00:00.000Z", sourceDomain: "BILLING_PACKAGE", sourceRecordId: "bp-1", reversesFactId: null, reason: null },
    { id: "f2", factClass: "SETTLEMENT", factType: "SETTLEMENT_APPLIED", amountMinor: "10000", effectiveAt: "2026-10-01T00:00:00.000Z", sourceDomain: "SETTLEMENT", sourceRecordId: "stl_1", reversesFactId: null, reason: null },
    { id: "f3", factClass: "SETTLEMENT", factType: "SETTLEMENT_REVERSED", amountMinor: "-2000", effectiveAt: "2026-10-02T00:00:00.000Z", sourceDomain: "SETTLEMENT", sourceRecordId: "stl_2", reversesFactId: "f9", reason: "applied in error" },
  ],
  applications: [{ id: "sap_1", settlementId: "stl_1", amountMinor: "10000", status: "APPLIED", settlementKind: "CUSTOMER_PAYMENT", sourceReference: "ACH-1001", businessDate: "2026-10-01" }],
  accountingHandoffs: [{ id: "h1", status: "READY_FOR_DELIVERY", payloadKind: "RECEIVABLE", providerDocumentReference: null }], ...over,
});
const access = (over = {}) => ({ principalId: "p", consolidated: true, restricted: false,
  companies: [{ operatingCompanyId: "taylor", name: "Taylor", visibility: "FULL", actions: {} }, { operatingCompanyId: "ventana", name: "Ventana", visibility: "FULL", actions: {} }], ...over });

const server = (overrides = {}) => {
  const answers = {
    readMyFinanceCompanyAccess: access(),
    readFinanceOverview: { scope: { operatingCompanyId: "consolidated", companies: ["taylor", "ventana"] }, visibility: { restricted: false }, currencies: [currencyRow], byCompany: [] },
    listObligations: { scope: "consolidated", items: [row()] },
    listSettlements: { scope: "consolidated", items: [settlement()] },
    readObligation: detail(),
    readSettlement: settlement(),
    ...overrides,
  };
  api = (op) => (op in answers ? (answers[op]?.ok === false ? answers[op] : { ok: true, operation: op, result: answers[op] }) : { ok: false, code: "UNKNOWN_OPERATION" });
};

const at = (path, routePath, element) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={element} /><Route path="*" element={<div>other page</div>} /></Routes></MemoryRouter>,
);
const settled = async (container, pattern) => { await waitFor(() => expect(container.textContent).toMatch(pattern)); return container; };

beforeEach(() => { fb.callables.length = 0; fb.firestore.length = 0; fb.ops.length = 0; });
const assertBlockedFirebaseAndReadsOnly = () => {
  expect(fb.callables).toEqual([]);
  expect(fb.firestore).toEqual([]);
  expect(fb.ops.length).toBeGreaterThan(0);
  for (const [operation] of fb.ops) expect(FINANCE_READ_OPERATIONS).toContain(operation);
};

describe("Receivables — /financials/invoices on EOS", () => {
  test("the register's records with the server's totals; invoice number, issue date and business unit NAMED as not supplied; no Firebase", async () => {
    server();
    const { container } = at("/financials/invoices", "/financials/invoices", <FinancialsReceivablesEos />);
    await settled(container, /Harbor Grill/);
    expect(screen.getAllByRole("heading", { name: "Receivables" }).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toMatch(/240\.00/); // the server's consolidated outstanding, not added here
    expect(container.textContent).toMatch(/MD-B1-1, MD-B1-2 and MD-B1-3 are named model decisions/);
    expect(container.textContent).toMatch(/Original/);
    expect(container.textContent).not.toMatch(/Invoice number: INV/);
    const link = screen.getByRole("link", { name: "AAAAAAAA" });
    expect(link.getAttribute("href")).toBe("/financials/invoices/obl_aaaaaaaa-1");
    assertBlockedFirebaseAndReadsOnly();
    // The reads are the register's: access, ONE consolidated overview, ONE consolidated receivable list.
    expect(fb.ops.map(([op, i]) => [op, i?.operatingCompanyId ?? null])).toEqual([
      ["readMyFinanceCompanyAccess", null], ["readFinanceOverview", "consolidated"], ["listObligations", "consolidated"],
    ]);
  });

  test("a restricted reader is told it sees a part of the book", async () => {
    server({ readMyFinanceCompanyAccess: access({ restricted: true }), readFinanceOverview: { currencies: [currencyRow], byCompany: [], visibility: { restricted: true } } });
    const { container } = at("/financials/invoices", "/financials/invoices", <FinancialsReceivablesEos />);
    await settled(container, /A part of the book/);
    expect(container.textContent).toMatch(/credited to you or your team/);
    assertBlockedFirebaseAndReadsOnly();
  });

  test("nothing visible at any reached company is a settled permission answer, not 'no records'", async () => {
    server({ readMyFinanceCompanyAccess: access({ restricted: true, consolidated: false, companies: [{ operatingCompanyId: "taylor", name: "Taylor", visibility: "RESTRICTED_EMPTY", actions: {} }] }) });
    const { container } = at("/financials/invoices", "/financials/invoices", <FinancialsReceivablesEos />);
    await settled(container, /refused this read for your principal/);
    expect(container.textContent).not.toMatch(/no receivable within your visibility/i);
    expect(fb.ops.map(([op]) => op)).toEqual(["readMyFinanceCompanyAccess"]);
    expect(fb.callables).toEqual([]);
  });

  test("a failed read is 'unavailable', never an empty list", async () => {
    server({ listObligations: { ok: false, code: "INTERNAL" } });
    const { container } = at("/financials/invoices", "/financials/invoices", <FinancialsReceivablesEos />);
    await settled(container, /did not return a complete result/);
    expect(screen.queryByRole("link", { name: "AAAAAAAA" })).toBeNull();
  });
});

describe("Accounts Receivable — /financials/accounts-receivable on EOS", () => {
  test("open receivables with the server's aging buckets (61+ from the register, nothing bucketed here)", async () => {
    server();
    const { container } = at("/financials/accounts-receivable", "/financials/accounts-receivable", <FinancialsAccountsReceivableEos />);
    await settled(container, /Harbor Grill/);
    expect(screen.getAllByRole("heading", { name: "Accounts Receivable" }).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toMatch(/61\+ Days/);
    expect(container.textContent).toMatch(/240\.00/);
    expect(screen.queryByText(/^DSO$/)).toBeNull();
    assertBlockedFirebaseAndReadsOnly();
  });
});

describe("Settlements — /financials/payments on EOS", () => {
  test("settlement evidence with applied / unapplied from the register; a restricted reader is told unapplied settlements are not shown", async () => {
    server({ readMyFinanceCompanyAccess: access({ restricted: true }) });
    const { container } = at("/financials/payments", "/financials/payments", <FinancialsSettlementsEos />);
    await settled(container, /ACH-1001/);
    expect(screen.getAllByRole("heading", { name: "Settlements" }).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toMatch(/Customer payment/);
    expect(container.textContent).toMatch(/unapplied settlements are not shown/);
    expect(screen.getByRole("link", { name: "ACH-1001" }).getAttribute("href")).toBe("/financials/payments/stl_1");
    assertBlockedFirebaseAndReadsOnly();
    expect(fb.ops.map(([op, i]) => [op, i?.operatingCompanyId ?? null])).toEqual([["readMyFinanceCompanyAccess", null], ["listSettlements", "consolidated"]]);
  });
});

describe("Receivable record — /financials/invoices/:invoiceId on EOS", () => {
  test("amounts, relationships (customer, Sales Order, settlement applications, handoffs) and append-only history; missing fields named; credited person by name", async () => {
    server();
    const { container } = at("/financials/invoices/obl_aaaaaaaa-1", "/financials/invoices/:invoiceId", <FinancialsReceivableDetailEos />);
    await settled(container, /Sam Seller/);
    for (const label of ["Original Amount", "Settled", "Outstanding", "Invoice Number", "Issue Date", "Business Unit", "Credited Salesperson", "Source Sales Order"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/model decision MD-B1-1/);
    expect(container.textContent).toMatch(/model decision MD-B1-2/);
    expect(container.textContent).toMatch(/model decision MD-B1-3/);
    expect(screen.getByRole("link", { name: "SO-2026-000001" }).getAttribute("href")).toBe("/customers/opportunities/sales-order/so-1");
    expect(screen.getByRole("link", { name: "Harbor Grill" }).getAttribute("href")).toBe("/customers/acct-t");
    expect(screen.getByRole("link", { name: "ACH-1001" }).getAttribute("href")).toBe("/financials/payments/stl_1");
    expect(container.textContent).toMatch(/Reverses f9/); // the correction chain keeps the original
    expect(container.textContent).toMatch(/applied in error/);
    expect(container.textContent).toMatch(/No accounting reference yet/i);
    assertBlockedFirebaseAndReadsOnly();
    expect(fb.ops.map(([op, i]) => [op, i?.obligationId ?? null])).toEqual([["readObligation", "obl_aaaaaaaa-1"]]);
  });

  test("an unattributed receivable says so and why; it never names a person", async () => {
    server({ readObligation: detail({ attribution: { state: "UNATTRIBUTED", reason: "the source Sales Order records no credited salesperson" } }) });
    const { container } = at("/financials/invoices/obl_aaaaaaaa-1", "/financials/invoices/:invoiceId", <FinancialsReceivableDetailEos />);
    await settled(container, /Not attributed — the source Sales Order records no credited salesperson/);
    expect(container.textContent).not.toMatch(/Sam Seller/);
  });

  test("a record outside the caller's reach reads exactly like a missing one", async () => {
    server({ readObligation: { ok: false, code: "NOT_FOUND" } });
    const { container } = at("/financials/invoices/obl_zzz", "/financials/invoices/:invoiceId", <FinancialsReceivableDetailEos />);
    await settled(container, /No receivable with this identifier is within your visibility/);
    expect(container.textContent).toMatch(/refused exactly like one that is absent/);
  });
});

describe("Settlement record — /financials/payments/:paymentId on EOS", () => {
  test("evidence, applications to receivables (links) and reconciliation stated", async () => {
    server();
    const { container } = at("/financials/payments/stl_1", "/financials/payments/:paymentId", <FinancialsSettlementDetailEos />);
    await settled(container, /ACH-1001/);
    expect(screen.getAllByText("Applied").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "AAAAAAAA" }).getAttribute("href")).toBe("/financials/invoices/obl_aaaaaaaa-1");
    expect(container.textContent).toMatch(/unreconciled/i);
    assertBlockedFirebaseAndReadsOnly();
  });
});

describe("principal isolation — the signed-in principal is part of the read's identity", () => {
  test("a different principal on the same mounted page gets a FRESH read and never the previous principal's answer", async () => {
    auth.uid = "uid-A";
    const elementFor = () => (
      <MemoryRouter initialEntries={["/financials/invoices"]}><Routes><Route path="/financials/invoices" element={<FinancialsReceivablesEos />} /><Route path="*" element={<div>other page</div>} /></Routes></MemoryRouter>
    );
    server({ listObligations: { scope: "consolidated", items: [row()] } });
    const view = render(elementFor());
    await settled(view.container, /Harbor Grill/);
    const readsBefore = fb.ops.length;
    // Principal B signs in on the same tab; the server's answer for B differs.
    server({ listObligations: { scope: "consolidated", items: [row({ id: "obl_bbbbbbbb-2", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-z", name: "Zeta Foods" } })] } });
    auth.uid = "uid-B";
    view.rerender(elementFor());
    await settled(view.container, /Zeta Foods/);
    expect(view.container.textContent).not.toMatch(/Harbor Grill/);
    expect(fb.ops.length, "B's page issued its own reads").toBeGreaterThan(readsBefore);
    assertBlockedFirebaseAndReadsOnly();
  });
});
