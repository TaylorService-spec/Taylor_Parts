// Finance Closure (#206): the Finance workspace decides nothing -- the server's figures, the server's refusals; company-scoped,
// with Consolidated a reporting view that records nothing.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FinancialsWorkspace, { toMinorUnits } from "../src/modules/financials/FinancialsWorkspace.jsx";

const section = (items = []) => ({ count: items.length, outstandingByCurrency: items.length ? { USD: "15000" } : {}, items });
const WS = (projection = "OPERATING_COMPANY") => ({
  scope: { operatingCompanyId: projection === "OPERATING_COMPANY" ? "taylor" : "consolidated", projection, companies: projection === "OPERATING_COMPANY" ? ["taylor"] : ["taylor", "ventana"] },
  exceptionCounts: { overdueObligations: 1, partiallyPaidObligations: 1, unappliedSettlements: 1, accountingHandoffExceptions: 0, reconciliationMismatches: 0,
    unreconciledSettlements: 1, missingCostEvidence: 0, intercompanyReliefPending: 0 },
  receivables: section([{ id: "obl-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "PARTIAL", overdue: true, dueOn: "2026-09-30",
    originatedMinor: "40000", settledMinor: "25000", outstandingMinor: "15000", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-c", name: "Harbor Grill" } }]),
  fundingReceivables: section(), payables: section(), intercompanyReceivables: section(), intercompanyPayables: section(), overdue: [], partiallyPaid: [],
  unappliedSettlements: [{ id: "stl-1", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", currency: "USD", amountMinor: "20000", unappliedMinor: "5000", businessDate: "2026-10-03", sourceReference: "CHK-9" }],
  accountingHandoffs: [], reconciliation: [{ settlementId: "stl-1", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", amountMinor: "20000", currency: "USD", status: "UNRECONCILED", externalAmountMinor: null, reason: null }],
  missingCostEvidence: [], intercompanyReliefPending: [],
});

describe("FinancialsWorkspace", () => {
  it("shows the server's exceptions in words; applies a settlement as integer minor units", async () => {
    const callApi = vi.fn(async (op) => (op === "readFinanceWorkspace" ? { ok: true, result: WS() } : { ok: true, result: {} }));
    const { container } = render(<FinancialsWorkspace callApi={callApi} />);
    await screen.findByText("Harbor Grill");
    expect(container.textContent).toMatch(/Partially Paid · overdue/);
    expect(container.textContent).not.toMatch(/\bPARTIAL\b|CUSTOMER_PAYMENT|RECEIVABLE\b/);
    fireEvent.change(screen.getByLabelText("Obligation for CHK-9"), { target: { value: "obl-1" } });
    fireEvent.change(screen.getByLabelText("Amount to apply from CHK-9"), { target: { value: "50.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply CHK-9" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("applySettlement", expect.objectContaining({ settlementId: "stl-1", applications: [{ obligationId: "obl-1", amountMinor: 5000 }] })));
  });

  it("Consolidated is a reporting view: no settlement can be recorded in it", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: WS("CONSOLIDATED_REPORTING_PROJECTION") }));
    render(<FinancialsWorkspace callApi={callApi} />);
    fireEvent.change(await screen.findByLabelText("Company"), { target: { value: "consolidated" } });
    await screen.findByText(/Nothing is recorded in it/);
    expect(screen.queryByRole("button", { name: "Record Settlement" })).toBeNull();
  });

  it("renders the server's refusal; parses money without floats", async () => {
    render(<FinancialsWorkspace callApi={vi.fn(async () => ({ ok: false, code: "FORBIDDEN" }))} />);
    await screen.findByText(/finance.payment.read/);
    expect([toMinorUnits("12.5"), toMinorUnits("0.07"), toMinorUnits("1.005"), toMinorUnits("-1")]).toEqual([1250, 7, null, null]);
  });
});
