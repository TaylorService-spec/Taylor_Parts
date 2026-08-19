// Regression test for the sweep r1 finding: a CANCELLED Work Order rendered the exact same
// green "Completed" chip as a job that actually finished. domain/fieldWorkOrder.js's
// PHASE_BY_STATUS deliberately folds COMPLETED, CLOSED, and CANCELLED into the single
// FIELD_PHASE.FINISHED bucket (phase only answers "is field work still owed", not "what
// happened"), so Dispatch.jsx's statusChipFor -- which read PHASE_CHIP[fieldPhase(job)]
// with no other check -- could not tell a cancelled job from a completed one. Compare
// DispatchSchedulingWorkspace.jsx's StatusChip, which reads the real governed status and
// correctly shows "Cancelled" for the identical status.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: vi.fn(),
}));

vi.mock("../src/hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("Dispatch -- cancelled Work Order chip", () => {
  it("shows a Cancelled chip, not the green Completed chip, for a CANCELLED job", async () => {
    vi.doMock("../src/hooks/useWorkOrders", () => ({
      useWorkOrders: () => ({
        data: [
          {
            id: "wo-cancelled-1",
            woNumber: "WO-2026-000099",
            status: "CANCELLED",
            description: "PM visit cancelled by customer",
          },
        ],
        loading: false,
        error: null,
      }),
    }));

    const { default: Dispatch } = await import("../src/modules/dispatch/Dispatch.jsx");
    render(<Dispatch />);

    const chip = screen.getByText("Cancelled");
    expect(chip).toBeTruthy();
    expect(chip.className).not.toMatch(/fo-chip-completed/);
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
