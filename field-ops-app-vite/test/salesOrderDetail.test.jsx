import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";

vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));

// Defaults `hasCapability` to grant-all -- most tests in this file exercise the STATE mirror
// (domain/salesOrderActions.js), not the write-capability gate, so they keep the pre-existing
// "an authorized actor" premise unless a test explicitly overrides `hasCapability` to exercise the
// capability gate itself (see the "write-capability gating" describe block below).
function renderAt(salesOrderId, props = {}) {
  const { hasCapability = () => true, ...rest } = props;
  return render(
    <MemoryRouter initialEntries={[`/customers/opportunities/sales-order/${salesOrderId}`]}>
      <Routes>
        <Route
          path="/customers/opportunities/sales-order/:salesOrderId"
          element={<SalesOrderDetail hasCapability={hasCapability} {...rest} />}
        />
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
        salesOrderNumber: "SO-2026-000042",
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
          salesOrderNumber: "SO-2026-000042",
          accountId: "ACCT-1",
          sourceOpportunityId: "OPP-7",
          sourceOpportunityNumber: "OPP-2026-000007",
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
    expect(screen.getByText("Sales Order SO-2026-000042")).toBeTruthy();
    expect(screen.getByText("ACCT-1")).toBeTruthy();
    // CHANGED, and the old expectation was the defect (#1099). This asserted the raw
    // sourceOpportunityId was rendered — i.e. it pinned a Firestore document id as the
    // visible label of the Originating Opportunity link, which is exactly the behaviour
    // the governance forbids. The lineage link now shows the Opportunity's immutable
    // reference.
    expect(screen.getByText("OPP-2026-000007")).toBeTruthy();
    expect(screen.queryByText("OPP-7")).toBeNull();
    expect(screen.getByText("CONFIRMED")).toBeTruthy();
    expect(screen.getByText("PRT-9")).toBeTruthy();
    expect(screen.getByText("WO-1")).toBeTruthy();
    expect(screen.getByText("WO-2")).toBeTruthy();
  });

  // DECISIONS #106 -- a missing business reference is NOT permission to display a record id.
  it("renders the governed salesOrderNumber as the page identity and never the document id", () => {
    useSalesOrder.mockReturnValue(readySalesOrder({ salesOrder: { id: "doc-abc123", salesOrderNumber: "SO-2026-000042" } }));
    const client = mockCommandClient();
    const { container } = renderAt("doc-abc123", { actionDeps: { client } });
    expect(screen.getByText("Sales Order SO-2026-000042")).toBeTruthy();
    expect(container.textContent).not.toContain("doc-abc123");
  });

  it("renders an honest unavailable state for a legacy Sales Order with no salesOrderNumber -- never falls back to the document id", () => {
    useSalesOrder.mockReturnValue(readySalesOrder({ salesOrder: { id: "doc-legacy-xyz", salesOrderNumber: null } }));
    const client = mockCommandClient();
    const { container } = renderAt("doc-legacy-xyz", { actionDeps: { client } });
    expect(screen.getByText("Sales Order — Reference unavailable")).toBeTruthy();
    expect(container.textContent).not.toContain("doc-legacy-xyz");
  });

  it("labels the lineage link honestly when the Sales Order predates Opportunity identity", () => {
    // No reference exists to show, and the document id must NOT stand in for one. The link
    // still renders — a Sales Order that HAS an originating Opportunity should say so — but
    // it says something true rather than exposing an internal key.
    useSalesOrder.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        salesOrder: {
          id: "SO-42",
          accountId: "ACCT-1",
          state: "CONFIRMED",
          sourceOpportunityId: "OPP-7",
          sourceOpportunityNumber: null,
          lines: [],
          serviceWorkOrderIds: [],
        },
      },
    });
    renderAt("SO-42");
    expect(screen.getByText("Originating opportunity")).toBeTruthy();
    expect(screen.queryByText("OPP-7")).toBeNull();
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

  // DECISIONS #106 -- a missing business reference is NOT permission to display a record id.
  // This is the fifth instance of this defect class (#1094, #1099, #1124, #1162): the action
  // dialogs interpolated the raw Firestore document id into consequence copy.
  it("action dialog consequence copy shows the governed salesOrderNumber and never the document id", async () => {
    useSalesOrder.mockReturnValue(readySalesOrder({ salesOrder: { id: "doc-abc123", salesOrderNumber: "SO-2026-000042" } }));
    const client = mockCommandClient();
    const { container } = renderAt("doc-abc123", { actionDeps: { client } });

    fireEvent.click(screen.getByRole("button", { name: /Move to In Fulfillment/i }));
    expect(await screen.findByText(/This moves Sales Order SO-2026-000042 from CONFIRMED to IN_FULFILLMENT/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));

    fireEvent.click(screen.getByRole("button", { name: /Cancel order/i }));
    expect(await screen.findByText(/This cancels Sales Order SO-2026-000042\. It cannot be resumed from here\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Keep order/i }));

    fireEvent.click(screen.getByRole("button", { name: /^Allocate$/i }));
    expect(await screen.findByText(/This computes and records current availability against Sales Order SO-2026-000042's lines\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));

    fireEvent.click(screen.getByRole("button", { name: /Create Service/i }));
    expect(await screen.findByText(/This creates a Work Order to fulfill Sales Order SO-2026-000042/)).toBeTruthy();

    expect(container.textContent).not.toContain("doc-abc123");
  });

  it("action dialog consequence copy shows the honest unavailable fallback for a legacy Sales Order with no salesOrderNumber -- never the document id", async () => {
    useSalesOrder.mockReturnValue(readySalesOrder({ salesOrder: { id: "doc-legacy-xyz", salesOrderNumber: null } }));
    const client = mockCommandClient();
    const { container } = renderAt("doc-legacy-xyz", { actionDeps: { client } });

    fireEvent.click(screen.getByRole("button", { name: /Move to In Fulfillment/i }));
    expect(await screen.findByText(/This moves Sales Order — Reference unavailable from CONFIRMED to IN_FULFILLMENT/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));

    fireEvent.click(screen.getByRole("button", { name: /Cancel order/i }));
    expect(await screen.findByText(/This cancels Sales Order — Reference unavailable\. It cannot be resumed from here\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Keep order/i }));

    fireEvent.click(screen.getByRole("button", { name: /^Allocate$/i }));
    expect(await screen.findByText(/This computes and records current availability against Sales Order — Reference unavailable's lines\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));

    fireEvent.click(screen.getByRole("button", { name: /Create Service/i }));
    expect(await screen.findByText(/This creates a Work Order to fulfill Sales Order — Reference unavailable/)).toBeTruthy();

    expect(container.textContent).not.toContain("doc-legacy-xyz");
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

describe("SalesOrderDetail -- write-capability gating (regression: read-only principal saw live write buttons)", () => {
  // A principal holding salesOrder.read but none of salesOrder.write/.fulfill/.service
  // (salesManager, accountingManager, financeManager per
  // functions/src/access/governedBusinessRoles.ts) must NEVER see a live, clickable action button --
  // the buttons must render disabled/protected with an honest reason, not hidden and not live.
  it("with NO capability signal injected (fail-closed default), every offered action is disabled and honest -- clicking does nothing", () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    // No `hasCapability` prop at all -- this is what production renders before the connected
    // wrapper's real feed resolves, and what any caller that forgets to wire capabilities gets.
    render(
      <MemoryRouter initialEntries={["/customers/opportunities/sales-order/SO-42"]}>
        <Routes>
          <Route
            path="/customers/opportunities/sales-order/:salesOrderId"
            element={<SalesOrderDetail actionDeps={{ client }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    const advanceBtn = screen.getByRole("button", { name: /Move to In Fulfillment/i });
    const cancelBtn = screen.getByRole("button", { name: /Cancel order/i });
    const allocateBtn = screen.getByRole("button", { name: /^Allocate$/i });
    const serviceBtn = screen.getByRole("button", { name: /Create Service/i });

    for (const btn of [advanceBtn, cancelBtn, allocateBtn, serviceBtn]) {
      expect(btn.disabled).toBe(true);
    }
    expect(screen.getAllByText(/You are not authorized to perform this action on this Sales Order\./i).length).toBe(4);

    // Clicking a disabled/protected action button must never open its confirm dialog.
    fireEvent.click(advanceBtn);
    expect(screen.queryByText(/This moves Sales Order/)).toBeNull();
    fireEvent.click(allocateBtn);
    expect(screen.queryByText(/This computes and records current availability/)).toBeNull();

    expect(client.transitionSalesOrder).not.toHaveBeenCalled();
    expect(client.allocateSalesOrder).not.toHaveBeenCalled();
    expect(client.createServiceForSalesOrder).not.toHaveBeenCalled();
  });

  it("a read-only principal (salesOrder.read granted, write/fulfill/service NOT granted) sees the same honest-disabled buttons", () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    // Mirrors what the real resolveEffectiveAccessCallable feed returns for salesManager /
    // accountingManager / financeManager: salesOrder.read decides elsewhere (the read already
    // succeeded, which is why this component mounted at all); none of the write capabilities decide
    // true here.
    const hasCapability = (id) => false;
    renderAt("SO-42", { actionDeps: { client }, hasCapability });

    expect(screen.getByRole("button", { name: /Move to In Fulfillment/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Cancel order/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /^Allocate$/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Create Service/i }).disabled).toBe(true);
  });

  it("a principal granted ONLY salesOrder.fulfill sees Allocate live but Advance/Cancel/Create Service still protected", () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    const hasCapability = (id) => id === "salesOrder.fulfill";
    renderAt("SO-42", { actionDeps: { client }, hasCapability });

    expect(screen.getByRole("button", { name: /^Allocate$/i }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /Move to In Fulfillment/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Cancel order/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Create Service/i }).disabled).toBe(true);
  });

  it("a principal granted every write capability sees all offered actions live, and Advance still works end to end", async () => {
    useSalesOrder.mockReturnValue(readySalesOrder());
    const client = mockCommandClient();
    client.transitionSalesOrder.mockResolvedValue({ result: { success: true, replayed: false, salesOrderId: "SO-42", state: "IN_FULFILLMENT" } });
    const hasCapability = () => true;
    renderAt("SO-42", { actionDeps: { client }, hasCapability });

    const advanceBtn = screen.getByRole("button", { name: /Move to In Fulfillment/i });
    expect(advanceBtn.disabled).toBe(false);
    fireEvent.click(advanceBtn);
    fireEvent.click(await screen.findByRole("button", { name: /^Advance$/i }));
    await waitFor(() => expect(client.transitionSalesOrder).toHaveBeenCalledTimes(1));
  });
});
