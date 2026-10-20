// SALES ORDER ALLOCATION CONTROL (S1c; DECISIONS #S1c): the screen offers exactly what the server's read states and decides nothing.
//
//   * a HOLDER (the server says canRelease) sees the warehouse choice, per-line figures, a quantity, Allocate and Release; a NON-holder sees the figures only;
//   * the company is the order's own, stated back to the server with the warehouse the caller chose; neither is derived;
//   * a refusal is shown in the SERVER'S OWN WORDS and nothing is changed on screen; a retry of the same attempt reuses its key, a new attempt does not;
//   * Release needs a reason; a blank quantity releases everything the line holds at that warehouse;
//   * every honest state: denied, unavailable (with a retry), no PART line (nothing to show).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import SalesOrderAllocation from "../src/modules/sales/SalesOrderAllocation.jsx";

afterEach(cleanup);

const data = (over = {}) => ({
  salesOrderId: "so-1", operatingCompanyId: "co-a-id", state: "CONFIRMED", canAllocate: true, canRelease: true,
  warehouses: [{ warehouseId: "wh-a1", name: "Main warehouse", active: true }, { warehouseId: "wh-a2", name: "Annex", active: true }, { warehouseId: "wh-old", name: "Closed", active: false }],
  lines: [
    { lineNumber: 1, kind: "PART", partId: "P-100", orderedQty: 6, allocatedTotal: 2, byWarehouse: [{ warehouseId: "wh-a1", allocated: 2 }], heldOutsideYourScope: 0 },
    { lineNumber: 2, kind: "SERVICE", partId: null, orderedQty: 1, allocatedTotal: 0, byWarehouse: [], heldOutsideYourScope: 0 },
    { lineNumber: 3, kind: "PART", partId: "P-200", orderedQty: 4, allocatedTotal: 1, byWarehouse: [], heldOutsideYourScope: 1 },
  ],
  ...over,
});
const client = (read = data(), over = {}) => ({
  readSalesOrderAllocations: vi.fn(async () => (read.errorStatus ? read : { result: read })),
  allocateSalesOrder: vi.fn(async () => ({ result: { outcome: "allocated" } })),
  releaseSalesOrderAllocation: vi.fn(async () => ({ result: { outcome: "released" } })),
  ...over,
});
const mount = async (c, props = {}) => {
  const view = render(<SalesOrderAllocation salesOrderId="so-1" client={c} {...props} />);
  await screen.findByRole("table", { name: "Allocation by line" });
  return view;
};
const qty = (n, value) => fireEvent.change(screen.getByLabelText(`Quantity for line ${n}`), { target: { value } });
// The controls are disabled while a command is in flight: wait for the screen to settle before the next gesture.
const ready = () => waitFor(() => expect(screen.getByLabelText("Quantity for line 1").disabled).toBe(false));

describe("SalesOrderAllocation", () => {
  it("a holder sees the warehouse choice, the PART lines only, and the figures the server stated", async () => {
    await mount(client());
    expect(screen.getByLabelText("Warehouse").querySelectorAll("option").length).toBe(2); // the closed warehouse is never offered
    const rows = within(screen.getByRole("table", { name: "Allocation by line" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2); // the SERVICE line is not stock
    expect(rows[0].textContent).toMatch(/P-100/);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent).slice(2, 5)).toEqual(["6", "2", "2"]); // ordered, allocated, at Main warehouse
    expect(rows[1].textContent).toMatch(/1 at warehouses outside your scope/);
  });

  it("Allocate states the line, the order's company, the CHOSEN warehouse, the Part, the quantity and a key; then re-reads and reports", async () => {
    const c = client();
    const onChanged = vi.fn();
    await mount(c, { onChanged });
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "wh-a2" } });
    expect(screen.getByRole("button", { name: "Allocate line 1" }).disabled).toBe(true); // no quantity yet
    qty(1, "3");
    fireEvent.click(screen.getByRole("button", { name: "Allocate line 1" }));
    await waitFor(() => expect(c.allocateSalesOrder).toHaveBeenCalledTimes(1));
    const sent = c.allocateSalesOrder.mock.calls[0][0];
    expect(sent).toMatchObject({ salesOrderId: "so-1", lineNumber: 1, operatingCompanyId: "co-a-id", warehouseId: "wh-a2", partId: "P-100", quantity: 3 });
    expect(typeof sent.idempotencyKey).toBe("string");
    expect(sent.idempotencyKey.length).toBeGreaterThan(8);
    expect((await screen.findByRole("status")).textContent).toMatch(/Allocated 3 to line 1/);
    await waitFor(() => expect(c.readSalesOrderAllocations).toHaveBeenCalledTimes(2)); // the SERVER's new figures, never invented here
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a refusal is shown in the server's own words; the retry of the SAME attempt reuses its key; a new attempt gets a new one", async () => {
    const refusal = { errorStatus: "failed-precondition", message: "the line orders 6 and already holds 2; at most 4 more can be allocated" };
    const c = client(data(), { allocateSalesOrder: vi.fn().mockResolvedValueOnce(refusal).mockResolvedValueOnce(refusal).mockResolvedValue({ result: { outcome: "allocated" } }) });
    await mount(c);
    qty(1, "5");
    const button = () => screen.getByRole("button", { name: "Allocate line 1" });
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe(refusal.message);
    await ready();
    expect(c.readSalesOrderAllocations).toHaveBeenCalledTimes(1); // a refusal changes nothing on screen
    fireEvent.click(button());
    await waitFor(() => expect(c.allocateSalesOrder).toHaveBeenCalledTimes(2));
    expect(c.allocateSalesOrder.mock.calls[1][0].idempotencyKey).toBe(c.allocateSalesOrder.mock.calls[0][0].idempotencyKey);
    await ready();
    qty(1, "4"); // a different quantity is a different attempt
    fireEvent.click(button());
    await waitFor(() => expect(c.allocateSalesOrder).toHaveBeenCalledTimes(3));
    expect(c.allocateSalesOrder.mock.calls[2][0].idempotencyKey).not.toBe(c.allocateSalesOrder.mock.calls[0][0].idempotencyKey);
    await screen.findByRole("status");
    await ready();
    // After SUCCESS the key is dropped: the next click of the same quantity is a new intent.
    qty(1, "4");
    fireEvent.click(button());
    await waitFor(() => expect(c.allocateSalesOrder).toHaveBeenCalledTimes(4));
    expect(c.allocateSalesOrder.mock.calls[3][0].idempotencyKey).not.toBe(c.allocateSalesOrder.mock.calls[2][0].idempotencyKey);
  });

  it("a REPLAYED answer is not reported as an allocation or a release: it says nothing changed, and the figures are still re-read", async () => {
    const c = client(data(), {
      allocateSalesOrder: vi.fn(async () => ({ result: { outcome: "replayed" } })),
      releaseSalesOrderAllocation: vi.fn(async () => ({ result: { outcome: "replayed" } })),
    });
    await mount(c);
    qty(1, "2");
    fireEvent.click(screen.getByRole("button", { name: "Allocate line 1" }));
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/already done; nothing changed/);
    expect(note.textContent).not.toMatch(/Allocated 2/);
    await waitFor(() => expect(c.readSalesOrderAllocations).toHaveBeenCalledTimes(2));
    await ready();
    fireEvent.change(screen.getByLabelText("Reason (required to release)"), { target: { value: "r" } });
    fireEvent.click(screen.getByRole("button", { name: "Release line 1" }));
    await waitFor(() => expect(c.releaseSalesOrderAllocation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/already done; nothing changed/));
    expect(screen.getByRole("status").textContent).not.toMatch(/Released the allocation/);
  });

  it("a failure the platform did not govern says nothing specific", async () => {
    const c = client(data(), { allocateSalesOrder: vi.fn(async () => ({ errorStatus: "unavailable" })) });
    await mount(c);
    qty(1, "1");
    fireEvent.click(screen.getByRole("button", { name: "Allocate line 1" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The request could not be completed. Try again.");
  });

  it("Release needs a reason; a blank quantity releases everything at the chosen warehouse, a quantity releases that much", async () => {
    const c = client();
    await mount(c);
    const release = () => screen.getByRole("button", { name: "Release line 1" });
    expect(release().disabled).toBe(true); // no reason
    fireEvent.change(screen.getByLabelText("Reason (required to release)"), { target: { value: "customer changed the order" } });
    expect(release().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Release line 3" }).disabled).toBe(true); // line 3 holds nothing at the chosen warehouse
    fireEvent.click(release());
    await waitFor(() => expect(c.releaseSalesOrderAllocation).toHaveBeenCalledTimes(1));
    const first = c.releaseSalesOrderAllocation.mock.calls[0][0];
    expect(first).toMatchObject({ salesOrderId: "so-1", lineNumber: 1, operatingCompanyId: "co-a-id", warehouseId: "wh-a1", reason: "customer changed the order" });
    expect("quantity" in first).toBe(false);
    await screen.findByRole("status");
    await ready();
    qty(1, "1");
    fireEvent.click(release());
    await waitFor(() => expect(c.releaseSalesOrderAllocation).toHaveBeenCalledTimes(2));
    expect(c.releaseSalesOrderAllocation.mock.calls[1][0].quantity).toBe(1);
  });

  it("a NON-holder sees the figures and is offered nothing: no warehouse, no quantity, no buttons", async () => {
    await mount(client(data({ canAllocate: false, canRelease: false, warehouses: [] })));
    expect(screen.queryByLabelText("Warehouse")).toBeNull();
    expect(screen.queryByRole("button", { name: /Allocate|Release/ })).toBeNull();
    expect(screen.queryByLabelText(/Quantity for line/)).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/needs the Sales Order fulfillment permission/);
    expect(screen.getByRole("table", { name: "Allocation by line" }).textContent).toMatch(/P-100/);
  });

  it("a holder of a terminal order can release but is offered no Allocate; one with no warehouse in scope is told so", async () => {
    await mount(client(data({ state: "CANCELLED", canAllocate: false })));
    expect(screen.queryByRole("button", { name: /^Allocate line/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Release line 1" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/not open to new allocations/);
    cleanup();
    await mount(client(data({ canAllocate: false, warehouses: [] })));
    expect(screen.getByRole("note").textContent).toMatch(/None of your warehouses belong to this order's company/);
    expect(screen.queryByRole("button", { name: /^Allocate line/ })).toBeNull();
  });

  it("an allocated line is not offered more than the server's own bound allows to attempt: a full line has Allocate disabled", async () => {
    const full = data();
    full.lines[0] = { ...full.lines[0], allocatedTotal: 6 };
    await mount(client(full));
    qty(1, "1");
    expect(screen.getByRole("button", { name: "Allocate line 1" }).disabled).toBe(true);
  });

  it("denied and unavailable are different answers; unavailable offers a retry; an order with no PART line renders nothing", async () => {
    const denied = client({ errorStatus: "permission-denied" });
    render(<SalesOrderAllocation salesOrderId="so-1" client={denied} />);
    expect(await screen.findByText(/not authorized to see the stock allocated/)).toBeTruthy();
    cleanup();

    const down = client({ errorStatus: "unavailable" });
    render(<SalesOrderAllocation salesOrderId="so-1" client={down} />);
    const retry = await screen.findByRole("button", { name: "Try Again" });
    fireEvent.click(retry);
    await waitFor(() => expect(down.readSalesOrderAllocations).toHaveBeenCalledTimes(2));
    cleanup();

    const none = client(data({ lines: [{ lineNumber: 1, kind: "SERVICE", partId: null, orderedQty: 1, allocatedTotal: 0, byWarehouse: [], heldOutsideYourScope: 0 }] }));
    const { container } = render(<SalesOrderAllocation salesOrderId="so-1" client={none} />);
    await waitFor(() => expect(none.readSalesOrderAllocations).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("a retained key never crosses to another Sales Order", async () => {
    const refusal = { errorStatus: "failed-precondition", message: "refused" };
    const c = client(data(), { allocateSalesOrder: vi.fn(async () => refusal) });
    const view = await mount(c);
    qty(1, "2");
    fireEvent.click(screen.getByRole("button", { name: "Allocate line 1" }));
    await screen.findByRole("alert");
    await ready();
    view.rerender(<SalesOrderAllocation salesOrderId="so-2" client={c} />);
    await waitFor(() => expect(c.readSalesOrderAllocations).toHaveBeenCalledTimes(2));
    await ready();
    qty(1, "2");
    fireEvent.click(screen.getByRole("button", { name: "Allocate line 1" }));
    await waitFor(() => expect(c.allocateSalesOrder).toHaveBeenCalledTimes(2));
    expect(c.allocateSalesOrder.mock.calls[1][0].salesOrderId).toBe("so-2");
    expect(c.allocateSalesOrder.mock.calls[1][0].idempotencyKey).not.toBe(c.allocateSalesOrder.mock.calls[0][0].idempotencyKey);
  });
});
