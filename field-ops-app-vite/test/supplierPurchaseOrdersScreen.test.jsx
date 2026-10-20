// Purchasing > Purchase Orders > Supplier purchase orders (P-1; DECISIONS #P-1; Owner ruling D): the screen offers exactly what the server allows.
//
//   * the view is offered only to a holder of supplier.purchaseOrder.read; everyone else sees the page as it was, with no switcher;
//   * every control is offered only to a holder of its own capability AND only when the server's `allowed` flags say so (status; the creator
//     never approves their own order);
//   * a cancellation states its reason; a refusal is shown in the server's own words and the order is not changed on screen;
//   * Raise: one supplier, the buyer's own requests, one receiving warehouse (the first pick fixes it), an optional price in dollars and cents,
//     the caller's idempotency key sent once per attempt;
//   * the Reorder purchase orders view no longer reads a request ordered on a supplier PO as an ORPHAN.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const requestsState = { data: [], loading: false, error: null };
const purchaseOrdersState = { purchaseOrdersById: {}, loading: false, error: null };
vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestsByStatuses: () => requestsState }));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => purchaseOrdersState }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", async () => {
  const actual = await vi.importActual("../src/domain/actorDisplayName");
  return { useGovernedEmployeeDirectory: () => ({ byUserId: new Map([["p-buyer", { id: "p-buyer", displayName: "Bea Buyer" }]]) }), resolveActorDisplayName: actual.resolveActorDisplayName };
});

const { default: PurchaseOrdersWorkspace } = await import("../src/modules/purchasing/PurchaseOrdersWorkspace.jsx");
const { default: SupplierPurchaseOrders, toMinorUnits, formatMinorPrice } = await import("../src/modules/purchasing/SupplierPurchaseOrders.jsx");
const { default: PurchaseOrders } = await import("../src/modules/purchasing/PurchaseOrders.jsx");
const { SUPPLIER_PURCHASE_ORDER_GATE: GATE } = await import("../src/access/shellCapabilityGates.js");

const has = (...keys) => (key) => keys.includes(key);
const summary = (over = {}) => ({
  purchaseOrderId: "spo-1", externalPoNumber: "SPO-2026-000001", status: "DRAFT", version: 0, operatingCompanyKey: "sample-co", supplierId: "SUP-A", supplierName: "Acme Supply",
  receivingWarehouseId: "wh-1", lineCount: 2, orderedQuantity: 16, receivedQuantity: 0, createdBy: "p-buyer", createdAt: "2026-10-19T15:00:00.000Z", ...over,
});
const detail = (over = {}) => ({
  ...summary(), approvedBy: null, approvedAt: null, sentBy: null, sentAt: null, cancelledBy: null, cancelledAt: null, cancellationReason: null, receivable: false,
  allowed: { approve: true, send: false, cancel: true },
  lines: [
    { lineId: "L1", partId: "PART-A", orderedQuantity: 10, receivedQuantity: 0, reorderRequestId: "rr-1", reorderRequestNumber: "RR-2026-000001", unitPriceMinor: 1235, currency: "USD", linkReleased: false },
    { lineId: "L2", partId: "PART-B", orderedQuantity: 6, receivedQuantity: 0, reorderRequestId: "rr-2", reorderRequestNumber: null, unitPriceMinor: null, currency: null, linkReleased: false },
  ],
  ...over,
});
const fakeClient = (over = {}) => ({
  listOrders: vi.fn(async () => ({ ok: true, purchaseOrders: [summary()] })),
  readOrder: vi.fn(async () => ({ ok: true, order: detail() })),
  listPurchasable: vi.fn(async () => ({
    ok: true,
    suppliers: [{ supplierId: "SUP-A", name: "Acme Supply" }],
    requests: [
      { reorderRequestId: "rr-1", reorderRequestNumber: "RR-2026-000001", partId: "PART-A", warehouseId: "wh-1", warehouseName: "Main", operatingCompanyKey: "sample-co", requestedQuantity: 10, defaultUnitPriceMinor: 1235, defaultCurrency: "USD" },
      { reorderRequestId: "rr-2", reorderRequestNumber: null, partId: "PART-B", warehouseId: "wh-1", warehouseName: "Main", operatingCompanyKey: "sample-co", requestedQuantity: 6, defaultUnitPriceMinor: null, defaultCurrency: null },
      { reorderRequestId: "rr-3", reorderRequestNumber: null, partId: "PART-C", warehouseId: "wh-2", warehouseName: "Annex", operatingCompanyKey: "sample-co", requestedQuantity: 2, defaultUnitPriceMinor: null, defaultCurrency: null },
    ],
  })),
  createOrder: vi.fn(async () => ({ ok: true, replayed: false, order: { purchaseOrderId: "spo-2", externalPoNumber: "SPO-2026-000002" } })),
  transitionOrder: vi.fn(async () => ({ ok: true, replayed: false, result: { status: "APPROVED", version: 1 } })),
  ...over,
});
const renderScreen = (hasCapability, client) => render(<MemoryRouter><SupplierPurchaseOrders hasCapability={hasCapability} client={client} /></MemoryRouter>);

beforeEach(() => { requestsState.data = []; });

describe("the pure helpers", () => {
  it("prices are whole minor units: dollars and cents in, never a rounded surprise; unknown is said, never zero", () => {
    expect(toMinorUnits("12.5")).toBe(1250);
    expect(toMinorUnits("12.50")).toBe(1250);
    expect(toMinorUnits("12")).toBe(1200);
    expect(toMinorUnits("0.05")).toBe(5);
    for (const bad of ["", "1.234", "-1", "1,000", "abc", "12.", ".5"]) expect(toMinorUnits(bad)).toBeNull();
    expect(formatMinorPrice(1235, "USD")).toBe("USD 12.35");
    expect(formatMinorPrice(0, "USD")).toBe("USD 0.00");
    expect(formatMinorPrice(null, null)).toBe("Price not stated");
  });
});

describe("the workspace offers the supplier view only to a reader", () => {
  it("without supplier.purchaseOrder.read the page is exactly as it was: no switcher", () => {
    render(<MemoryRouter><PurchaseOrdersWorkspace hasCapability={has(GATE.create)} client={fakeClient()} /></MemoryRouter>);
    expect(screen.getByText("No purchase orders yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Supplier purchase orders" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recorded orders" })).toBeNull();
  });

  it("a supplier-only holder (Parts Associate / Parts Manager: no reorder.purchaseOrder.read) sees the supplier view alone: no switcher, no recorded list", async () => {
    render(<MemoryRouter><PurchaseOrdersWorkspace hasCapability={has(GATE.read)} client={fakeClient()} /></MemoryRouter>);
    const table = await screen.findByRole("table", { name: "Supplier purchase orders" });
    expect(within(table).getByText("SPO-2026-000001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recorded orders" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supplier purchase orders" })).toBeNull();
    expect(screen.queryByText("No purchase orders yet")).toBeNull();
  });

  it("with both reads, the switcher appears and the supplier view lists the orders", async () => {
    const client = fakeClient();
    render(<MemoryRouter><PurchaseOrdersWorkspace hasCapability={has(GATE.read, GATE.recordedRead)} client={client} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Supplier purchase orders" }));
    const table = await screen.findByRole("table", { name: "Supplier purchase orders" });
    expect(within(table).getByText("SPO-2026-000001")).toBeTruthy();
    expect(within(table).getByText("Acme Supply")).toBeTruthy();
    expect(within(table).getByText("Bea Buyer")).toBeTruthy();
  });
});

describe("the list", () => {
  it("states an empty list as empty, a refusal as a refusal, and an outage as an outage", async () => {
    renderScreen(has(GATE.read), fakeClient({ listOrders: vi.fn(async () => ({ ok: true, purchaseOrders: [] })) }));
    expect(await screen.findByText("No supplier purchase orders yet")).toBeTruthy();
  });
  it("denied", async () => {
    renderScreen(has(GATE.read), fakeClient({ listOrders: vi.fn(async () => ({ ok: false, outcome: "denied", message: "this requires supplier.purchaseOrder.read" })) }));
    expect(await screen.findByText("Supplier purchase orders unavailable")).toBeTruthy();
    expect(screen.getByText(/does not include viewing supplier purchase orders/)).toBeTruthy();
  });
  it("unavailable shows no server text", async () => {
    renderScreen(has(GATE.read), fakeClient({ listOrders: vi.fn(async () => ({ ok: false, outcome: "unavailable", reason: null })) }));
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  });
  it("filters by view: Open holds a draft, Received holds none", async () => {
    renderScreen(has(GATE.read), fakeClient());
    expect(await screen.findByText("SPO-2026-000001")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Received/ }));
    expect(screen.queryByText("SPO-2026-000001")).toBeNull();
    expect(screen.getByText("No matching orders")).toBeTruthy();
  });
});

describe("controls are offered only to capability holders, narrowed by the server's own flags", () => {
  const open = async (hasCapability, client) => {
    renderScreen(hasCapability, client);
    fireEvent.click(await screen.findByRole("button", { name: "SPO-2026-000001" }));
    await screen.findByRole("region", { name: /Order SPO-2026-000001/ });
  };

  it("a reader with no action capability sees the order and no control", async () => {
    await open(has(GATE.read), fakeClient());
    expect(screen.getByText("USD 12.35")).toBeTruthy();
    expect(screen.getByText("Price not stated")).toBeTruthy();
    for (const name of ["Approve", "Mark as sent", "Cancel order"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("button", { name: "Raise supplier purchase order" })).toBeNull();
  });

  it("an approver sees Approve; holding .send does not show Mark as sent on a draft (the server says no)", async () => {
    await open(has(GATE.read, GATE.approve, GATE.send), fakeClient());
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).toBeNull();
  });

  it("the creator holding .approve is NOT offered Approve when the server says allowed.approve is false, and is told why", async () => {
    const client = fakeClient({ readOrder: vi.fn(async () => ({ ok: true, order: detail({ allowed: { approve: false, send: false, cancel: true } }) })) });
    await open(has(GATE.read, GATE.approve), client);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/someone else approves it/)).toBeTruthy();
  });

  it("an allowed flag without the capability offers nothing", async () => {
    await open(has(GATE.read), fakeClient({ readOrder: vi.fn(async () => ({ ok: true, order: detail({ allowed: { approve: true, send: true, cancel: true } }) })) }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("Approve calls the server with the version the screen READ and one key, then re-reads", async () => {
    const client = fakeClient();
    await open(has(GATE.read, GATE.approve), client);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(client.transitionOrder).toHaveBeenCalledTimes(1));
    const call = client.transitionOrder.mock.calls[0][0];
    expect(call).toMatchObject({ purchaseOrderId: "spo-1", action: "APPROVE", expectedVersion: 0 });
    expect(typeof call.idempotencyKey).toBe("string");
    expect("reason" in call).toBe(false);
    await waitFor(() => expect(client.listOrders.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText(/Approved SPO-2026-000001/)).toBeTruthy();
  });

  it("a refusal is shown in the server's own words, and a retry after an outage reuses the SAME key", async () => {
    const transitionOrder = vi.fn()
      .mockResolvedValueOnce({ ok: false, outcome: "unavailable", reason: null })
      .mockResolvedValueOnce({ ok: false, outcome: "conflict", message: "the purchase order changed since it was read" });
    await open(has(GATE.read, GATE.approve), fakeClient({ transitionOrder }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Nothing was changed; try again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("the purchase order changed since it was read")).toBeTruthy();
    expect(transitionOrder.mock.calls[1][0].idempotencyKey).toBe(transitionOrder.mock.calls[0][0].idempotencyKey);
  });

  it("Cancel needs a stated reason, then sends it", async () => {
    const client = fakeClient({ transitionOrder: vi.fn(async () => ({ ok: true, replayed: false, result: { status: "CANCELLED", version: 1 } })) });
    await open(has(GATE.read, GATE.cancel), client);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const confirm = screen.getByRole("button", { name: "Confirm cancellation" });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why is this order cancelled?"), { target: { value: "supplier withdrew the quote" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(client.transitionOrder).toHaveBeenCalledTimes(1));
    expect(client.transitionOrder.mock.calls[0][0]).toMatchObject({ action: "CANCEL", reason: "supplier withdrew the quote", expectedVersion: 0 });
    expect(await screen.findByText(/Its requests are back in purchasing/)).toBeTruthy();
  });

  it("a sent, approved order that can be received says where", async () => {
    await open(has(GATE.read, GATE.send), fakeClient({ readOrder: vi.fn(async () => ({ ok: true, order: detail({ status: "APPROVED", version: 1, receivable: true, allowed: { approve: false, send: true, cancel: true } }) })) }));
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeTruthy();
    expect(screen.getByText(/can be received in Inventory/)).toBeTruthy();
  });
});

describe("raising an order", () => {
  const openForm = async (client) => {
    renderScreen(has(GATE.read, GATE.create), client);
    fireEvent.click(await screen.findByRole("button", { name: "Raise supplier purchase order" }));
    return screen.findByRole("form", { name: "Raise a supplier purchase order" });
  };

  it("the control exists only for a holder of supplier.purchaseOrder.create", async () => {
    renderScreen(has(GATE.read), fakeClient());
    await screen.findByText("SPO-2026-000001");
    expect(screen.queryByRole("button", { name: "Raise supplier purchase order" })).toBeNull();
  });

  it("the first request fixes the warehouse; another warehouse's request is unavailable", async () => {
    const form = await openForm(fakeClient());
    fireEvent.click(within(form).getByLabelText(/PART-A, 10 requested, Main/));
    const other = within(form).getByLabelText(/PART-C, 2 requested, Annex/);
    expect(other.disabled).toBe(true);
    expect(within(form).getByText(/another warehouse: order it separately/)).toBeTruthy();
    expect(within(form).getByLabelText(/PART-B, 6 requested, Main/).disabled).toBe(false);
  });

  it("submits the supplier, the warehouse, whole-unit quantities and a price in minor units, with one key; then selects the new order", async () => {
    const client = fakeClient();
    const form = await openForm(client);
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "SUP-A" } });
    await waitFor(() => expect(client.listPurchasable).toHaveBeenLastCalledWith({ supplierId: "SUP-A" }));
    fireEvent.click(within(form).getByLabelText(/PART-A, 10 requested, Main/));
    fireEvent.click(within(form).getByLabelText(/PART-B, 6 requested, Main/));
    fireEvent.change(within(form).getByLabelText("Quantity for PART-B"), { target: { value: "5" } });
    fireEvent.change(within(form).getByLabelText("Unit price for PART-B"), { target: { value: "25.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Raise order" }));
    await waitFor(() => expect(client.createOrder).toHaveBeenCalledTimes(1));
    const sent = client.createOrder.mock.calls[0][0];
    expect(sent).toMatchObject({ supplierId: "SUP-A", receivingWarehouseId: "wh-1" });
    expect(sent.lines).toEqual([
      { reorderRequestId: "rr-1", orderedQuantity: 10 },
      { reorderRequestId: "rr-2", orderedQuantity: 5, unitPriceMinor: 2550, currency: "USD" },
    ]);
    expect(typeof sent.idempotencyKey).toBe("string");
    expect(await screen.findByText(/Raised SPO-2026-000002 as a draft/)).toBeTruthy();
  });

  it("a malformed price is refused on screen, with no call", async () => {
    const client = fakeClient();
    const form = await openForm(client);
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "SUP-A" } });
    fireEvent.click(within(form).getByLabelText(/PART-A, 10 requested, Main/));
    fireEvent.change(within(form).getByLabelText("Unit price for PART-A"), { target: { value: "12.345" } });
    fireEvent.click(within(form).getByRole("button", { name: "Raise order" }));
    expect(await within(form).findByText(/dollars and cents/)).toBeTruthy();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("the server's refusal is shown in its own words", async () => {
    const client = fakeClient({ createOrder: vi.fn(async () => ({ ok: false, outcome: "forbidden", message: "only the Employee a Reorder Request is assigned to may put it on a purchase order" })) });
    const form = await openForm(client);
    fireEvent.change(within(form).getByLabelText("Supplier"), { target: { value: "SUP-A" } });
    fireEvent.click(within(form).getByLabelText(/PART-A, 10 requested, Main/));
    fireEvent.click(within(form).getByRole("button", { name: "Raise order" }));
    expect(await within(form).findByText(/only the Employee a Reorder Request is assigned to/)).toBeTruthy();
  });

  it("nothing to order is said, not hidden", async () => {
    const form = await (async () => {
      renderScreen(has(GATE.read, GATE.create), fakeClient({ listPurchasable: vi.fn(async () => ({ ok: true, suppliers: [], requests: [] })) }));
      fireEvent.click(await screen.findByRole("button", { name: "Raise supplier purchase order" }));
      return screen.findByText("Nothing to order");
    })();
    expect(form).toBeTruthy();
  });
});

describe("the recorded Reorder purchase orders view", () => {
  it("a request ORDERED on a supplier purchase order is not an ORPHAN there: the server states which requests those are", () => {
    requestsState.data = [
      { id: "rr-1", status: "ORDERED", partId: "PART-A", orderedAt: 1, supplierPurchaseOrderId: "spo-1", supplierPurchaseOrderNumber: "SPO-2026-000001" },
      { id: "rr-9", status: "ORDERED", partId: "PART-Z", orderedAt: 2, supplierPurchaseOrderId: null },
    ];
    render(<MemoryRouter><PurchaseOrders /></MemoryRouter>);
    // rr-9 genuinely has no recorded purchase order: still an integrity exception (not hidden). rr-1 is on a supplier PO: absent from this view.
    fireEvent.click(screen.getByRole("button", { name: /^Needs Attention/ }));
    expect(screen.getByText("PART-Z")).toBeTruthy();
    expect(screen.queryByText("PART-A")).toBeNull();
    expect(screen.getAllByText(/purchase order record could not be read/).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.queryByText("PART-A")).toBeNull();
  });
});
