// Regression test for the stale-qty scan defect: the qty stepper must reset
// to 1 whenever a new scan resolves, so a quantity bumped for one part never
// silently rides along onto the NEXT part's result card.
//
// Sequence under test (the exact field scenario the defect describes):
//   1. Scan Part A.
//   2. Bump the qty stepper to 5 (technician meant to record 5 of A).
//   3. Realize it's the wrong part -- scan Part B instead, WITHOUT pressing
//      "Record use on this job" for A.
//   4. Part B's result card must show qty back at 1, not the stale 5 -- 5
//      would be a silent 5x overstatement if the technician presses Record.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ role: "technician" }),
}));

vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({
    data: [
      {
        id: "wo-1",
        woNumber: "WO-2026-SBX004",
        assignedTechId: "TECH-1",
        status: "WORK_IN_PROGRESS",
        inventorySnapshot: [
          { partId: "PRT-1001", sku: "PRT-1001", name: "Part A", qtyPlanned: 10 },
          { partId: "PRT-2002", sku: "PRT-2002", name: "Part B", qtyPlanned: 10 },
        ],
      },
    ],
    loading: false,
    error: null,
  }),
}));

vi.mock("../src/services/workOrderService", () => ({
  updateWorkOrderExecutionData: vi.fn(),
}));

import PartsScanner from "../src/modules/mobile/PartsScanner.jsx";

afterEach(cleanup);

function scan(code) {
  const input = screen.getByLabelText("Part or work order code");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
}

describe("PartsScanner -- qty resets between scans", () => {
  it("does not carry a bumped qty from one scanned part onto the next", () => {
    render(<PartsScanner technicianId="TECH-1" />);

    scan("PRT-1001");
    expect(screen.getByText("Part A")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // initial qty

    // Bump qty to 5 for Part A.
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByText("5")).toBeTruthy();

    // Re-scan a DIFFERENT part without pressing Record.
    scan("PRT-2002");
    expect(screen.getByText("Part B")).toBeTruthy();

    // The qty shown for Part B must be the reset default, not the stale 5
    // carried over from Part A.
    expect(screen.queryByText("5")).toBeNull();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
