// Finance Closure (#206): the Finance workspace decides nothing -- the server's figures, the server's refusals; company-scoped,
// with Consolidated a reporting view that records nothing.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

const ACCESS = (companies = ["taylor", "ventana"], consolidated = true) => ({ ok: true, result: { principalId: "p", consolidated,
  companies: companies.map((c) => ({ operatingCompanyId: c, name: c === "taylor" ? "Taylor Freezer of Arizona" : "Ventana",
    actions: { view: true, record: true, apply: true, correct: true, reconcile: true } })) } });
/** A server stand-in: the access read answers `access`; everything else `rest(op, input)`. */
const server = (rest, access = ACCESS()) => vi.fn(async (op, input) => (op === "readMyFinanceCompanyAccess" ? access : rest(op, input)));

describe("FinancialsWorkspace", () => {
  it("shows the server's exceptions in words; applies a settlement as integer minor units", async () => {
    const callApi = server((op) => (op === "readFinanceWorkspace" ? { ok: true, result: WS() } : { ok: true, result: {} }));
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
    const callApi = server(() => ({ ok: true, result: WS("CONSOLIDATED_REPORTING_PROJECTION") }));
    render(<FinancialsWorkspace callApi={callApi} />);
    fireEvent.change(await screen.findByLabelText("Company"), { target: { value: "consolidated" } });
    await screen.findByText(/Nothing is recorded in it/);
    expect(screen.queryByRole("button", { name: "Record Settlement" })).toBeNull();
  });

  it("renders the server's refusal; parses money without floats", async () => {
    render(<FinancialsWorkspace callApi={server(() => ({ ok: false, code: "FORBIDDEN" }))} />);
    await screen.findByText(/finance.payment.read/);
    expect([toMinorUnits("12.5"), toMinorUnits("0.07"), toMinorUnits("1.005"), toMinorUnits("-1")]).toEqual([1250, 7, null, null]);
  });

  // COMPANY ASSIGNMENT (Financials Workspace P0 correction): the selector is the server's, never a client list.
  it("offers only the companies the server says the person is assigned to; Consolidated only when assigned to every company", async () => {
    const callApi = server(() => ({ ok: true, result: WS() }), ACCESS(["taylor"], false));
    render(<FinancialsWorkspace callApi={callApi} />);
    const select = await screen.findByLabelText("Company");
    await waitFor(() => expect([...select.options].map((o) => o.value)).toEqual(["taylor"]));
    expect(screen.queryByRole("option", { name: /Ventana|Consolidated/ })).toBeNull();
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("readFinanceWorkspace", { operatingCompanyId: "taylor" }));
    expect(callApi).not.toHaveBeenCalledWith("readFinanceWorkspace", expect.objectContaining({ operatingCompanyId: "ventana" }));
    expect(callApi).not.toHaveBeenCalledWith("readFinanceWorkspace", expect.objectContaining({ operatingCompanyId: "consolidated" }));
  });

  it("someone assigned to both companies is offered both and the Consolidated reporting view", async () => {
    render(<FinancialsWorkspace callApi={server(() => ({ ok: true, result: WS() }))} />);
    const select = await screen.findByLabelText("Company");
    await waitFor(() => expect([...select.options].map((o) => o.value)).toEqual(["taylor", "ventana", "consolidated"]));
  });

  it("with no company assignment: no selector, no workspace read, and says why", async () => {
    const callApi = server(() => ({ ok: true, result: WS() }), ACCESS([], false));
    render(<FinancialsWorkspace callApi={callApi} />);
    await screen.findByText(/No operating company is within your Financials access/);
    expect(screen.queryByLabelText("Company")).toBeNull();
    expect(callApi).not.toHaveBeenCalledWith("readFinanceWorkspace", expect.anything());
  });

  it("an out-of-scope refusal is shown in words", async () => {
    render(<FinancialsWorkspace callApi={server(() => ({ ok: false, code: "FORBIDDEN", reason: "OUTSIDE_OPERATING_COMPANY_SCOPE" }))} />);
    await screen.findByText(/does not cover this operating company/);
  });
});

// UI PERMISSION PARITY (PERM-UI, 2026-10-19): Record / Apply / Reconcile are offered only where the server's own per-company
// advice (readMyFinanceCompanyAccess.actions) says finance.settlement.record / .apply / finance.reconciliation.record is reached.
describe("PERM-UI: Finance controls follow the server's per-company actions", () => {
  const only = (actions) => ({ ok: true, result: { principalId: "p", consolidated: false,
    companies: [{ operatingCompanyId: "taylor", name: "Taylor Freezer of Arizona", actions: { view: true, record: false, apply: false, correct: false, reconcile: false, ...actions } }] } });
  const open = async (actions) => {
    const callApi = server(() => ({ ok: true, result: WS() }), only(actions));
    render(<FinancialsWorkspace callApi={callApi} />);
    await screen.findByText("Harbor Grill");
  };

  it("a viewer with none of the three actions sees the workspace and no Record, Apply or Reconcile control", async () => {
    await open({});
    expect(screen.queryByRole("button", { name: "Record Settlement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply CHK-9" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
    expect(screen.getByText(/needs finance.settlement.apply/)).toBeTruthy();
    expect(screen.getByText(/needs finance.reconciliation.record/)).toBeTruthy();
  });

  it("each control is offered on its own capability", async () => {
    await open({ record: true });
    expect(screen.getByRole("button", { name: "Record Settlement" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply CHK-9" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
    cleanup();
    await open({ apply: true });
    expect(screen.getByRole("button", { name: "Apply CHK-9" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record Settlement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
    cleanup();
    await open({ reconcile: true });
    expect(screen.getByRole("button", { name: "Reconcile" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply CHK-9" })).toBeNull();
  });
});
