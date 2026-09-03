// site-work round-2 #6 (executioncapture-unbounded-qtyused) -- ExecutionCapture's
// '+' button called updateWorkOrderExecutionData WITHOUT the over-plan guard
// PartsScanner already has, so rapid-tapping '+' silently recorded qtyUsed far
// beyond the planned quantity (field-observed "13 against a 1-part plan").
// This proves the guard now mirrors PartsScanner's exact behavior: a '+' click
// that would push qtyUsed past qtyPlanned is gated behind window.confirm, using
// the SAME copy ("The plan says X. Record Y?"), and the write is skipped when
// the technician declines.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Decision #171: a positive qtyUsed now resolves a governed source first. The component asks the
// server which sources are permitted, so the read is mocked alongside the write -- an unambiguous
// pick, which is the case that needs no technician input.
vi.mock("../src/services/workOrderService", () => ({
  updateWorkOrderExecutionData: vi.fn().mockResolvedValue(undefined),
  listWorkOrderConsumptionSources: vi.fn().mockResolvedValue({
    autoSource: { locationId: "wh-1", locationType: "WAREHOUSE", label: "Phoenix Warehouse", method: "PICK" },
    selectableSources: [],
    serializedSource: null,
    sourceRequired: false,
    autoSourceUnavailableReason: null,
    mobileAmbiguous: false,
  }),
}));

import { updateWorkOrderExecutionData } from "../src/services/workOrderService";
import ExecutionCapture from "../src/modules/technicianDashboard/ExecutionCapture.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAtPlan(qtyUsed, qtyPlanned = 1) {
  const workOrder = {
    id: "wo1",
    inventorySnapshot: [{ sku: "PRT-1001", name: "Widget", qtyPlanned, qtyUsed }],
    executionLog: [],
  };
  render(<ExecutionCapture workOrder={workOrder} />);
}

describe("ExecutionCapture over-plan guard (site-work r2 #6)", () => {
  it("'+' at the planned qty asks for confirmation with PartsScanner's exact copy, and records on confirm", async () => {
    renderAtPlan(1, 1); // already at plan; next + would push to 2
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByText("+"));

    expect(confirmSpy).toHaveBeenCalledWith("The plan says 1. Record 2?");
    await waitFor(() =>
      expect(updateWorkOrderExecutionData).toHaveBeenCalledWith("wo1", {
        qtyUsedUpdates: [{ sku: "PRT-1001", delta: 1 }],
        // Decision #171: a POSITIVE delta now carries the governed source it resolved. The negative
        // case below deliberately does not — a correction reverses against the original lineage.
        consumptionSources: [{ sku: "PRT-1001", locationId: "wh-1" }],
      }),
    );
  });

  it("'+' at the planned qty does NOT record when the technician declines the confirm -- no silent over-plan write", async () => {
    renderAtPlan(1, 1);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(screen.getByText("+"));

    expect(confirmSpy).toHaveBeenCalledWith("The plan says 1. Record 2?");
    expect(updateWorkOrderExecutionData).not.toHaveBeenCalled();
  });

  it("'+' below the planned qty records without any confirm prompt -- guard only fires over-plan", async () => {
    renderAtPlan(0, 3); // 0 of 3 used; next + -> 1, still under plan
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByText("+"));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(updateWorkOrderExecutionData).toHaveBeenCalledWith("wo1", {
        qtyUsedUpdates: [{ sku: "PRT-1001", delta: 1 }],
        // Decision #171: a POSITIVE delta now carries the governed source it resolved. The negative
        // case below deliberately does not — a correction reverses against the original lineage.
        consumptionSources: [{ sku: "PRT-1001", locationId: "wh-1" }],
      }),
    );
  });

  it("'-' never triggers the over-plan confirm, even when qtyUsed already exceeds plan -- guard only gates the '+' path", async () => {
    renderAtPlan(2, 1); // already over plan (e.g. from a prior legitimate deliberate confirm)
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByText("-"));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(updateWorkOrderExecutionData).toHaveBeenCalledWith("wo1", {
        qtyUsedUpdates: [{ sku: "PRT-1001", delta: -1 }],
      }),
    );
  });
});
