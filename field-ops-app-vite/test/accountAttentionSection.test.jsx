// Wave 7 extension, PART 1.6 -- render gate for AccountAttentionSection (vitest + jsdom), mirroring
// workOrderAttentionPanel.test.jsx's pattern: mocks the two underlying reads (useAccountAr,
// useAccountAttentionWorkOrders) at their hook boundary and proves the projection -> component wiring
// through the REAL domain/accountAttentionProjection.js, not a re-implemented stub.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useAccountAr.js", () => ({ useAccountAr: vi.fn() }));
vi.mock("../src/hooks/useAccountAttentionWorkOrders.js", () => ({ useAccountAttentionWorkOrders: vi.fn() }));

import { useAccountAr } from "../src/hooks/useAccountAr.js";
import { useAccountAttentionWorkOrders } from "../src/hooks/useAccountAttentionWorkOrders.js";
import AccountAttentionSection from "../src/modules/accounts/AccountAttentionSection.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

function mockReads({ ar, wo }) {
  useAccountAr.mockReturnValue(ar);
  useAccountAttentionWorkOrders.mockReturnValue(wo);
}

const renderSection = (props) => render(<MemoryRouter><AccountAttentionSection {...props} /></MemoryRouter>);

const HEALTHY_AR = { loading: false, errorStatus: null, result: { status: "ready", invoices: [], summary: {} } };
const HEALTHY_WO = { loading: false, error: false, workOrders: [], truncated: false };

describe("AccountAttentionSection -- Account Attention projection wiring", () => {
  it("a fully-healthy account (no overdue AR, no past-due WOs) renders an honest empty state", () => {
    mockReads({ ar: HEALTHY_AR, wo: HEALTHY_WO });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Account Attention")).toBeTruthy();
    expect(screen.getByText("Nothing needs attention on this account right now.")).toBeTruthy();
  });

  it("renders an overdue invoice under 'Accounts Receivable' with a correct deep link and its own fields, never a WO field", () => {
    mockReads({
      ar: {
        loading: false,
        errorStatus: null,
        result: {
          status: "ready",
          invoices: [
            { invoiceId: "inv-1", invoiceNumber: "INV-1001", arPosition: "OVERDUE", outstandingMinor: 50000, currency: "USD", daysOverdue: 12 },
          ],
          summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: 50000 } },
        },
      },
      wo: HEALTHY_WO,
    });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Account Attention (1)")).toBeTruthy();
    expect(screen.getByText("Accounts Receivable")).toBeTruthy();
    expect(screen.getByText("INV-1001")).toBeTruthy();
    expect(screen.getByText("Action needed")).toBeTruthy();
    const link = screen.getByText("INV-1001").closest("a");
    expect(link.getAttribute("href")).toBe("/customers/acct-1#account-ar-section");
  });

  it("renders a past-due work order under 'Past Due' with the canonical WO deep link, kept in a section distinct from AR", () => {
    mockReads({
      ar: HEALTHY_AR,
      wo: { loading: false, error: false, workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }], truncated: false },
    });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Past Due")).toBeTruthy();
    expect(screen.getByText("WO-1001")).toBeTruthy();
    const link = screen.getByText("WO-1001").closest("a");
    expect(link.getAttribute("href")).toBe("/service/work-orders/WO-1");
    // AR and WO sections never interleave -- "Accounts Receivable" heading absent when AR is healthy-empty.
    expect(screen.queryByText("Accounts Receivable")).toBeNull();
  });

  it("both sources firing at once render as two DISTINCT sections, never merged/ranked together", () => {
    mockReads({
      ar: {
        loading: false,
        errorStatus: null,
        result: {
          status: "ready",
          invoices: [{ invoiceId: "inv-1", invoiceNumber: "INV-1001", arPosition: "OVERDUE", outstandingMinor: 1000, currency: "USD", daysOverdue: 3 }],
          summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: 1000 } },
        },
      },
      wo: { loading: false, error: false, workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }], truncated: false },
    });
    renderSection({ accountId: "acct-1" });
    const headings = screen.getAllByText(/Accounts Receivable|Past Due/).map((el) => el.textContent);
    expect(headings).toEqual(["Accounts Receivable", "Past Due"]); // fixed, distinct order
    expect(screen.getByText("Account Attention (2)")).toBeTruthy();
  });

  it("a denied AR read renders an honest denied note, and never a fabricated zero for that source", () => {
    mockReads({ ar: { loading: false, errorStatus: "denied", result: null }, wo: HEALTHY_WO });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Accounts Receivable: not authorized to view.")).toBeTruthy();
    expect(screen.queryByText("Nothing needs attention on this account right now.")).toBeNull();
  });

  it("a failed WO read renders an honest unavailable note, distinct from a confirmed-healthy empty state", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: true, workOrders: null, truncated: false } });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Work order attention: currently unavailable. Try again later.")).toBeTruthy();
    expect(screen.queryByText("Nothing needs attention on this account right now.")).toBeNull();
  });

  it("a truncated (possibly-incomplete) WO read degrades to the unavailable note rather than an under-reported list", () => {
    mockReads({ ar: HEALTHY_AR, wo: { loading: false, error: false, workOrders: [], truncated: true } });
    renderSection({ accountId: "acct-1" });
    expect(screen.getByText("Work order attention: currently unavailable. Try again later.")).toBeTruthy();
  });

  it("never renders a raw Firebase UID anywhere on the page", () => {
    mockReads({
      ar: {
        loading: false,
        errorStatus: null,
        result: {
          status: "ready",
          invoices: [{ invoiceId: "inv-1", invoiceNumber: "INV-1001", arPosition: "OVERDUE", outstandingMinor: 1000, currency: "USD", daysOverdue: 3 }],
          summary: { count: 1, openCount: 1, overdueCount: 1, outstandingByCurrency: { USD: 1000 } },
        },
      },
      wo: { loading: false, error: false, workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY }], truncated: false },
    });
    renderSection({ accountId: "acct-1" });
    // A raw Firebase auth uid is a long opaque alphanumeric token -- none of this component's rendered
    // text is ever a bare id string (every id-shaped value shown is a human label: invoice/WO number).
    expect(screen.queryByText(/^[A-Za-z0-9]{20,}$/)).toBeNull();
  });
});
