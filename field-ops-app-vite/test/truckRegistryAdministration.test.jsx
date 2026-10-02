// OD-T7 (Truck Inventory activation, 2026-10-01): the Administration truck registry section. It decides nothing: every
// read and change goes to /admin/policy with a stated reason, and a refusal is rendered as the server's answer.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TruckRegistry from "../src/modules/administration/TruckRegistry.jsx";

const TRUCK = { truckId: "trk-1", vehicleNumber: "T-101", displayLabel: "Taylor Truck 1", status: "ACTIVE", active: true, homeWarehouseId: "taylor-main",
  mobileLocation: { type: "MOBILE", locationId: "mob-1", displayLabel: "Truck 1 stock", active: true }, operatingCompanyKey: "taylor",
  operatingCompanyId: "taylor", boundWarehouseId: "taylor-main", scopedEmployeeIds: ["e-tech-a"] };

describe("TruckRegistry (Administration)", () => {
  it("lists the registry and sends a status change with its reason", async () => {
    const callApi = vi.fn(async (op) => {
      if (op === "listTrucks") return { ok: true, data: { trucks: [TRUCK] } };
      if (op === "listMobileLocations") return { ok: true, data: { mobileLocations: [] } };
      return { ok: true, data: { outcome: "CHANGED" } };
    });
    render(<TruckRegistry callApi={callApi} />);
    await screen.findByText(/Taylor Truck 1/);
    expect(screen.getByText("e-tech-a")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "seasonal" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark idle" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("changeTruckStatus", { truckId: "trk-1", status: "IDLE", reason: "seasonal" }));
  });

  it("renders the server's refusal instead of a registry", async () => {
    const callApi = vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "nope" }));
    render(<TruckRegistry callApi={callApi} />);
    await screen.findByText(/inventory.truckRegistry.manage/);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
