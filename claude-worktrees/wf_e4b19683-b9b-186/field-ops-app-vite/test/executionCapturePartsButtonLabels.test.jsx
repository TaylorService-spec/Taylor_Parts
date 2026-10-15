// sweep r1 #32 (execution-capture-parts-button-labels) -- the per-row '-'/'+'
// buttons in ExecutionCapture had no accessible name distinguishing which
// planned part they act on: a screen reader announced every row's buttons as
// identical "minus" / "plus" controls. This proves each button now carries an
// aria-label naming its part, so a Work Order with multiple planned parts
// exposes distinguishable controls via getByRole/getByLabelText.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/workOrderService", () => ({ updateWorkOrderExecutionData: vi.fn().mockResolvedValue(undefined) }));

import ExecutionCapture from "../src/modules/technicianDashboard/ExecutionCapture.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExecutionCapture Parts Used button accessible names (sweep r1 #32)", () => {
  it("gives each row's -/+ buttons a distinct aria-label naming the part, for multi-part Work Orders", () => {
    const workOrder = {
      id: "wo1",
      inventorySnapshot: [
        { sku: "PRT-1001", name: "Widget", qtyPlanned: 2, qtyUsed: 1 },
        { sku: "PRT-2002", name: "Gasket", qtyPlanned: 1, qtyUsed: 0 },
      ],
      executionLog: [],
    };
    render(<ExecutionCapture workOrder={workOrder} />);

    expect(screen.getByRole("button", { name: "Decrease Widget used" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase Widget used" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decrease Gasket used" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase Gasket used" })).toBeTruthy();
  });
});
