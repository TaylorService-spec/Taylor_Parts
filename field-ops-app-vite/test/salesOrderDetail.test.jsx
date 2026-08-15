import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";

vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));

function renderAt(salesOrderId) {
  return render(
    <MemoryRouter initialEntries={[`/customers/opportunities/sales-order/${salesOrderId}`]}>
      <Routes>
        <Route path="/customers/opportunities/sales-order/:salesOrderId" element={<SalesOrderDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SalesOrderDetail", () => {
  it("renders a loading state", () => {
    useSalesOrder.mockReturnValue({ loading: true, errorStatus: null, result: null });
    renderAt("SO-1");
    expect(screen.getByText(/Loading Sales Order/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty or not-found", () => {
    useSalesOrder.mockReturnValue({ loading: false, errorStatus: "denied", result: null });
    renderAt("SO-1");
    expect(screen.getByText(/not authorized to view this Sales Order/)).toBeTruthy();
    expect(screen.queryByText(/No Sales Order found/)).toBeNull();
  });

  it("renders an unavailable state on a failed read", () => {
    useSalesOrder.mockReturnValue({ loading: false, errorStatus: "unavailable", result: null });
    renderAt("SO-1");
    expect(screen.getByText(/currently unavailable/)).toBeTruthy();
  });

  it("renders an honest not-found for a genuinely missing id, distinct from unavailable", () => {
    useSalesOrder.mockReturnValue({ loading: false, errorStatus: null, result: { status: "not-found", salesOrder: null } });
    renderAt("SO-does-not-exist");
    expect(screen.getByText(/No Sales Order found/)).toBeTruthy();
  });

  it("renders identity, account, opportunity lineage, lines, and service Work Order lineage when ready", () => {
    useSalesOrder.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        salesOrder: {
          id: "SO-42",
          accountId: "ACCT-1",
          sourceOpportunityId: "OPP-7",
          ownerEmployeeId: "EMP-1",
          salesChannel: "RETAIL",
          state: "CONFIRMED",
          customerPO: "PO-1",
          notes: null,
          lines: [{ lineId: "line-1", kind: "PART", ref: "PRT-9", orderedQty: 4, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }],
          serviceWorkOrderIds: ["WO-1", "WO-2"],
        },
      },
    });
    renderAt("SO-42");
    expect(screen.getByText("Sales Order SO-42")).toBeTruthy();
    expect(screen.getByText("ACCT-1")).toBeTruthy();
    expect(screen.getByText("OPP-7")).toBeTruthy();
    expect(screen.getByText("CONFIRMED")).toBeTruthy();
    expect(screen.getByText("PRT-9")).toBeTruthy();
    expect(screen.getByText("WO-1")).toBeTruthy();
    expect(screen.getByText("WO-2")).toBeTruthy();
  });
});
