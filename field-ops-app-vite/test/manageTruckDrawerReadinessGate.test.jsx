// Site-work r4 truck-gate -- deactivateTruck and deleteTruckCreatedInError are guaranteed
// to fail-closed on every backend call today (no governed inventory-presence probe / no
// governed 11-authority operational-reference persistence). This proves ManageTruckDrawer
// disables (never hides) exactly those two destructive controls behind their OWN dedicated
// readiness flags (TRUCK_DEACTIVATE_READY / TRUCK_DELETE_READY), independent of the broader
// TRUCK_MANAGEMENT_WRITE_READY seam, and that every other governed control is unaffected.
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import ManageTruckDrawer from "../src/modules/inventory/truckManagement/ManageTruckDrawer.jsx";
import { TRUCK_COMMAND_OUTCOME, DEACTIVATED_STATUS } from "../src/domain/truckManagement.js";

afterEach(cleanup);

const record = {
  truckId: "TRK-101",
  version: 1,
  displayLabel: "Truck 101",
  vehicleNumber: "V-101",
  status: "ACTIVE",
  assignedDriverEmployeeId: "EMP-1",
  homeWarehouseId: "WH-CENTRAL",
};

const noOptions = () => ({ options: [], loading: false, error: false });
const withOptions = (opts) => () => ({ options: opts, loading: false, error: false });

function makeCommands(overrides = {}) {
  const ok = vi.fn(async () => ({ kind: TRUCK_COMMAND_OUTCOME.OK }));
  return {
    assignDriver: ok, reassignDriver: ok, unassignDriver: ok,
    changeStatus: ok, changeHomeWarehouse: ok,
    deactivateTruck: vi.fn(async () => ({ kind: TRUCK_COMMAND_OUTCOME.OK })),
    reactivateTruck: ok,
    deleteTruckCreatedInError: vi.fn(async () => ({ kind: TRUCK_COMMAND_OUTCOME.OK })),
    ...overrides,
  };
}

function renderDrawer({ isAdmin = true, writeReady = true, commands } = {}) {
  return render(
    <ManageTruckDrawer
      record={record}
      driverName="Alex Rivera"
      commands={commands ?? makeCommands()}
      writeReady={writeReady}
      isAdmin={isAdmin}
      useDriverOptions={withOptions([{ value: "EMP-1", label: "Alex Rivera" }, { value: "EMP-2", label: "Sam Okafor" }])}
      useWarehouseOptions={withOptions([{ value: "WH-CENTRAL", label: "Central" }, { value: "WH-SOUTH", label: "South" }])}
      onClose={vi.fn()}
      onReconcile={vi.fn()}
    />
  );
}

describe("dedicated deactivate/delete readiness gate (flags false -- current registry default)", () => {
  // No vi.mock override: the repo's own config/environments.json defaults BOTH new flags
  // false in every environment, and vitest.config.js's __APP_READINESS__ doesn't declare
  // them at all -- proving the "absent flag fails closed" contract end-to-end, not just a
  // mocked one.
  it("deactivate confirm renders DISABLED with the explanation, while status-change to other targets stays enabled", async () => {
    const commands = makeCommands();
    renderDrawer({ commands });
    const select = screen.getByLabelText(/^Status$/);
    fireEvent.change(select, { target: { value: DEACTIVATED_STATUS } });
    fireEvent.click(screen.getByRole("button", { name: "Update status" }));

    const confirmBtn = await screen.findByRole("button", { name: "Confirm deactivate" });
    expect(confirmBtn.disabled).toBe(true);
    expect(screen.getByTestId("tm-deactivate-unavailable").textContent).toMatch(
      /unavailable until inventory-at-location verification is enabled/i
    );
    fireEvent.click(confirmBtn);
    expect(commands.deactivateTruck).not.toHaveBeenCalled();
  });

  it("delete (created-in-error) renders DISABLED with the explanation for an admin", () => {
    renderDrawer({ isAdmin: true });
    const del = screen.getByTestId("tm-delete-cie");
    expect(del.disabled).toBe(true);
    expect(screen.getByTestId("tm-delete-unavailable").textContent).toMatch(
      /unavailable until operational-reference verification is enabled/i
    );
    // Disabled, not hidden: the control and danger zone remain visible.
    expect(screen.getByTestId("tm-danger-zone")).toBeTruthy();
  });

  it("every other governed action stays enabled exactly as today", () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText(/Employee/), { target: { value: "EMP-2" } });
    expect(screen.getByRole("button", { name: "Reassign driver" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Unassign driver" }).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/Warehouse/), { target: { value: "WH-SOUTH" } });
    expect(screen.getByRole("button", { name: "Update home warehouse" }).disabled).toBe(false);
    // Status select still permits choosing a non-deactivate target and updating.
    fireEvent.change(screen.getByLabelText(/^Status$/), { target: { value: "IDLE" } });
    expect(screen.getByRole("button", { name: "Update status" }).disabled).toBe(false);
  });

  it("writeReady=false still disables everything as before (broad seam unaffected by the new dedicated flags)", () => {
    renderDrawer({ writeReady: false });
    expect(screen.getByTestId("truck-management-not-ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unassign driver" }).disabled).toBe(true);
    expect(screen.getByTestId("tm-delete-cie").disabled).toBe(true);
  });
});
