// sweep r1-31 -- TechnicianDashboard's "Completed Today" bucket only matched
// wo.status === "COMPLETED". Close (admin/dispatcher-only, COMPLETED ->
// CLOSED per workOrderWorkflow.js) is a normal same-day step and never
// clears assignedTechId or completedAt, so useAssignedWorkOrders keeps
// returning the Work Order to its technician -- but the bucketing loop
// dropped it from every section (it isn't READY_TO_START/IN_PROGRESS/
// WAITING either), silently understating a technician's completed-today
// count for a job they actually finished.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Timestamp } from "firebase/firestore";

vi.mock("../src/hooks/useCurrentTechnician", () => ({ useCurrentTechnician: vi.fn() }));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({ useAssignedWorkOrders: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../src/hooks/useWorkOrderFieldContext", () => ({
  useWorkOrderFieldContext: () => ({ context: null, denied: true, loading: false }),
}));

import { useCurrentTechnician } from "../src/hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../src/hooks/useAssignedWorkOrders";
import { useAuth } from "../src/auth/AuthContext";
import TechnicianDashboard from "../src/modules/technicianDashboard/TechnicianDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TechnicianDashboard />
    </MemoryRouter>
  );
}

describe("TechnicianDashboard -- Completed Today includes same-day Closed work orders", () => {
  it("still lists a Work Order a dispatcher closed today, not just still-COMPLETED ones", () => {
    useAuth.mockReturnValue({ operationalRoles: [] });
    useCurrentTechnician.mockReturnValue({
      technician: { id: "tech-1", name: "Test Tech", status: "AVAILABLE" },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const today = Timestamp.fromDate(new Date());
    useAssignedWorkOrders.mockReturnValue({
      data: [
        { id: "wo-completed", woNumber: "WO-1", type: "SERVICE_CALL", status: "COMPLETED", completedAt: today },
        { id: "wo-closed", woNumber: "WO-2", type: "SERVICE_CALL", status: "CLOSED", completedAt: today },
      ],
      loading: false,
      error: null,
    });

    renderDashboard();

    expect(screen.getByText(/completed today \(2\)/i)).toBeTruthy();
  });
});
