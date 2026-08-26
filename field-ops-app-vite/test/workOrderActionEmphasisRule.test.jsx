// THE EMPHASIS RULE ITSELF, against an engine that offers more than one action.
//
// workOrderNorthStarAuthority.test.jsx proves emphasis is harmless against the REAL state machine.
// It also records, with an assertion, that the real machine never offers two non-destructive
// actions in any status for any role — which means "at most one button is filled" is currently
// satisfied by the engine and not by the rendering rule. A mutation that filled EVERY button
// passed that suite untouched.
//
// So the rule gets its own suite, with the allowed-action resolver stubbed to return several.
// Nothing here asserts what the engine SHOULD allow; the stub exists only so the rendering rule has
// something to get wrong.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const transitionWorkOrder = vi.fn(() => Promise.resolve());
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...args) => transitionWorkOrder(...args),
  updateWorkOrderExecutionData: vi.fn(),
}));

// Three non-destructive actions plus Cancel — a shape the engine does not produce today and may
// well produce tomorrow (Reschedule and Re-dispatch are both in the approved composition).
// Only the resolver is overridden; everything else in the module stays real, so the component
// still runs against the genuine read-only rules and transition map.
vi.mock("../src/domain/workOrderWorkflow", async (importOriginal) => ({
  ...(await importOriginal()),
  getAllowedActions: () => ["MarkReady", "Close", "Schedule", "Cancel"],
}));

import WorkOrderActions from "../src/modules/controlTower/WorkOrderActions.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const wo = { id: "wo-1", woNumber: "WO-1", status: "CREATED" };

describe("the emphasis rule, with several actions on offer", () => {
  it("FILLS EXACTLY ONE BUTTON, however many the engine allows", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    expect(container.querySelectorAll(".fo-button--primary")).toHaveLength(1);
    // And the rest are still offered — emphasis must not hide an action.
    expect(container.querySelectorAll(".fo-button--secondary").length).toBeGreaterThanOrEqual(2);
  });

  it("FILLS THE FIRST, not an arbitrary one", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const buttons = [...container.querySelectorAll(".fo-btn-row .fo-button")];
    expect(buttons[0].classList.contains("fo-button--primary")).toBe(true);
    for (const b of buttons.slice(1)) expect(b.classList.contains("fo-button--primary")).toBe(false);
  });

  it("THE FILLED BUTTON DISPATCHES ITS OWN ACTION", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    fireEvent.click(container.querySelector(".fo-button--primary"));
    expect(transitionWorkOrder).toHaveBeenCalledTimes(1);
    expect(transitionWorkOrder.mock.calls[0][1]).toBe("MarkReady");
  });

  it("A NON-FIRST BUTTON DISPATCHES ITS OWN ACTION TOO — position is not identity", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const close = screen.getByRole("button", { name: /close/i });
    fireEvent.click(close);
    expect(transitionWorkOrder).toHaveBeenCalledTimes(1);
    expect(transitionWorkOrder.mock.calls[0][1]).toBe("Close");
  });

  it("EMPHASIS ADDS AND REMOVES NOTHING — the same actions are offered either way", () => {
    const plain = render(<WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} />);
    const without = screen.queryAllByRole("button").map((b) => b.textContent.trim()).sort();
    plain.unmount();

    render(<WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />);
    const withEmphasis = screen.queryAllByRole("button").map((b) => b.textContent.trim()).sort();

    expect(withEmphasis).toEqual(without);
  });

  it("CANCEL IS NEVER FILLED, even when it is the only thing left", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const filled = container.querySelector(".fo-button--primary");
    expect(filled.textContent).not.toMatch(/cancel/i);
    expect(container.querySelector(".fo-button--destructive")).toBeTruthy();
  });
});
