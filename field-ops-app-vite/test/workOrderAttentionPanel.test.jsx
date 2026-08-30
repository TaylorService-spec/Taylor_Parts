// WO/Dispatch attention projection -> attention block wiring.
//
// Unchanged in intent from the panel this covered before the Service Operations North Star P1
// recomposition: fixed section order, technician names that are never raw ids, terminal work orders
// honestly excluded, and the ACTION_ITEM/NOTIFICATION distinction rendered as words.
//
// What DID change is the seam. The panel no longer takes { workOrders, technicians } and call the
// projection itself; the composition root derives once via serviceOperationsAttention() and the panel
// renders the result. These tests therefore drive the same path the page does — projection first,
// panel second — rather than a shape only the test constructs.
//
// Two behavioural changes are asserted here rather than assumed:
//   * A clean snapshot renders NOTHING (not "No work orders need attention."). The grammar's
//     attention block is absent when clean.
//   * Rows carry no risk-severity word (SO-N1) and no owner (SO-N4).
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkOrderAttentionPanel from "../src/modules/controlTower/panels/WorkOrderAttentionPanel.jsx";
import { serviceOperationsAttention } from "../src/domain/serviceOperationsNorthStar";

afterEach(() => cleanup());

const DAY = 24 * 60 * 60 * 1000;
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

// Render through the projection, exactly as ControlTower does.
const renderPanel = ({ workOrders = [], technicians = [], accountNames, partsReadinessByWorkOrderId }) => {
  const attention = serviceOperationsAttention({
    workOrders,
    technicians,
    accountNames,
    partsReadinessByWorkOrderId,
  });
  return render(
    <MemoryRouter>
      <WorkOrderAttentionPanel attention={attention} />
    </MemoryRouter>,
  );
};

describe("WorkOrderAttentionPanel -- WO/Dispatch attention projection wiring", () => {
  it("clean: the block renders nothing at all", () => {
    const { container } = renderPanel({ workOrders: [], technicians: [] });
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  });

  it("renders a READY_TO_DISPATCH work order under 'Ready to Schedule' with an Action needed label and a correct deep link", () => {
    renderPanel({
      workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" }],
      technicians: [],
    });
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy();
    expect(screen.getByText("Ready to Schedule")).toBeTruthy();
    expect(screen.getByText("WO-1001")).toBeTruthy();
    expect(screen.getByText("Action needed")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open work order/ });
    expect(link.getAttribute("href")).toBe("/service/work-orders/WO-1");
  });

  it("renders the count of items needing attention", () => {
    renderPanel({
      workOrders: [
        { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" },
        { id: "WO-2", woNumber: "WO-2001", status: "SCHEDULED", scheduledStart: TODAY_START - DAY },
      ],
      technicians: [],
    });
    expect(screen.getByText("2")).toBeTruthy();
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
    const sectionHeadings = screen.getAllByText(/^(Ready to Schedule|Past Due|Scheduling Conflict)$/).map((el) => el.textContent);
    expect(sectionHeadings).toEqual(["Ready to Schedule", "Past Due", "Scheduling Conflict"]); // fixed order
    expect(screen.getAllByText(/Jordan Reyes/).length).toBe(2); // both conflicting WOs resolve the same tech's name
    // Never a raw technician id substituted in place of a name.
    expect(screen.queryByText("T1")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bT1\b/);
  });

  it("an unresolvable technician id falls back to a labeled placeholder, never a bare id", () => {
    const a = { id: "WO-3", woNumber: "WO-3001", status: "SCHEDULED", assignedTechId: "GHOST-ID", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
    const b = { id: "WO-4", woNumber: "WO-3002", status: "SCHEDULED", assignedTechId: "GHOST-ID", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
    renderPanel({ workOrders: [a, b], technicians: [] });
    // "Unknown technician", not "Unassigned technician": these work orders ARE assigned -- to
    // GHOST-ID -- and the panel simply cannot name who that is. Calling that "unassigned" stated
    // something false about the work order.
    expect(screen.getAllByText(/Unknown technician/).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/GHOST-ID/);
  });

  it("a terminal (CLOSED/CANCELLED) or otherwise quiet work order produces nothing -- honestly excluded", () => {
    const { container } = renderPanel({
      workOrders: [
        { id: "WO-9", woNumber: "WO-9001", status: "CLOSED" },
        { id: "WO-10", woNumber: "WO-9002", status: "CANCELLED" },
        { id: "WO-11", woNumber: "WO-9003", status: "WORK_IN_PROGRESS" },
      ],
      technicians: [],
    });
    expect(container.textContent).toBe("");
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

  it("resolves the account name onto the row, and never prints the customerId", () => {
    renderPanel({
      workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH", customerId: "C1" }],
      technicians: [],
      accountNames: new Map([["C1", "Acme Foods"]]),
    });
    expect(screen.getByText(/Acme Foods/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bC1\b/);
  });

  it("SO-N1 / SO-N4 -- carries no risk-severity word and no owner", () => {
    renderPanel({
      workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" }],
      technicians: [],
    });
    const text = document.body.textContent;
    for (const word of ["Urgent", "Stalled", "CRITICAL", "Critical", "HIGH"]) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toMatch(/Owner:/);
    // The governed role is never dressed up as a person.
    expect(text).not.toMatch(/Owner: Dispatcher/);
  });
});
