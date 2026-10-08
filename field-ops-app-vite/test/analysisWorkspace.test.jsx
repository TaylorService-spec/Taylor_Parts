// Analysis (#208): the workspace decides and computes nothing -- the server's figures, basis, refusals, exceptions and actions.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AnalysisWorkspace, { figure } from "../src/modules/analysis/AnalysisWorkspace.jsx";

const CATALOG = { areas: [{ key: "finance", label: "Finance / Accounting", channel: null, available: true }, { key: "salesRetail", label: "Retail Sales", channel: "RETAIL", available: false }], measures: [], exceptionRules: [], aiRequired: false };
const M = (over) => ({ id: "finance.receivables.open", name: "Open receivables", domain: "finance", basis: "EOS_OPERATIONAL_ACTUAL", unit: "MONEY", timeBasis: "POINT_IN_TIME",
  status: "COMPUTED", value: { value: "57000", currencies: ["USD"] }, aggregate: { count: 3, quantity: 3, money: { USD: "57000" }, missingAmount: 0, ratio: null },
  quality: { state: "COMPLETE", notes: [] }, comparison: { notComparableReason: "a point-in-time measure has no governed history snapshot to compare against" }, ...over });
const WS = { area: { key: "finance", label: "Finance / Accounting", channel: null },
  scope: { operatingCompanyId: "consolidated", projection: "CONSOLIDATED_REPORTING_PROJECTION", companies: ["taylor", "ventana"], note: "Consolidated is an un-eliminated projection over the companies; it owns no record." },
  period: { currentFirstDay: "2026-10-01", currentLastDay: "2026-10-03", comparisonFirstDay: "2026-09-01", comparisonLastDay: "2026-09-03" },
  exceptions: [{ kind: "OVERDUE_RECEIVABLE", severity: "HIGH", rule: "a receivable is past its governed due date", recordKind: "obligation", recordId: "obl-1", label: "Harbor Grill",
    operatingCompanyId: "taylor", drill: null, action: { operation: "recordSettlement", route: "/operations/finance", capability: "finance.settlement.record", label: "Record the customer's payment", available: false } }],
  measures: [M(), M({ id: "accounting.actual", name: "Accounting actuals", basis: "ACCOUNTING_ACTUAL", status: "ABSENT", reason: "EOS is the operational subledger, not the GL (#145)." }),
    M({ id: "sales.orders.booked", name: "Orders booked", status: "REFUSED", reason: "requires salesOrder.read" })],
  insights: [], aiRequired: false };
const api = () => vi.fn(async (op) => (op === "readAnalysisCatalog" ? { ok: true, result: CATALOG } : op === "readAnalysisWorkspace" ? { ok: true, result: WS }
  : { ok: true, result: { measure: { ...M(), drivers: { byCompany: [{ key: "taylor", count: 2, quantity: 2, money: { USD: "50000" } }], byDimension: [] },
    provenance: { contributingRecords: 3, definition: { formula: "Σ outstanding", description: "What customers owe.", sourceFacts: ["eos_finance.obligations"], periodEvent: null, dimension: "obligation kind" },
      sources: [{ recordId: "obl-1", label: "Harbor Grill", operatingCompanyId: "taylor", dimension: "RECEIVABLE", amountMinor: "40000", currency: "USD", quantity: 1, drill: { route: "/operations/finance", operation: "readObligation", input: { obligationId: "obl-1" } } }] } } } }));

describe("AnalysisWorkspace", () => {
  it("leads with exceptions, labels basis, shows absence and refusal honestly, offers an action only as the server allows", async () => {
    const { container } = render(<AnalysisWorkspace callApi={api()} />);
    await screen.findByText("Harbor Grill");
    expect(container.textContent).toMatch(/Record the customer's payment — needs Finance Settlement Record access/);
    expect(container.textContent).toMatch(/EOS Operational Actual/);
    expect(container.textContent).toMatch(/not the GL/);
    expect(container.textContent).toMatch(/Not available to you — requires salesOrder.read/);
    expect(container.textContent).toMatch(/un-eliminated projection/);
    expect(screen.queryByRole("button", { name: "Retail Sales" })).toBeNull();
  });

  it("explains a figure down to its contributing records and their governed read", async () => {
    const callApi = api();
    render(<AnalysisWorkspace callApi={callApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Explain Open receivables" }));
    await screen.findByText(/Read Obligation/);
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("readMeasureAnalysis", expect.objectContaining({ measureId: "finance.receivables.open", operatingCompanyId: "consolidated" })));
  });

  it("never turns a missing figure into zero; money stays per currency", () => {
    expect(figure("MONEY", null, { money: {}, missingAmount: 2 })).toBe("— (price missing)");
    expect(figure("RATIO", null, {})).toBe("—");
    expect(figure("MONEY", null, { money: { USD: "100", CAD: "200" }, missingAmount: 0 })).toMatch(/·/);
  });
});
