// The technician's closeout section, rendered.
//
// The domain module proves the decisions. What only a render proves is that the SCREEN honours them:
// that there is no customer picker, that scanning writes nothing, that pressing the button once
// sends one install, and that a failed completion leaves a visible resume path rather than an
// invitation to install again.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EquipmentInstallCloseout from "../src/modules/mobile/EquipmentInstallCloseout.jsx";

const UNITS = [
  { serializedAssetId: "sa_taylor", serialNo: "CW-C161-0001", partId: "CW-WU-TAYLOR--C161",
    productName: "Taylor C161", equipmentModelId: "TAYLOR--C161", inventoryState: "AVAILABLE", currentLocationId: "wh-main" },
  { serializedAssetId: "sa_icetro", serialNo: "CW-IM0460AH-0001", partId: "CW-WU-ICETRO--IM-0460-AH",
    productName: "Icetro IM-0460-AH", equipmentModelId: "ICETRO--IM-0460-AH", inventoryState: "AVAILABLE", currentLocationId: "wh-main" },
];
const READY = {
  status: "ready",
  workOrder: { workOrderId: "wo1", woNumber: "WO-2026-000042", customerId: "acct-harbor", locationId: "loc-harbor-airport", status: "WORK_IN_PROGRESS", type: "INSTALL" },
  units: UNITS, truncated: false, mutated: false,
};

let fetchUnits, recordInstall, onCompleteWorkOrder;
beforeEach(() => {
  fetchUnits = vi.fn().mockResolvedValue({ outcome: READY, error: null });
  recordInstall = vi.fn().mockResolvedValue({
    outcome: { outcome: "installed", equipmentId: "eq_1", completionRequired: true, workOrderStatus: "WORK_IN_PROGRESS" },
    error: null,
  });
  onCompleteWorkOrder = vi.fn().mockResolvedValue(undefined);
});
const mount = () => render(
  <EquipmentInstallCloseout
    workOrderId="wo1"
    onCompleteWorkOrder={onCompleteWorkOrder}
    deps={{ fetchUnits, recordInstall }}
  />,
);
const selectTaylor = async () => {
  await screen.findByText("Taylor C161");
  fireEvent.click(screen.getAllByRole("radio")[0]);
};

describe("Equipment installation at closeout", () => {
  it("shows the customer and location READ-ONLY, with no picker for either", async () => {
    mount();
    await screen.findByText("acct-harbor");
    expect(screen.getByText("loc-harbor-airport")).toBeTruthy();
    // The whole access-reduction argument in one assertion: a technician is offered no choice of
    // customer or location, because the work order already owns both.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lists the eligible units by product, with their serials", async () => {
    mount();
    await screen.findByText("Taylor C161");
    expect(screen.getByText("Icetro IM-0460-AH")).toBeTruthy();
    expect(screen.getByText(/CW-C161-0001/)).toBeTruthy();
  });

  it("SCANNING FILTERS AND WRITES NOTHING", async () => {
    // Scan resolves and confirms. It must never install, complete, or change any state.
    mount();
    await screen.findByText("Taylor C161");
    fireEvent.change(screen.getByRole("textbox", { name: /Scan or type a serial/i }), { target: { value: "CW-IM0460" } });
    await waitFor(() => expect(screen.queryByText("Taylor C161")).toBeNull());
    expect(screen.getByText("Icetro IM-0460-AH")).toBeTruthy();
    expect(recordInstall).not.toHaveBeenCalled();
    expect(onCompleteWorkOrder).not.toHaveBeenCalled();
  });

  it("warns that it cannot be undone before anything is sent", async () => {
    mount();
    await selectTaylor();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(recordInstall).not.toHaveBeenCalled();
  });

  it("installs FIRST, then completes -- in that order", async () => {
    const order = [];
    recordInstall.mockImplementation(async () => {
      order.push("install");
      return { outcome: { outcome: "installed", equipmentId: "eq_1", completionRequired: true }, error: null };
    });
    onCompleteWorkOrder.mockImplementation(async () => { order.push("complete"); });
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    await waitFor(() => expect(order).toEqual(["install", "complete"]));
  });

  it("NEVER COMPLETES WHEN THE INSTALL FAILED", async () => {
    // The forbidden outcome -- a completed job whose installation did not happen -- made impossible
    // by ordering rather than by a transaction.
    recordInstall.mockResolvedValue({ outcome: null, error: { code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" } });
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    expect(await screen.findByText(/already installed for another customer/i)).toBeTruthy();
    expect(onCompleteWorkOrder).not.toHaveBeenCalled();
  });

  it("a failed COMPLETION shows the middle state and offers completion only", async () => {
    onCompleteWorkOrder.mockRejectedValue(new Error("network"));
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    expect(await screen.findByText(/Installation recorded — Work Order completion still required/i)).toBeTruthy();
    // The resume action says COMPLETE. Offering "install" again would invite a second machine.
    const resume = screen.getByRole("button", { name: /^Complete work order$/i });
    expect(resume).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install & Complete Work/i })).toBeNull();
    expect(screen.getByText(/installation is already recorded/i)).toBeTruthy();
  });

  it("resuming calls completion ONLY -- no second install", async () => {
    onCompleteWorkOrder.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    const resume = await screen.findByRole("button", { name: /^Complete work order$/i });
    recordInstall.mockClear();
    fireEvent.click(resume);
    await waitFor(() => expect(onCompleteWorkOrder).toHaveBeenCalledTimes(2));
    expect(recordInstall).not.toHaveBeenCalled();
  });

  it("ONE install per press, however many times it is pressed", async () => {
    let release;
    recordInstall.mockReturnValue(new Promise((r) => { release = r; }));
    mount();
    await selectTaylor();
    const button = screen.getByRole("button", { name: /Install & Complete Work/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(recordInstall).toHaveBeenCalledTimes(1);
    release({ outcome: { outcome: "installed", equipmentId: "eq_1", completionRequired: true }, error: null });
  });

  it("an already-recorded install skips completion and says so", async () => {
    // The lost-response case: the server answers from the database, and the flow must not complete a
    // job that is already complete -- transitionWorkOrder is not idempotent.
    recordInstall.mockResolvedValue({
      outcome: { outcome: "already_installed_for_this_work_order", equipmentId: "eq_1", completionRequired: false, workOrderStatus: "COMPLETED" },
      error: null,
    });
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    expect(await screen.findByText(/already complete/i)).toBeTruthy();
    expect(onCompleteWorkOrder).not.toHaveBeenCalled();
  });

  it("the customer and location are never sent -- the server derives them", async () => {
    mount();
    await selectTaylor();
    fireEvent.click(screen.getByRole("button", { name: /Install & Complete Work/i }));
    await waitFor(() => expect(recordInstall).toHaveBeenCalled());
    const payload = recordInstall.mock.calls[0][0];
    expect(payload.accountId).toBeUndefined();
    expect(payload.locationId).toBeUndefined();
    expect(payload.workOrderId).toBe("wo1");
    expect(payload.serializedAssetId).toBe("sa_taylor");
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("a denied read is shown as a denial, never as an empty list", async () => {
    fetchUnits.mockResolvedValue({ outcome: null, error: { code: "permission-denied", message: "You are not authorized to record an equipment installation." } });
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/No units are currently eligible/i)).toBeNull();
  });

  it("a genuinely empty list says so honestly", async () => {
    fetchUnits.mockResolvedValue({ outcome: { ...READY, units: [] }, error: null });
    mount();
    expect(await screen.findByText(/No units are currently eligible/i)).toBeTruthy();
  });

  it("the action is dead until a unit is chosen, and says why", async () => {
    mount();
    await screen.findByText("Taylor C161");
    expect(screen.getByRole("button", { name: /Install & Complete Work/i }).disabled).toBe(true);
    expect(screen.getByText(/Choose the unit you installed/i)).toBeTruthy();
  });
});
