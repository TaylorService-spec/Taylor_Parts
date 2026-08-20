// Guards against the silent-completion regression on
// TechnicianWorkOrderActions.jsx: the component imports
// unusedPlannedPartsMessage() from domain/plannedPartsCompletion.js (built
// specifically so completion can warn about unrecorded planned parts) but
// handleAction() called transitionWorkOrder() unconditionally, so
// "Complete Work Order" silently completed a Work Order with an unused
// planned part -- exactly the defect that module's own header comment
// documents. RENDER test (vitest + jsdom) so the real handleAction click
// path is exercised, not just the pure domain function.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const transitionWorkOrder = vi.fn(() => Promise.resolve());
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...args) => transitionWorkOrder(...args),
}));

import TechnicianWorkOrderActions from "../src/modules/technicianDashboard/TechnicianWorkOrderActions";

afterEach(() => {
  cleanup();
  transitionWorkOrder.mockClear();
  vi.restoreAllMocks();
});

const shortWorkOrder = {
  id: "wo-1",
  status: "WORK_IN_PROGRESS",
  inventorySnapshot: [{ name: "Compressor", qtyPlanned: 1, qtyUsed: 0 }],
};

const fullyUsedWorkOrder = {
  id: "wo-2",
  status: "WORK_IN_PROGRESS",
  inventorySnapshot: [{ name: "Compressor", qtyPlanned: 1, qtyUsed: 1 }],
};

describe("TechnicianWorkOrderActions completion honesty", () => {
  it("warns via window.confirm before completing with an unused planned part, and blocks the transition on Cancel", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TechnicianWorkOrderActions workOrder={shortWorkOrder} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete Work Order" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Compressor \(0 of 1 used\)/);
    expect(transitionWorkOrder).not.toHaveBeenCalled();
  });

  it("proceeds with the transition when the technician confirms anyway", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TechnicianWorkOrderActions workOrder={shortWorkOrder} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete Work Order" }));

    expect(transitionWorkOrder).toHaveBeenCalledWith("wo-1", "Complete");
  });

  it("does not prompt when every planned part is fully used", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TechnicianWorkOrderActions workOrder={fullyUsedWorkOrder} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete Work Order" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(transitionWorkOrder).toHaveBeenCalledWith("wo-2", "Complete");
  });
});
