// Wave 7 extension, PART 5 -- render gate for WorkOrderAttentionPanel (vitest + jsdom), mirroring
// notificationPanelNames.test.jsx's pattern: builds sections through the REAL projection
// (domain/workOrderAttentionProjection.js), so it proves the projection -> panel wiring, not just the
// panel's own rendering in isolation.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkOrderAttentionPanel from "../src/modules/controlTower/panels/WorkOrderAttentionPanel.jsx";

afterEach(() => cleanup());

const renderPanel = (props) => render(<MemoryRouter><WorkOrderAttentionPanel {...props} /></MemoryRouter>);

const DAY = 24 * 60 * 60 * 1000;
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

describe("WorkOrderAttentionPanel -- WO/Dispatch attention projection wiring", () => {
  it("empty state: no work orders need attention", () => {
    renderPanel({ workOrders: [], technicians: [] });
    expect(screen.getByText("Work Order Attention")).toBeTruthy();
    expect(screen.getByText("No work orders need attention.")).toBeTruthy();
  });

  it("renders a READY_TO_DISPATCH work order under 'Ready to Schedule' with an Action needed pill and a correct deep link", () => {
    renderPanel({
      workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" }],
      technicians: [],
    });
    expect(screen.getByText("Work Order Attention (1)")).toBeTruthy();
    expect(screen.getByText("Ready to Schedule")).toBeTruthy();
    expect(screen.getByText("WO-1001")).toBeTruthy();
    expect(screen.getByText("Action needed")).toBeTruthy();
    const link = screen.getByText("WO-1001").closest("a");
    expect(link.getAttribute("href")).toBe("/service/work-orders/WO-1");
  });

  it("renders sections in fixed order and resolves a technician name for a scheduling-conflict item (never a bare id)", () => {
    const a = { id: "WO-3", woNumber: "WO-3001", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
    const b = { id: "WO-4", woNumber: "WO-3002", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
    renderPanel({
      workOrders: [
        { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" },
        { id: "WO-2", woNumber: "WO-2001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY },
        a,
        b,
      ],
      technicians: [{ id: "T1", name: "Jordan Reyes" }],
    });
    const sectionHeadings = screen.getAllByText(/Ready to Schedule|Past Due|Scheduling Conflict/).map((el) => el.textContent);
    expect(sectionHeadings).toEqual(["Ready to Schedule", "Past Due", "Scheduling Conflict"]); // fixed order
    expect(screen.getAllByText("Technician: Jordan Reyes").length).toBe(2); // both conflicting WOs resolve the same tech's name
    // Never a raw technician id substituted in place of a name.
    expect(screen.queryByText("T1")).toBeNull();
    expect(screen.queryByText(/Technician: T1$/)).toBeNull();
  });

  it("an unresolvable technician id falls back to a labeled placeholder, never a bare id", () => {
    const a = { id: "WO-3", woNumber: "WO-3001", status: "SCHEDULED", assignedTechId: "GHOST-ID", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
    const b = { id: "WO-4", woNumber: "WO-3002", status: "SCHEDULED", assignedTechId: "GHOST-ID", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
    renderPanel({ workOrders: [a, b], technicians: [] });
    // "Unknown technician", not "Unassigned technician": these work orders ARE assigned -- to
    // GHOST-ID -- and the panel simply cannot name who that is. Calling that "unassigned" stated
    // something false about the work order. The assertion this test exists for is unchanged and
    // still enforced below: a labeled placeholder, never a bare id.
    expect(screen.getAllByText("Technician: Unknown technician").length).toBe(2);
    expect(document.body.textContent).not.toMatch(/GHOST-ID/);
    expect(screen.queryByText(/GHOST-ID/)).toBeNull();
  });

  it("a terminal (CLOSED/CANCELLED) or otherwise quiet work order produces nothing -- honestly excluded", () => {
    renderPanel({
      workOrders: [
        { id: "WO-9", woNumber: "WO-9001", status: "CLOSED" },
        { id: "WO-10", woNumber: "WO-9002", status: "CANCELLED" },
        { id: "WO-11", woNumber: "WO-9003", status: "WORK_IN_PROGRESS" },
      ],
      technicians: [],
    });
    expect(screen.getByText("No work orders need attention.")).toBeTruthy();
  });

  it("a Parts Blocked NOTIFICATION (procurement already in motion) renders 'In progress', not 'Action needed'", () => {
    renderPanel({
      workOrders: [{ id: "WO-5", woNumber: "WO-5001", status: "DISPATCHED" }],
      technicians: [],
      partsReadinessByWorkOrderId: {
        "WO-5": { jobReadiness: "ATTENTION", rows: [{ readiness: "ATTENTION", reason: "PROCUREMENT_PENDING" }] },
      },
    });
    expect(screen.getByText("Parts Blocked")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.queryByText("Action needed")).toBeNull();
  });
});
