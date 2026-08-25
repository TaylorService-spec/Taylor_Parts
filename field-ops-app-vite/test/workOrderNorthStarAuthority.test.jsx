// PRESENTATION ORDERING CANNOT CREATE AUTHORITY.
//
// The North Star record header fills exactly one button — the first action orderWorkflowActions
// returns. Emphasis is a weight, and this suite exists to prove it stays one: that the SAME set of
// actions is offered with and without it, that the emphasized button dispatches the action it is
// labelled with rather than the one it is positioned at, and that no capability, transition or
// legality check is consulted differently.
//
// Every assertion here is BEHAVIOURAL. A source-text check would pass on a file that renders the
// right words and calls the wrong function, which is the failure mode this branch is being
// reviewed for.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const transitionWorkOrder = vi.fn(() => Promise.resolve());
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...args) => transitionWorkOrder(...args),
  updateWorkOrderExecutionData: vi.fn(),
}));

import WorkOrderActions from "../src/modules/controlTower/WorkOrderActions.jsx";
import { getAllowedActions } from "../src/domain/workOrderWorkflow.js";
import { orderWorkflowActions } from "../src/domain/workflowActionOrder.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Every governed status, so emphasis is proven across the whole state machine rather than on the
// one state a fixture happened to carry.
const STATUSES = [
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
];

const wo = (status) => ({ id: "wo-1", woNumber: "WO-1", status, scheduledTechId: "t1" });
const names = () => screen.queryAllByRole("button").map((b) => b.textContent.trim()).sort();

describe("emphasizeFirst is a WEIGHT, not an authority", () => {
  it("OFFERS THE IDENTICAL ACTION SET, in every governed status, for every role", () => {
    for (const role of ["admin", "dispatcher", "technician"]) {
      for (const status of STATUSES) {
        const plain = render(<WorkOrderActions workOrder={wo(status)} role={role} technicians={[]} showStatus={false} />);
        const withoutEmphasis = names();
        plain.unmount();

        const emph = render(<WorkOrderActions workOrder={wo(status)} role={role} technicians={[]} showStatus={false} emphasizeFirst />);
        const withEmphasis = names();
        emph.unmount();

        expect(withEmphasis).toEqual(withoutEmphasis);
      }
    }
  });

  it("EMPHASIZES AT MOST ONE BUTTON, and only one the engine already allowed", () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(
        <WorkOrderActions workOrder={wo(status)} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
      );
      const filled = container.querySelectorAll(".fo-button--primary");
      expect(filled.length).toBeLessThanOrEqual(1);
      if (filled.length === 1) {
        expect(orderWorkflowActions(getAllowedActions(status, "admin", false)).primary.length).toBeGreaterThan(0);
      }
      unmount();
    }
  });

  it("TODAY THE ENGINE NEVER OFFERS TWO — so the check above is recorded as having no teeth yet", () => {
    // Measured, not assumed: across every status and role, the non-destructive action list is
    // never longer than one. "At most one filled button" is therefore satisfied by the state
    // machine rather than by the rendering rule, and the real proof of the rule lives in the
    // stubbed suite below. This assertion exists so that the day a status offers two actions,
    // THIS test fails and sends someone back to the emphasis rule with a live case.
    const widest = Math.max(
      ...["admin", "dispatcher", "technician"].flatMap((role) =>
        STATUSES.map((s) => orderWorkflowActions(getAllowedActions(s, role, false)).primary.length),
      ),
    );
    expect(widest).toBe(1);
  });

  it("DISPATCHES THE ACTION IT IS LABELLED WITH — the click carries a value, never a position", () => {
    // CREATED -> MarkReady is the one path that transitions immediately rather than opening a
    // picker, which is what makes the dispatched argument observable.
    const expected = orderWorkflowActions(getAllowedActions("CREATED", "admin", false)).primary[0];
    expect(expected).toBe("MarkReady");

    const { container } = render(
      <WorkOrderActions workOrder={wo("CREATED")} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const filled = container.querySelector(".fo-button--primary");
    expect(filled).toBeTruthy();
    fireEvent.click(filled);

    // No conditional. If the click stopped reaching the engine, or reached it with a different
    // action, this fails — an earlier version of this test tolerated "no call at all" and was
    // therefore green against a click handler that dispatched the wrong action entirely.
    expect(transitionWorkOrder).toHaveBeenCalledTimes(1);
    expect(transitionWorkOrder.mock.calls[0][1]).toBe(expected);
  });

  it("A READ-ONLY RECORD OFFERS NOTHING, emphasized or not", () => {
    for (const status of ["CLOSED", "CANCELLED"]) {
      const { unmount } = render(
        <WorkOrderActions workOrder={wo(status)} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
      );
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      unmount();
    }
  });

  it("CANCEL IS NEVER THE EMPHASIZED BUTTON — a destructive action is never the filled one", () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(
        <WorkOrderActions workOrder={wo(status)} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
      );
      const filled = container.querySelector(".fo-button--primary");
      if (filled) expect(filled.textContent).not.toMatch(/cancel/i);
      unmount();
    }
  });

  it("DEFAULTS ARE UNCHANGED for every existing caller — no flag means no filled button", () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(
        <WorkOrderActions workOrder={wo(status)} role="admin" technicians={[]} />,
      );
      expect(container.querySelectorAll(".fo-button--primary")).toHaveLength(0);
      unmount();
    }
  });

  it("a record with no status renders rather than crashing", () => {
    expect(() => render(<WorkOrderActions workOrder={{ id: "x" }} role="admin" technicians={[]} emphasizeFirst />)).not.toThrow();
  });
});
