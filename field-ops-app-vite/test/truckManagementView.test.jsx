// EI Truck Registry -- Truck Management UI render/interaction tests (vitest + jsdom). Uses
// the firebase-free TruckManagementPreview (real workspace + management components + in-memory
// mock client + fixtures) for write flows, and TruckInventory directly for the role gate and
// to prove the pre-existing read states/tabs stay intact.
//
// Site-work r4 truck-gate: deactivateTruck/deleteTruckCreatedInError are now ALSO gated on
// their own dedicated TRUCK_DEACTIVATE_READY / TRUCK_DELETE_READY flags (default false in
// every environment -- see config/environments.json and truckManagementReadiness.js). This
// file's job is exercising the underlying confirm/reason/error-sanitizing command FLOW, which
// is orthogonal to that new gate, so both are mocked true here; the gate itself (disabled +
// explanation when false, everything else unaffected) is covered by the dedicated
// manageTruckDrawerReadinessGate.test.jsx, which deliberately does NOT mock these flags.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import TruckInventory from "../src/modules/inventory/TruckInventory.jsx";
import TruckManagementPreview from "../src/modules/inventory/truckManagement/TruckManagementPreview.jsx";

vi.mock("../src/config/truckManagementReadiness.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, TRUCK_DEACTIVATE_READY: true, TRUCK_DELETE_READY: true };
});

afterEach(cleanup);

const OPTS = { fleetStatus: ["ACTIVE", "IDLE"], equipmentStatus: ["LOADED"], equipmentCondition: [] };
const roRow = (over = {}) => ({
  id: "TRK-204", technician: "Marcus Bell", location: "Downtown", homeWarehouse: "Main WH", status: "ACTIVE",
  metrics: { inventoryValue: null, serializedCount: null, partsCount: null, discrepancies: null, lastReconciliation: null },
  serializedEquipment: [], parts: [], manifest: null, reconciliation: null, activity: [], ...over,
});
const readySource = (trucks = [roRow()]) => ({ connected: true, status: "ready", accessVersion: 1, options: OPTS, trucks });

async function openManage(truckId) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(truckId) }));
  fireEvent.click(await screen.findByTestId("manage-truck"));
  return screen.findByTestId("manage-truck-drawer");
}

describe("role gate (defense-in-depth)", () => {
  it("without canManage: no Add/Manage controls, and the read workspace + tabs are intact", () => {
    render(<TruckInventory source={readySource()} accessVersion={1} />);
    expect(screen.queryByTestId("add-truck")).toBeNull();
    // Read UI still works: open the truck, tabs present.
    fireEvent.click(screen.getByRole("button", { name: /TRK-204/ }));
    expect(screen.queryByTestId("manage-truck")).toBeNull();
    expect(screen.getByRole("tab", { name: "Load Manifest" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Reconciliation" })).toBeTruthy();
  });
});

describe("write-readiness fail-closed", () => {
  it("readiness=false: Add is disabled with the notice, drawer actions disabled, NO callable", async () => {
    const client = {
      createTruck: vi.fn(), assignDriver: vi.fn(), reassignDriver: vi.fn(), unassignDriver: vi.fn(),
      changeStatus: vi.fn(), changeHomeWarehouse: vi.fn(), deactivateTruck: vi.fn(), reactivateTruck: vi.fn(),
    };
    render(<TruckManagementPreview writeReady={false} client={client} />);
    const add = screen.getByTestId("add-truck");
    expect(add.disabled).toBe(true);
    expect(add.textContent).toMatch(/not yet enabled/i);

    const drawer = await openManage("TRK-101");
    expect(within(drawer).getByTestId("truck-management-not-ready")).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: /Unassign driver/ }).disabled).toBe(true);
    for (const key of Object.keys(client)) expect(client[key]).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("Add Truck happy path adds a visible truck tile", async () => {
    render(<TruckManagementPreview />);
    fireEvent.click(screen.getByTestId("add-truck"));
    expect(await screen.findByRole("dialog", { name: /Add truck/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Truck ID/), { target: { value: "TRK-900" } });
    fireEvent.change(screen.getByLabelText(/Vehicle number/), { target: { value: "V-900" } });
    fireEvent.change(screen.getByLabelText(/Display label/), { target: { value: "Truck 900" } });
    fireEvent.change(screen.getByLabelText(/Mobile location ID/), { target: { value: "MOBILE-900" } });
    fireEvent.change(screen.getByLabelText(/Home warehouse/), { target: { value: "WH-SOUTH" } });
    fireEvent.change(screen.getByLabelText(/Initial status/), { target: { value: "ACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add truck" }));

    expect(await screen.findByText("TRK-900")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Add truck/ })).toBeNull();
  });

  it("status selector offers EXACTLY the three governed options (plus a placeholder)", async () => {
    render(<TruckManagementPreview />);
    fireEvent.click(screen.getByTestId("add-truck"));
    await screen.findByRole("dialog", { name: /Add truck/ });
    const select = screen.getByLabelText(/Initial status/);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
  });

  it("keyboard: Escape closes the create modal and focus starts inside the dialog", async () => {
    render(<TruckManagementPreview />);
    fireEvent.click(screen.getByTestId("add-truck"));
    const dialog = await screen.findByRole("dialog", { name: /Add truck/ });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Add truck/ })).toBeNull());
  });
});

describe("manage: driver / status / warehouse / lifecycle", () => {
  it("assign a driver to an unassigned truck (bounded list, single source)", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-102");
    const driver = within(drawer).getByLabelText("Employee");
    expect(Array.from(driver.options).filter((o) => o.value).length).toBe(3); // all fixture drivers, no N+1
    fireEvent.change(driver, { target: { value: "EMP-2" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Assign driver" }));
    expect(await within(drawer).findByTestId("truck-command-outcome")).toBeTruthy();
    await waitFor(() => expect(within(drawer).getByTestId("tm-current-driver").textContent).toBe("Sam Okafor"));
  });

  it("reassign then unassign a driver", async () => {
    render(<TruckManagementPreview />);
    let drawer = await openManage("TRK-101");
    fireEvent.change(within(drawer).getByLabelText("Employee"), { target: { value: "EMP-3" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Reassign driver" }));
    await waitFor(() => expect(within(drawer).getByTestId("tm-current-driver").textContent).toBe("Jordan Lee"));
    fireEvent.click(within(drawer).getByRole("button", { name: "Unassign driver" }));
    await waitFor(() => expect(within(drawer).getByRole("button", { name: "Assign driver" })).toBeTruthy());
  });

  it("change status ACTIVE<->IDLE via changeStatus (no confirm)", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-102"); // IDLE
    fireEvent.change(within(drawer).getByLabelText("Status"), { target: { value: "ACTIVE" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update status" }));
    expect(await within(drawer).findByTestId("truck-command-outcome")).toBeTruthy();
    await waitFor(() => expect(within(drawer).getByTestId("tm-current-status").textContent).toBe("Active"));
  });

  it("deactivate requires an inline confirmation", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-101"); // ACTIVE
    fireEvent.change(within(drawer).getByLabelText("Status"), { target: { value: "OUT_OF_SERVICE" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update status" }));
    const confirm = await within(drawer).findByRole("button", { name: "Confirm deactivate" });
    fireEvent.click(confirm);
    expect(await within(drawer).findByTestId("truck-command-outcome")).toBeTruthy();
  });

  it("reactivate a deactivated truck (confirm, governed target)", async () => {
    const seed = [{ docId: "TRK-OOS", data: { locationId: "MOBILE-OOS", homeWarehouseId: "WH-CENTRAL", status: "OUT_OF_SERVICE", assignedDriverEmployeeId: null, displayLabel: "Truck OOS", vehicleNumber: "V-OOS" } }];
    render(<TruckManagementPreview seedTrucks={seed} />);
    const drawer = await openManage("TRK-OOS");
    fireEvent.change(within(drawer).getByLabelText("Status"), { target: { value: "ACTIVE" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update status" }));
    fireEvent.click(await within(drawer).findByRole("button", { name: "Confirm reactivate" }));
    expect(await within(drawer).findByTestId("truck-command-outcome")).toBeTruthy();
  });

  it("change home warehouse", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-101");
    fireEvent.change(within(drawer).getByLabelText("Warehouse"), { target: { value: "WH-SOUTH" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update home warehouse" }));
    expect(await within(drawer).findByTestId("truck-command-outcome")).toBeTruthy();
  });

  it("displayLabel and vehicleNumber are shown read-only (never editable inputs)", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-101");
    expect(within(drawer).getByTestId("tm-displayLabel-readonly").textContent).toBe("Truck 101");
    expect(within(drawer).getByTestId("tm-vehicleNumber-readonly").textContent).toBe("V-101");
    // No editable control holds those values.
    expect(screen.queryByDisplayValue("Truck 101")).toBeNull();
    expect(screen.queryByDisplayValue("V-101")).toBeNull();
  });
});

describe("sanitized failure surfaces", () => {
  it("a version conflict shows reload-required and NEVER the raw backend message", async () => {
    const secret = "INTERNAL-stale-version-8-detail";
    const client = {
      assignDriver: vi.fn(async () => { const e = new Error(secret); e.code = "functions/aborted"; throw e; }),
    };
    render(<TruckManagementPreview client={client} />);
    const drawer = await openManage("TRK-102");
    fireEvent.change(within(drawer).getByLabelText("Employee"), { target: { value: "EMP-2" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Assign driver" }));
    const banner = await within(drawer).findByTestId("truck-command-outcome");
    expect(banner.textContent).toMatch(/Reload and retry/i);
    expect(within(drawer).getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.queryByText(new RegExp(secret))).toBeNull();
  });
});

describe("access boundary", () => {
  it("an accessVersion change closes the management drawer (fail-closed reset)", async () => {
    const { rerender } = render(<TruckManagementPreview accessVersion="v1" />);
    await openManage("TRK-101");
    expect(screen.getByTestId("manage-truck-drawer")).toBeTruthy();
    rerender(<TruckManagementPreview accessVersion="v2" />);
    await waitFor(() => expect(screen.queryByTestId("manage-truck-drawer")).toBeNull());
  });
});

describe("Created-in-Error delete (admin-only)", () => {
  it("admin sees the danger zone + delete control in the Manage drawer", async () => {
    render(<TruckManagementPreview />); // isAdmin defaults true
    const drawer = await openManage("TRK-102");
    expect(within(drawer).getByTestId("tm-danger-zone")).toBeTruthy();
    expect(within(drawer).getByTestId("tm-delete-cie")).toBeTruthy();
  });

  it("dispatcher (isAdmin=false) does NOT see the delete control", async () => {
    render(<TruckManagementPreview isAdmin={false} />);
    const drawer = await openManage("TRK-102");
    expect(within(drawer).queryByTestId("tm-danger-zone")).toBeNull();
    expect(within(drawer).queryByTestId("tm-delete-cie")).toBeNull();
  });

  it("delete happy path: confirm with a reason removes the truck tile and closes the drawer", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-102"); // no driver -> deletable in the mock
    fireEvent.click(within(drawer).getByTestId("tm-delete-cie"));
    const dialog = await screen.findByRole("dialog", { name: /Delete truck TRK-102/ });
    fireEvent.change(within(dialog).getByLabelText(/Reason for deletion/), { target: { value: "created in error - duplicate" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete truck" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /TRK-102/ })).toBeNull());
    expect(screen.queryByTestId("manage-truck-drawer")).toBeNull();
  });

  it("delete requires a reason (no reason -> no deletion)", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-102");
    fireEvent.click(within(drawer).getByTestId("tm-delete-cie"));
    const dialog = await screen.findByRole("dialog", { name: /Delete truck TRK-102/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete truck" })); // no reason entered
    expect(await within(dialog).findByText(/Enter a reason to delete/)).toBeTruthy();
    expect(screen.getByTestId("manage-truck-drawer")).toBeTruthy(); // drawer still open -> not deleted
  });

  it("a blocked delete surfaces the SANITIZED message and never the raw backend detail", async () => {
    render(<TruckManagementPreview />);
    const drawer = await openManage("TRK-101"); // has a driver -> the mock rejects failed-precondition
    fireEvent.click(within(drawer).getByTestId("tm-delete-cie"));
    const dialog = await screen.findByRole("dialog", { name: /Delete truck TRK-101/ });
    fireEvent.change(within(dialog).getByLabelText(/Reason for deletion/), { target: { value: "attempted delete" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete truck" }));
    await waitFor(() => expect(within(dialog).getByText(/completed|could not be deleted/i)).toBeTruthy());
    expect(screen.queryByText(/INTERNAL mock detail/)).toBeNull();
    expect(screen.getByTestId("manage-truck-drawer")).toBeTruthy(); // drawer still open -> truck not deleted
  });
});
