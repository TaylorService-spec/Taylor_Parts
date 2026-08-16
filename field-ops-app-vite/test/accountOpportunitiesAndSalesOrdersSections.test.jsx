// Account-scoped Opportunities + Sales Orders sections (Wave 7 completion PARTS 2/3). Component-level
// coverage for the states the briefing calls out explicitly: loading, denied, unavailable, empty,
// populated -- with EMPTY asserted as semantically and visually distinct from every FAILURE mode (the
// single most important behavioral requirement). Also asserts no raw Firebase UID ever renders, and
// that deep links point at real, existing routes.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const oppState = { current: { loading: false, errorStatus: null, result: null } };
const soState = { current: { loading: false, errorStatus: null, result: null } };
const directoryState = { current: { byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null } };

vi.mock("../src/hooks/useAccountOpportunities.js", () => ({ useAccountOpportunities: () => oppState.current }));
vi.mock("../src/hooks/useAccountSalesOrders.js", () => ({ useAccountSalesOrders: () => soState.current }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => directoryState.current,
  resolveActorDisplayName: (uid, byUserId) => byUserId?.get?.(uid)?.displayName ?? "Unknown user",
}));

import AccountOpportunitiesSection from "../src/modules/accounts/AccountOpportunitiesSection.jsx";
import AccountSalesOrdersSection from "../src/modules/accounts/AccountSalesOrdersSection.jsx";

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  oppState.current = { loading: false, errorStatus: null, result: null };
  soState.current = { loading: false, errorStatus: null, result: null };
  directoryState.current = { byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null };
});

const RAW_UID = "aZ3kP9qXfL2mN7bV0cR5tY8wD1eH";

describe("AccountOpportunitiesSection", () => {
  it("loading -> shows a loading indicator, not empty or failure copy", () => {
    oppState.current = { loading: true, errorStatus: null, result: null };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText(/loading opportunities/i)).toBeTruthy();
    expect(screen.queryByText(/no opportunities/i)).toBeNull();
  });

  it("denied -> renders a FailureState, NEVER the empty-state copy", () => {
    oppState.current = { loading: false, errorStatus: "denied", result: null };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText(/not authorized/i)).toBeTruthy();
    expect(screen.queryByText(/no opportunities on this account/i)).toBeNull();
  });

  it("unavailable -> renders an honest unavailable line, NEVER the empty-state copy", () => {
    oppState.current = { loading: false, errorStatus: "unavailable", result: null };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText(/currently unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/no opportunities on this account/i)).toBeNull();
  });

  it("empty -> renders ONLY when the read genuinely succeeded with zero rows, distinct from failure", () => {
    oppState.current = { loading: false, errorStatus: null, result: { status: "ready", opportunities: [], skipped: 0, truncated: false } };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText(/no opportunities on this account/i)).toBeTruthy();
    expect(screen.queryByText(/not authorized/i)).toBeNull();
    expect(screen.queryByText(/currently unavailable/i)).toBeNull();
  });

  it("populated -> renders rows with stage, owner display name (never a raw uid), and a deep link", () => {
    directoryState.current = {
      byUserId: new Map(),
      byEmployeeId: new Map([["EMP-1", { id: "EMP-1", displayName: "Jamie Rivera" }]]),
      loading: false,
      error: null,
    };
    oppState.current = {
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        truncated: false,
        skipped: 0,
        opportunities: [
          { id: "OPP-1", need: "Replace ice machine", stage: "QUOTING", outcome: null, expectedValue: 5000, expectedCloseAt: Date.now(), ownerEmployeeId: "EMP-1", salesOrderId: null },
        ],
      },
    };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText("Replace ice machine")).toBeTruthy();
    expect(screen.getByText(/jamie rivera/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain(RAW_UID);
    const link = screen.getByRole("link", { name: "Replace ice machine" });
    expect(link.getAttribute("href")).toBe("/opportunities");
  });

  it("truncated page -> discloses the bound honestly instead of silently dropping rows", () => {
    oppState.current = {
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        truncated: true,
        skipped: 0,
        opportunities: [{ id: "OPP-1", need: "x", stage: "QUOTING", ownerEmployeeId: null }],
      },
    };
    renderWithRouter(<AccountOpportunitiesSection accountId="acc-1" />);
    expect(screen.getByText(/showing the first 1 opportunities/i)).toBeTruthy();
  });
});

describe("AccountSalesOrdersSection", () => {
  it("loading -> shows a loading indicator, not empty or failure copy", () => {
    soState.current = { loading: true, errorStatus: null, result: null };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(screen.getByText(/loading sales orders/i)).toBeTruthy();
  });

  it("denied -> renders a FailureState, NEVER the empty-state copy", () => {
    soState.current = { loading: false, errorStatus: "denied", result: null };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(screen.getByText(/not authorized/i)).toBeTruthy();
    expect(screen.queryByText(/no sales orders on this account/i)).toBeNull();
  });

  it("unavailable -> renders an honest unavailable line, NEVER the empty-state copy", () => {
    soState.current = { loading: false, errorStatus: "unavailable", result: null };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(screen.getByText(/currently unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/no sales orders on this account/i)).toBeNull();
  });

  it("empty -> renders ONLY when the read genuinely succeeded with zero rows, distinct from failure", () => {
    soState.current = { loading: false, errorStatus: null, result: { status: "ready", salesOrders: [], skipped: 0, truncated: false } };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(screen.getByText(/no sales orders on this account/i)).toBeTruthy();
    expect(screen.queryByText(/not authorized/i)).toBeNull();
    expect(screen.queryByText(/currently unavailable/i)).toBeNull();
  });

  it("populated -> renders rows with lifecycle state, service-lineage indicator, and a real deep link", () => {
    soState.current = {
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        truncated: false,
        skipped: 0,
        salesOrders: [
          {
            id: "SO-1", customerPO: "PO-9", state: "IN_FULFILLMENT", ownerEmployeeId: null, updatedAtMillis: Date.now(),
            serviceWorkOrderIds: ["WO-1", "WO-2"],
            lines: [{ lineId: "line-1", kind: "PART", ref: "P1", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }],
          },
        ],
      },
    };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(screen.getByText("PO-9")).toBeTruthy();
    expect(screen.getByText("IN_FULFILLMENT")).toBeTruthy();
    expect(screen.getByText(/2 Work Orders/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "PO-9" });
    expect(link.getAttribute("href")).toBe("/customers/opportunities/sales-order/SO-1");
    // No amount/price is rendered anywhere -- PR #991's exclusion holds through the whole client stack.
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  it("never renders a raw Firebase uid for the owner field", () => {
    directoryState.current = { byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null };
    soState.current = {
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        truncated: false,
        skipped: 0,
        salesOrders: [
          { id: "SO-1", customerPO: null, state: "CONFIRMED", ownerEmployeeId: RAW_UID, updatedAtMillis: Date.now(), serviceWorkOrderIds: [], lines: [] },
        ],
      },
    };
    renderWithRouter(<AccountSalesOrdersSection accountId="acc-1" />);
    expect(document.body.textContent).not.toContain(RAW_UID);
  });
});
