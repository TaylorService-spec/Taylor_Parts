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
import FinancialsBillingQueue from "../src/modules/financials/FinancialsBillingQueue.jsx";
import FinancialsCreditsAdjustments from "../src/modules/financials/FinancialsCreditsAdjustments.jsx";
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
    expect(container.textContent).toMatch(/not the general ledger/i);
    // F4: the custody sentence is said ONCE — the frame line must not be repeated verbatim
    // by the page description directly above it.
    expect(container.textContent.match(/not the general ledger/gi).length).toBe(1);
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
    expect(container.textContent).toMatch(/does not issue its own governed read/);
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
    expect(screen.getAllByText("No read on this surface").length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Wave UX-2 — billing / corrections ───

describe("02 Billing Queue — /financials/billing-queue", () => {
  test("gated bulk action disabled, with a reason that does not assert capability state", () => {
    const { container } = mount(<FinancialsBillingQueue />);
    const action = screen.getByRole("button", { name: "Create invoices" });
    expect(action.disabled).toBe(true);
    expect(container.textContent).toMatch(/wired to this queue/);
    // F1: the one-liner must not diagnose a capability the page never resolved.
    expect(container.textContent).not.toMatch(/finance\.[a-z.]+\s*(is\s+)?inactive/i);
    // The approved queue grammar: views with the four states, readiness columns.
    for (const label of ["Eligible", "Blocked", "Partially invoiced", "All"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    for (const col of ["Source", "Responsible", "Eligibility", "Invoice state"]) {
      expect(screen.getAllByText(col, { exact: false }).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/never inferred from Work Order COMPLETE/i);
    expect(container.textContent).toMatch(/No governed read surface/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("06 Credits & Adjustments — /financials/credits-adjustments", () => {
  test("invariant sentence visible; New correction disabled with policy truth; declined never hidden", () => {
    const { container } = mount(<FinancialsCreditsAdjustments />);
    expect(container.textContent).toMatch(/Corrections create new governed events\. The original event remains history\./);
    const action = screen.getByRole("button", { name: "New correction" });
    expect(action.disabled).toBe(true);
    expect(container.textContent).toMatch(/approval policy not configured/i);
    for (const label of ["Credit", "Adjustment", "Refund", "Write-off", "Awaiting approval", "Approved", "Declined"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/No governed read surface/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

// ─── Wave UX-3 — plan / forecast ───

describe("08 Sales to Goal — /financials/sales-to-goal", () => {
  test("basis grammar, no total row, honest attainment body", async () => {
    const { default: FinancialsSalesToGoal } = await import("../src/modules/financials/FinancialsSalesToGoal.jsx");
    const { container } = mount(<FinancialsSalesToGoal />);
    expect(container.textContent).toMatch(/never summed or compared silently/);
    for (const basis of ["Booked", "Billed", "Collected", "Revenue", "Gross margin"]) {
      expect(screen.getAllByText(basis).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/deliberately no single total/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("09 Cost to Budget — /financials/cost-to-budget", () => {
  test("reserved columns with the cost truth band; never zero-filled", async () => {
    const { default: FinancialsCostToBudget } = await import("../src/modules/financials/FinancialsCostToBudget.jsx");
    const { container } = mount(<FinancialsCostToBudget />);
    expect(container.textContent).toMatch(/Cost actuals are not yet governed/);
    expect(container.textContent).toMatch(/FIN-BLOCK-003/);
    for (const col of ["Category", "Budget", "Actual", "Variance", "Remaining"]) {
      expect(screen.getAllByText(col, { exact: false }).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("10 Forecasting — /financials/forecasting", () => {
  test("method stays TBD; no version fabricated; expectedValue never promoted", async () => {
    const { default: FinancialsForecasting } = await import("../src/modules/financials/FinancialsForecasting.jsx");
    const { container } = mount(<FinancialsForecasting />);
    expect(container.textContent).toMatch(/Method TBD — FIN-005/);
    expect(container.textContent).toMatch(/no governed forecast version exists/i);
    expect(container.textContent).toMatch(/never passed through as forecast revenue/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("12 Budget Management — /financials/budgets", () => {
  test("versioned grammar; New budget disabled with policy truth", async () => {
    const { default: FinancialsBudgets } = await import("../src/modules/financials/FinancialsBudgets.jsx");
    const { container } = mount(<FinancialsBudgets />);
    expect(screen.getByRole("button", { name: "New budget" }).disabled).toBe(true);
    expect(container.textContent).toMatch(/approval policy not configured/i);
    for (const label of ["Active budgets", "Awaiting approval", "Superseded", "Draft"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/never rewritten/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("13 Goal Management — /financials/goals", () => {
  test("basis chips unmissable; New goal disabled with policy truth", async () => {
    const { default: FinancialsGoals } = await import("../src/modules/financials/FinancialsGoals.jsx");
    const { container } = mount(<FinancialsGoals />);
    expect(screen.getByRole("button", { name: "New goal" }).disabled).toBe(true);
    for (const basis of ["Booked", "Billed", "Collected", "Revenue", "Gross margin"]) {
      expect(screen.getAllByText(basis).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/explicit measurement basis/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

// ─── Wave UX-4 — performance ───

describe("11 Gross Margin & Profitability — /financials/profitability", () => {
  test("the truthful unavailable state IS the page: UNKNOWN margin, reserved columns, never-on-this-page rail", async () => {
    const { default: FinancialsProfitability } = await import("../src/modules/financials/FinancialsProfitability.jsx");
    const { container } = mount(<FinancialsProfitability />);
    expect(container.textContent).toMatch(/Margin cannot be reported yet/);
    expect(container.textContent).toMatch(/UNKNOWN/);
    expect(container.textContent).toMatch(/never derived from sell price/i);
    expect(container.textContent).toMatch(/Statutory net profit, overhead allocation and tax/);
    for (const col of ["Billed revenue", "Cost", "Gross margin", "GM %"]) {
      expect(screen.getAllByText(col, { exact: false }).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("14 Company & Business Unit Performance — /financials/company-performance", () => {
  test("UNELIMINATED_SUM caveat kept; consolidated attainment deliberately '—'; reserved rows", async () => {
    const { default: FinancialsCompanyPerformance } = await import("../src/modules/financials/FinancialsCompanyPerformance.jsx");
    const { container } = mount(<FinancialsCompanyPerformance />);
    expect(container.textContent).toMatch(/UNELIMINATED_SUM/);
    expect(container.textContent).toMatch(/not accounting consolidation/i);
    for (const col of ["Taylor", "Ventana", "Consolidated", "Fact class"]) {
      expect(screen.getAllByText(col).length).toBeGreaterThanOrEqual(1);
    }
    // The attainment row's consolidated cell is the deliberate em dash.
    expect(container.textContent).toMatch(/silently mix measurement bases/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("15 Salesperson & Employee Performance — /financials/employee-performance", () => {
  test("scope statement in header; withheld panel named; views never merged; margin absence", async () => {
    const { default: FinancialsEmployeePerformance } = await import("../src/modules/financials/FinancialsEmployeePerformance.jsx");
    const { container } = mount(<FinancialsEmployeePerformance />);
    expect(container.textContent).toMatch(/resolved by the server when this page issues its read/);
    expect(container.textContent).toMatch(/Outside your scope/);
    expect(container.textContent).toMatch(/withheld by the server/);
    for (const label of ["Salesperson credit", "Service responsibility"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).toMatch(/FIN-PQ-15a/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

// ─── Wave UX-5 — governance / integrity ───

describe("16 Reconciliation & Exceptions — /financials/reconciliation", () => {
  test("internal (IN_SYNC/DRIFT, dormant) and external (FUTURE, no provider) never conflated", async () => {
    const { default: FinancialsReconciliation } = await import("../src/modules/financials/FinancialsReconciliation.jsx");
    const { container } = mount(<FinancialsReconciliation />);
    expect(container.textContent).toMatch(/Operational integrity — internal reconciliation/);
    expect(container.textContent).toMatch(/IN_SYNC/);
    expect(container.textContent).toMatch(/DRIFT/);
    expect(container.textContent).toMatch(/No governed reconciliation results to show/);
    expect(container.textContent).toMatch(/External accounting reconciliation/);
    expect(container.textContent).toMatch(/no counts, not zero counts/);
    // The external specimen is dimmed structure with deliberately empty values.
    expect(container.querySelector(".fin-dimmed")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("17 Intercompany — /financials/intercompany", () => {
  test("classification never elimination; unclassified is the loud exception; no fabricated events", async () => {
    const { default: FinancialsIntercompany } = await import("../src/modules/financials/FinancialsIntercompany.jsx");
    const { container } = mount(<FinancialsIntercompany />);
    expect(container.textContent).toMatch(/classified — never eliminated/i);
    expect(container.textContent).toMatch(/FIN-BLOCK-004/);
    for (const label of ["Taylor → Ventana", "Ventana → Taylor", "Unclassified"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("18 Financial Audit & History — /financials/audit", () => {
  test("a lens over the one audit authority — no raw sweep, correlation column reserved", async () => {
    const { default: FinancialsAudit } = await import("../src/modules/financials/FinancialsAudit.jsx");
    const { container } = mount(<FinancialsAudit />);
    expect(container.textContent).toMatch(/Never a second audit ledger/);
    expect(container.textContent).toMatch(/never issues a raw read over the whole audit log/);
    expect(container.textContent).toMatch(/FIN-PQ-CORRELATION-IDS/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("19 Reporting & Exports — /financials/reports", () => {
  test("catalog names blocking phases; export never wired; restricted = named panel", async () => {
    const { default: FinancialsReports } = await import("../src/modules/financials/FinancialsReports.jsx");
    const { container } = mount(<FinancialsReports />);
    for (const group of ["Sales", "Revenue & collections", "Plan", "Margin & cost", "Governance"]) {
      expect(screen.getAllByText(group).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
    expect(container.textContent).toMatch(/never a partial render/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("20 Financial Settings & Governance — /financials/governance", () => {
  test("period row reads BUILT_DORMANT + policy not configured — never AUTHORITY NOT IMPLEMENTED", async () => {
    const { default: FinancialsGovernance } = await import("../src/modules/financials/FinancialsGovernance.jsx");
    const { container } = mount(<FinancialsGovernance />);
    // The required current-main correction: the period model exists.
    expect(container.textContent).toMatch(/Financial periods \(FIN-008\)/);
    expect(screen.getAllByText("Built dormant").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("Policy not configured").length).toBeGreaterThanOrEqual(3);
    // No CHIP says it (the state-vocabulary tooltip may name it as a possible state).
    expect(screen.queryByText("Authority not implemented")).toBeNull();
    // Configured facts render as facts.
    expect(container.textContent).toMatch(/Operational subledger/);
    expect(container.textContent).toMatch(/USD/);
    expect(container.textContent).toMatch(/Taylor · Ventana/);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});
