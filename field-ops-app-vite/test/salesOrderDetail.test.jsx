import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";

vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));

function renderAt(salesOrderId, props = {}) {
  return render(
    <MemoryRouter initialEntries={[`/customers/opportunities/sales-order/${salesOrderId}`]}>
      <Routes>
        <Route path="/customers/opportunities/sales-order/:salesOrderId" element={<SalesOrderDetail {...props} />} />
      </Routes>
    </MemoryRouter>
  );
}

// A CONFIRMED Sales Order with one PART line, no Service Work Orders yet -- every one of the four
// actions (Advance, Cancel, Allocate, Create Service) is offered from this state.
function readySalesOrder(overrides = {}) {
  return {
    loading: false,
    errorStatus: null,
    refetch: vi.fn(),
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
        serviceWorkOrderIds: [],
        ...overrides.salesOrder,
      },
    },
    ...overrides.state,
  };
}

function mockCommandClient() {
  return {
    transitionSalesOrder: vi.fn(),
    allocateSalesOrder: vi.fn(),
    createServiceForSalesOrder: vi.fn(),
  };
}

describe("SalesOrderDetail", () => {
  it("renders a loading state", () => {
    useSalesOrder.mockReturnValue({ loading: true, errorStatus: null, result: null });
    renderAt("SO-1");
    expect(screen.getByText(/Loading Sales Order/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty or not-found, and offers NO actions", () => {
    useSalesOrder.mockReturnValue({ loading: false, errorStatus: "denied", result: null });
    renderAt("SO-1");
    expect(screen.getByText(/not authorized to view this Sales Order/)).toBeTruthy();
    expect(screen.queryByText(/No Sales Order found/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Move to In Fulfillment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel order/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Allocate/i })).toBeNull();
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

  it("never renders or exposes a pricing/discount/tax/quote-term field -- the commercial boundary", () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    const { container } = renderAt("SO-42", { actionDeps: { client } });
    const text = container.textContent;
    for (const term of ["unitPrice", "Unit price", "Discount", "discount", "Tax rate", "Quote", "$", "Price"]) {
      expect(text).not.toContain(term);
    }
    expect(container.querySelectorAll('input[type="number"], input[name*="price" i]').length).toBe(0);
  });
});

describe("SalesOrderDetail -- operational actions (Item 4)", () => {
  it("an allowed actor on a CONFIRMED order sees all four action affordances", () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    renderAt("SO-42", { actionDeps: { client } });
    expect(screen.getByRole("button", { name: /Move to In Fulfillment/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancel order/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Allocate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create Service/i })).toBeTruthy();
  });

  it("FULFILLED: Cancel and Allocate and Create Service are NOT offered; only Close order (Advance) remains", () => {
    useSalesOrder.mockReturnValue(
      readySalesOrder({ salesOrder: { state: "FULFILLED", lines: [{ lineId: "l1", kind: "PART", ref: "P", orderedQty: 1, allocatedQty: 1, fulfilledQty: 1, billedQty: 0 }] } })
    );
    const client = mockCommandClient();
    renderAt("SO-42", { actionDeps: { client } });
    expect(screen.getByRole("button", { name: /Close order/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancel order/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Allocate$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Service/i })).toBeNull();
  });

  it("CLOSED: a terminal state offers NO actions at all", () => {
    useSalesOrder.mockReturnValue(readySalesOrder({ salesOrder: { state: "CLOSED" } }));
    const client = mockCommandClient();
    renderAt("SO-42", { actionDeps: { client } });
    expect(screen.queryByRole("button", { name: /Advance|Move to|Close order|Cancel order|Allocate|Create Service/i })).toBeNull();
    expect(screen.getByText(/No further actions are available for a CLOSED Sales Order/i)).toBeTruthy();
  });

  it("IN_FULFILLMENT with lines still open: Mark Fulfilled is NOT offered (allLinesFulfilled gate)", () => {
    useSalesOrder.mockReturnValue(
      readySalesOrder({ salesOrder: { state: "IN_FULFILLMENT", lines: [{ lineId: "l1", kind: "PART", ref: "P", orderedQty: 4, allocatedQty: 4, fulfilledQty: 1, billedQty: 0 }] } })
    );
    const client = mockCommandClient();
    renderAt("SO-42", { actionDeps: { client } });
    expect(screen.queryByRole("button", { name: /Mark Fulfilled/i })).toBeNull();
    // Cancel and Allocate remain valid from IN_FULFILLMENT.
    expect(screen.getByRole("button", { name: /Cancel order/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Allocate$/i })).toBeTruthy();
  });

  it("a successful Advance calls transitionSalesOrder once and refreshes the projection via refetch -- never fabricates the new state itself", async () => {
    const state = readySalesOrder();
    useSalesOrder.mockReturnValue(state);
    const client = mockCommandClient();
    client.transitionSalesOrder.mockResolvedValue({ result: { success: true, replayed: false, salesOrderId: "SO-42", state: "IN_FULFILLMENT" } });
    renderAt("SO-42", { actionDeps: { client } });

    fireEvent.click(screen.getByRole("button", { name: /Move to In Fulfillment/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Advance$/i })); // dialog confirmLabel

    await waitFor(() => expect(client.transitionSalesOrder).toHaveBeenCalledTimes(1));
    expect(client.transitionSalesOrder).toHaveBeenCalledWith(
      expect.objectContaining({ salesOrderId: "SO-42", transition: "ADVANCE" })
    );
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
    // The component itself never renders a fabricated post-action state -- it only re-reads via refetch.
  });

  it("a retried Advance (failed then re-confirmed) reuses the SAME idempotencyKey across both calls", async () => {
    const state = readySalesOrder();
    useSalesOrder.mockReturnValue(state);
    const client = mockCommandClient();
    client.transitionSalesOrder
      .mockResolvedValueOnce({ errorStatus: "internal" })
      .mockResolvedValueOnce({ result: { success: true, replayed: false, salesOrderId: "SO-42", state: "IN_FULFILLMENT" } });
    renderAt("SO-42", { actionDeps: { client } });

    fireEvent.click(screen.getByRole("button", { name: /Move to In Fulfillment/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Advance$/i }));
    await waitFor(() => expect(client.transitionSalesOrder).toHaveBeenCalledTimes(1));
    await screen.findByText(/could not be completed/i);

    // Retry: click Advance again in the STILL-OPEN dialog.
    fireEvent.click(screen.getByRole("button", { name: /^Advance$/i }));
    await waitFor(() => expect(client.transitionSalesOrder).toHaveBeenCalledTimes(2));

    const firstKey = client.transitionSalesOrder.mock.calls[0][0].idempotencyKey;
    const secondKey = client.transitionSalesOrder.mock.calls[1][0].idempotencyKey;
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(0);
    expect(secondKey).toBe(firstKey);
  });

  it("a denied action surfaces a safe error in the dialog and does NOT call refetch", async () => {
    const state = readySalesOrder();
    useSalesOrder.mockReturnValue(state);
    const client = mockCommandClient();
    const deniedErr = new Error("permission-denied");
    client.allocateSalesOrder.mockResolvedValue({ errorStatus: "permission-denied" });
    void deniedErr;
    renderAt("SO-42", { actionDeps: { client } });

    fireEvent.click(screen.getByRole("button", { name: /^Allocate$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Confirm allocate$/i }));

    await screen.findByText(/not authorized to perform this action/i);
    expect(state.refetch).not.toHaveBeenCalled();
  });
});
