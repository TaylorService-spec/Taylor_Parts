import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TechnicianCapacityCard from "../src/modules/dispatcherBoard/TechnicianCapacityCard.jsx";

describe("TechnicianCapacityCard", () => {
  it("labels the workload bar with the combined bucket, not just in-progress count", () => {
    const technician = { id: "tech-1" };
    const workOrders = [
      { assignedTechId: "tech-1", status: "WORK_IN_PROGRESS" },
      { assignedTechId: "tech-1", status: "SCHEDULED" },
      { assignedTechId: "tech-1", status: "SCHEDULED" },
      { assignedTechId: "tech-1", status: "DISPATCHED" },
      { assignedTechId: "tech-1", status: "EN_ROUTE" },
    ];

    render(<TechnicianCapacityCard technician={technician} workOrders={workOrders} />);

    // total = 1 in-progress + 3 scheduled + 1 traveling = 5
    const bar = screen.getByRole("img", { name: /Workload: 5/ });
    expect(bar).toBeTruthy();
    // The label must not claim all 5 are "in-progress" -- only 1 is.
    expect(bar.getAttribute("aria-label")).not.toMatch(/^Workload: 5 in-progress work orders$/);
    expect(bar.getAttribute("aria-label")).toMatch(/active work orders/);

    expect(screen.getByText(/In Progress: 1/)).toBeTruthy();
    expect(screen.getByText(/Scheduled: 3/)).toBeTruthy();
    expect(screen.getByText(/Traveling: 1/)).toBeTruthy();
  });
});
