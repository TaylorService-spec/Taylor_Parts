// FINANCIALS NORTH STAR P1 — Wave UX-1 composition tests (pages 01/03/04/05/07).
//
// What these prove, per the run's page-level contracts:
//   * every approved slot is present with its fact-class label;
//   * absent authority renders its honest sentence — never a zero, never a specimen number;
//   * DENIED renders as an explicit permission fact (page 07 composes the real AR section);
//   * no mutating action the authority doesn't govern (no New Invoice on the collection);
//   * future payment behavior (unapplied cash) is labelled FUTURE AUTHORITY, not enabled;
//   * the domain module's honest-state tokens stay in parity with HonestState's ids.
//
// Run: npx vitest run test/financialsUxLifecycle.test.jsx   (also `npm test`)
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const searchState = { state: "IDLE", results: [], truncated: false, message: null };
vi.mock("../src/hooks/useAccountSearch", () => ({
  useAccountSearch: () => searchState,
}));

const arState = { loading: false, errorStatus: "denied", result: null };
vi.mock("../src/hooks/useAccountAr.js", () => ({
  useAccountAr: () => arState,
}));

import FinancialsOverview from "../src/modules/financials/FinancialsOverview.jsx";
import FinancialsInvoices from "../src/modules/financials/FinancialsInvoices.jsx";
import FinancialsAccountsReceivable from "../src/modules/financials/FinancialsAccountsReceivable.jsx";
import FinancialsPayments from "../src/modules/financials/FinancialsPayments.jsx";
import FinancialsCustomerFinancials from "../src/modules/financials/FinancialsCustomerFinancials.jsx";
import { HONEST_STATE } from "../src/shared/ui/HonestState.jsx";

const mount = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("honest-state token parity", () => {
  test("domain module tokens are real HonestState ids", () => {
    for (const token of ["LOADING", "DENIED", "UNAVAILABLE", "NOT_ENABLED"]) {
      expect(HONEST_STATE[token]).toBe(token);
    }
  });
});

describe("01 Overview — /financials", () => {
  test("six lifecycle slots, fact classes, honest absences, no dollar figures", () => {
    const { container } = mount(<FinancialsOverview />);
    for (const label of ["Booked", "Billable now", "Billed", "Collected", "A/R outstanding", "Unbilled"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The one derived figure says so; the rest are operational actuals.
    expect(screen.getByText("Derived · booked − billed")).toBeTruthy();
    expect(screen.getAllByText("Operational actual").length).toBeGreaterThanOrEqual(5);
    // Absence is words, never numbers: no dollar amount exists anywhere on the page.
    expect(container.textContent).not.toMatch(/\$\d/);
    // Custody sentence and the margin truth band.
    expect(container.textContent).toMatch(/Not the general ledger/);
    expect(container.textContent).toMatch(/Gross margin cannot be reported yet/);
    // Forecast method stays a policy absence.
    expect(container.textContent).toMatch(/Method TBD — FIN-005/);
    // Reconciliation absence is stated, not zeroed.
    expect(container.textContent).toMatch(/No accounting authority/);
  });

  test("company filter carries the governed grammar: Consolidated / Taylor / Ventana", () => {
    mount(<FinancialsOverview />);
    for (const label of ["Consolidated", "Taylor", "Ventana"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("03 Invoices — /financials/invoices", () => {
  test("collection composition with NO New Invoice action and an honest dormant body", () => {
    const { container } = mount(<FinancialsInvoices />);
    // No issuance control exists — issuance is Billing Queue-owned. (The annotation copy
    // may SAY "no New Invoice action"; what must not exist is the control itself.)
    expect(screen.queryByRole("button", { name: /new invoice/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /new invoice/i })).toBeNull();
    // The approved column grammar is present even while the read is dormant.
    for (const col of ["Invoice", "Customer", "Issued", "Due", "Total", "Applied", "Outstanding", "Status"]) {
      expect(screen.getAllByText(col, { exact: false }).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/No governed read surface/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("04 Accounts Receivable — /financials/accounts-receivable", () => {
  test("one aging grammar, no DSO, no risk score, honest body", () => {
    const { container } = mount(<FinancialsAccountsReceivable />);
    for (const bucket of ["Total A/R", "Current", "1–30 days", "31–60 days", "61+ days"]) {
      expect(screen.getByText(bucket)).toBeTruthy();
    }
    // No DSO figure and no risk-score column exist (the annotation SAYS they have no
    // authority; what must not exist is a rendered figure or column header).
    expect(screen.queryByText(/^DSO$/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /risk/i })).toBeNull();
    expect(container.textContent).toMatch(/not activated/i);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("05 Payments — /financials/payments", () => {
  test("unapplied cash is FUTURE AUTHORITY — visible, labelled, not operational", () => {
    const { container } = mount(<FinancialsPayments />);
    expect(container.textContent).toMatch(/FUTURE AUTHORITY/);
    expect(container.textContent).toMatch(/refuses over-application/);
    // The approved view grammar stays.
    for (const label of ["All", "Unapplied", "Fully applied"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    // No apply/record action is wired — no governed command is activated.
    expect(container.querySelector("button.fin-apply")).toBeNull();
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("07 Customer Financials — /financials/customer-financials", () => {
  test("idle: nothing fetched until a customer is chosen", () => {
    searchState.state = "IDLE";
    searchState.results = [];
    const { container } = mount(<FinancialsCustomerFinancials />);
    expect(container.textContent).toMatch(/Nothing is fetched until a customer is chosen/);
  });

  test("selection composes the real governed AR read; DENIED renders as a permission fact", () => {
    searchState.state = "READY";
    searchState.results = [{ id: "acct-1", name: "Canyon Foods" }];
    arState.errorStatus = "denied";
    const { container } = mount(<FinancialsCustomerFinancials />);
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "Can" } });
    fireEvent.click(screen.getByRole("button", { name: "Canyon Foods" }));
    // Identity links to the owning Account record, never restates it.
    expect(screen.getByText("Account record →")).toBeTruthy();
    // The composed AR section renders its own denied sentence — a permission fact, no zeros.
    expect(container.textContent).toMatch(/Not available to you/);
    expect(container.textContent).not.toMatch(/\$\d/);
    // Summary slots keep their places with honest absences.
    expect(screen.getAllByText("Read not activated").length).toBeGreaterThanOrEqual(3);
  });
});
