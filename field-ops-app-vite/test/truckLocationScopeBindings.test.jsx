// ADMINISTRATION > WAREHOUSE RACKING > TRUCK LOCATION WAREHOUSE SCOPE (Controller ruling DQ-029).
//
// The section decides nothing: every read and change is one Administration configuration operation on the
// /admin/policy transport, gated by the server. These proofs pin that it sends the right closed names, renders a
// FORBIDDEN as a refusal (never as an empty list), shows NO_BINDING as the fail-closed state it is, and cannot
// send a change without a stated reason.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import TruckLocationScopeBindings from "../src/modules/administration/TruckLocationScopeBindings.jsx";

afterEach(cleanup);

const LIST = {
  locations: [
    { locationId: "truck-a", displayLabel: "Truck A", operatingCompanyKey: "k", active: true, state: "BOUND", scopeWarehouseId: "WH-1", current: { id: "b1" } },
    { locationId: "truck-b", displayLabel: "Truck B", operatingCompanyKey: "k", active: true, state: "NO_BINDING", scopeWarehouseId: null, current: null },
  ],
};

const api = (over = {}) => vi.fn(async (operation, input) => {
  if (over[operation]) return over[operation](input);
  if (operation === "listMobileLocationScopeBindings") return { ok: true, data: LIST };
  return { ok: false, code: "INTERNAL", message: "unexpected" };
});

describe("TruckLocationScopeBindings", () => {
  it("lists bindings through the configuration operation and shows NO_BINDING as the fail-closed state", async () => {
    const call = api();
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText("Truck A");
    expect(call).toHaveBeenCalledWith("listMobileLocationScopeBindings", {});
    expect(screen.getByText("No binding — truck operations refused")).toBeTruthy();
    expect(screen.getByText("WH-1")).toBeTruthy();
  });

  it("renders a server FORBIDDEN as a refusal naming the capability, not as an empty list", async () => {
    const call = api({ listMobileLocationScopeBindings: async () => ({ ok: false, code: "FORBIDDEN", message: "no" }) });
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText(/inventory\.location\.scopeBinding\.manage/);
    expect(screen.queryByText(/No truck inventory locations/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders NOT_CONFIGURED as that state", async () => {
    const call = api({ listMobileLocationScopeBindings: async () => ({ ok: false, code: "NOT_CONFIGURED", message: "x" }) });
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText(/not configured for this environment/);
  });

  it("a change cannot be sent without a reason, and sends locationId + warehouseId + reason", async () => {
    const set = vi.fn(async (input) => ({ ok: true, data: { outcome: "CHANGED", locationId: input.locationId, previousWarehouseId: "WH-1", warehouseId: input.warehouseId } }));
    const call = api({ setMobileLocationScopeBinding: set });
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText("Truck A");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const save = screen.getByRole("button", { name: "Save Binding" });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Warehouse/), { target: { value: "WH-2" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "moved base" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await screen.findByText(/WH-1 → WH-2\. Applies to future operations only\./);
    expect(set).toHaveBeenCalledWith({ locationId: "truck-a", warehouseId: "WH-2", reason: "moved base" });
  });

  it("remove states the consequence and shows a server refusal as a refusal", async () => {
    const remove = vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "no" }));
    const call = api({ removeMobileLocationScopeBinding: remove });
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText("Truck A");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/will be refused until a new binding is set/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "retired" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Binding" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ locationId: "truck-a", reason: "retired" }));
    await screen.findByText(/does not currently hold/);
  });

  it("History reads the explanation through readMobileLocationScopeBinding", async () => {
    const read = vi.fn(async () => ({ ok: true, data: { explanation: "Acts at this truck location are authorized under warehouse WH-1's operational scope.", history: [{ id: "b1", warehouseId: "WH-1", effectiveFrom: "2026-09-28T00:00:00.000Z", effectiveTo: null, reason: "based" }] } }));
    const call = api({ readMobileLocationScopeBinding: read });
    render(<TruckLocationScopeBindings callApi={call} />);
    await screen.findByText("Truck A");
    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    await screen.findByText(/authorized under warehouse WH-1/);
    expect(read).toHaveBeenCalledWith({ locationId: "truck-a" });
  });

  it("holds no capability decision and no Firebase access of its own", () => {
    const src = readFileSync("src/modules/administration/TruckLocationScopeBindings.jsx", "utf8");
    expect(src).not.toMatch(/from ["'][^"']*firebase/);
    expect(src).not.toMatch(/hasCapability|operationalContext|isAdmin|roleKey/);
  });
});
