import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountArSection from "../src/modules/accounts/AccountArSection.jsx";
import { useAccountAr } from "../src/hooks/useAccountAr.js";
import { accountArFromObligations } from "../src/domain/accountReceivablesEos.js";

vi.mock("../src/hooks/useAccountAr.js", () => ({ useAccountAr: vi.fn() }));

describe("AccountArSection", () => {
  it("renders a loading state", () => {
    useAccountAr.mockReturnValue({ loading: true, errorStatus: null, result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/Loading receivables/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: "denied", result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/Not available to you/)).toBeTruthy();
    expect(screen.queryByText(/No invoices/)).toBeNull();
  });

  it("renders an unavailable state on a failed read", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: "unavailable", result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/Receivables could/)).toBeTruthy();
  });

  it("renders empty honestly when the account genuinely has zero invoices", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: { status: "ready", invoices: [], summary: { count: 0, openCount: 0, overdueCount: 0, outstandingByCurrency: {} } },
    });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/No invoices on this account/)).toBeTruthy();
  });

  it("renders real invoice rows with tone-mapped AR position and never fabricates a total", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        invoices: [
          { invoiceId: "inv-1", invoiceNumber: "INV-1001", currency: "USD", outstandingMinor: 15000, arPosition: "OVERDUE", daysOverdue: 12 },
        ],
        summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: 15000 } },
      },
    });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText("INV-1001")).toBeTruthy();
    // The POSITION IN WORDS, never the stored token -- arPositionWords owns the vocabulary.
    expect(screen.getByText(/Overdue/)).toBeTruthy();
    expect(screen.queryByText(/OVERDUE/)).toBeNull();
    // X-SALES-ORDER-USD-DISPLAY: normal currency presentation replaced the ISO-code prefix. The
    // assertion's point is unchanged — the real outstanding amount reaches the screen.
    expect(screen.getAllByText(/\$150\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/12d overdue/)).toBeTruthy();
    expect(screen.getByText(/1 open, 1 overdue/)).toBeTruthy();
  });

  // ── The operating-company disclosure (lane C26) ──
  //
  // An account is not company-partitioned, so this table can genuinely list Taylor and Ventana
  // receivables side by side. The column exists ONLY when the governed read itself says so.

  it("adds no company column on a read that predates the company dimension", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        invoices: [{ invoiceId: "inv-1", invoiceNumber: "INV-1001", currency: "USD", outstandingMinor: 15000, arPosition: "CURRENT" }],
        summary: { count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 15000 } },
      },
    });
    render(<AccountArSection accountId="acc-1" />);
    // Nothing about companies may appear. A UI that asserts a breakdown it did not receive is
    // worse than one that shows none.
    expect(screen.queryByText("Company")).toBeNull();
    expect(screen.queryByText(/operating company/i)).toBeNull();
  });

  it("adds no company column when the account's receivables are all one company", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        invoices: [{ invoiceId: "inv-1", invoiceNumber: "INV-1001", companyId: "taylor", currency: "USD", outstandingMinor: 15000, arPosition: "CURRENT" }],
        summary: {
          count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 15000 },
          byCompany: { taylor: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 15000 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 15000 } } },
          companyIds: ["taylor"],
          spansMultipleCompanies: false,
        },
      },
    });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.queryByText("Company")).toBeNull();
  });

  it("names each invoice's company when the account spans two, and calls unattributed money unattributed", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        invoices: [
          { invoiceId: "inv-1", invoiceNumber: "INV-1001", companyId: "taylor", currency: "USD", outstandingMinor: 10000, arPosition: "CURRENT" },
          { invoiceId: "inv-2", invoiceNumber: "INV-1002", companyId: "ventana", currency: "USD", outstandingMinor: 5000, arPosition: "CURRENT" },
          { invoiceId: "inv-3", invoiceNumber: "INV-1003", companyId: null, currency: "USD", outstandingMinor: 2500, arPosition: "CURRENT" },
        ],
        summary: {
          count: 3, openCount: 3, overdueCount: 0, outstandingByCurrency: { USD: 17500 },
          byCompany: {
            taylor: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 10000 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 10000 } },
            ventana: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 5000 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 5000 } },
            UNATTRIBUTED: { count: 1, openCount: 1, overdueCount: 0, billedByCurrency: { USD: 2500 }, collectedByCurrency: {}, outstandingByCurrency: { USD: 2500 } },
          },
          companyIds: ["UNATTRIBUTED", "taylor", "ventana"],
          spansMultipleCompanies: true,
        },
      },
    });
    const { container } = render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText("Company")).toBeTruthy();
    expect(screen.getByText("Taylor Freezer of Arizona")).toBeTruthy();
    expect(screen.getByText("Ventana")).toBeTruthy();
    // The null-company invoice is stated as unattributed — never guessed onto either company.
    expect(screen.getByText("Not attributed to a company")).toBeTruthy();
    expect(container.textContent).toMatch(/span more than one operating company/i);
    expect(container.textContent).toMatch(/never inferred/i);
    // The section still totals nothing: no consolidated figure was smuggled in with the column.
    expect(container.textContent).not.toMatch(/\$175\.00/);
  });

  // ── F7c (DECISIONS #245): the EOS source reads the Finance register's receivables, which are not invoices ──
  const obligation = (o = {}) => ({
    id: "ob-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", sourceDomain: "BILLING_PACKAGE", sourceRecordId: "bpk-1",
    dueOn: "2026-11-01", overdue: false, originatedMinor: "20000", settledMinor: "5000", outstandingMinor: "15000",
    counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acc-1", name: "Harbor" }, ...o,
  });

  it("says Receivable, not Invoice, for the EOS envelope, and states an overdue flag without inventing a day count", () => {
    useAccountAr.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: accountArFromObligations([{ items: [obligation({ id: "ob-9", overdue: true })], truncated: false }]),
    });
    const { container } = render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText("Receivable")).toBeTruthy();
    expect(screen.queryByText("Invoice")).toBeNull();
    expect(container.textContent).toMatch(/per receivable/);
    expect(screen.getByText("ob-9")).toBeTruthy();
    expect(screen.getByText(/Overdue/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+d overdue/);
    expect(screen.getAllByText(/\$150\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 open, 1 overdue/)).toBeTruthy();
  });

  it("an EOS account with no receivables says so in its own noun", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: null, result: accountArFromObligations([{ items: [], truncated: false }]) });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/No receivables on this account/)).toBeTruthy();
    expect(screen.queryByText(/No invoices/)).toBeNull();
  });
});
