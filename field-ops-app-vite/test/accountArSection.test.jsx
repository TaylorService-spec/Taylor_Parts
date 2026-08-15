import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountArSection from "../src/modules/accounts/AccountArSection.jsx";
import { useAccountAr } from "../src/hooks/useAccountAr.js";

vi.mock("../src/hooks/useAccountAr.js", () => ({ useAccountAr: vi.fn() }));

describe("AccountArSection", () => {
  it("renders a loading state", () => {
    useAccountAr.mockReturnValue({ loading: true, errorStatus: null, result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/Loading AR/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: "denied", result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/not authorized to view AR/)).toBeTruthy();
    expect(screen.queryByText(/No invoices/)).toBeNull();
  });

  it("renders an unavailable state on a failed read", () => {
    useAccountAr.mockReturnValue({ loading: false, errorStatus: "unavailable", result: null });
    render(<AccountArSection accountId="acc-1" />);
    expect(screen.getByText(/currently unavailable/)).toBeTruthy();
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
    expect(screen.getByText("OVERDUE")).toBeTruthy();
    expect(screen.getAllByText(/USD 150\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/12d overdue/)).toBeTruthy();
    expect(screen.getByText(/1 open, 1 overdue/)).toBeTruthy();
  });
});
