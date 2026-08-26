// EMPHASIS IS A WEIGHT, PROVEN WHERE IT CAN ACTUALLY BE WRONG.
//
// workOrderNorthStarAuthority.test.jsx asserts the emphasis rule against the real engine, and that
// suite is worth having — but it cannot fail on the rule itself, and the reason is worth recording:
// measured across all eleven statuses and all three roles, `getAllowedActions` never returns more
// than ONE non-destructive action. So `emphasizeFirst && i === 0` and a bare `emphasizeFirst` are
// indistinguishable through the live surface today. A mutation that drops the index check passes
// every test in the repository.
//
// That is a false green in waiting: the day a state offers two transitions, the header quietly
// fills both, and the composition's "exactly one filled button" rule breaks with nothing failing.
// So this suite stubs the workflow authority to hand back two actions and pins the rule directly.
//
// The stub replaces WHICH ACTIONS ARE LEGAL, never who may take them: this is a presentation test,
// and the real gate stays exactly where it is.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const transitionWorkOrder = vi.fn(() => Promise.resolve());
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...a) => transitionWorkOrder(...a),
  updateWorkOrderExecutionData: vi.fn(),
}));
vi.mock("../src/domain/workOrderWorkflow", async (importOriginal) => ({
  // Everything else stays REAL — only the allowed-action list is widened, so the surrounding
  // machinery (status vocabulary, read-only set, action→status map) is the shipped one.
  ...(await importOriginal()),
  // Two legal, non-destructive actions at once — the shape the engine does not produce today.
  getAllowedActions: () => ["MarkReady", "Schedule", "Cancel"],
}));

import WorkOrderActions from "../src/modules/controlTower/WorkOrderActions.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const wo = { id: "wo-1", woNumber: "WO-1", status: "CREATED", scheduledTechId: "t1" };

describe("exactly one filled button, however many the engine allows", () => {
  it("EMPHASISES THE FIRST AND ONLY THE FIRST", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const buttons = [...container.querySelectorAll(".wo-action-row .fo-button")];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const filled = buttons.filter((b) => b.classList.contains("fo-button--primary"));
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(buttons[0]);
  });

  it("the others stay outlined — emphasis does not cascade", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const rest = [...container.querySelectorAll(".wo-action-row .fo-button")].slice(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const b of rest) expect(b.classList.contains("fo-button--primary")).toBe(false);
  });

  it("WITHOUT THE FLAG NOTHING IS FILLED, however many actions there are", () => {
    const { container } = render(<WorkOrderActions workOrder={wo} role="admin" technicians={[]} />);
    expect(container.querySelectorAll(".fo-button--primary")).toHaveLength(0);
  });

  it("THE SAME ACTIONS ARE OFFERED EITHER WAY — emphasis adds and removes nothing", () => {
    const plain = render(<WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} />);
    const before = [...plain.container.querySelectorAll(".fo-button")].map((b) => b.textContent).sort();
    plain.unmount();
    const emph = render(<WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />);
    const after = [...emph.container.querySelectorAll(".fo-button")].map((b) => b.textContent).sort();
    expect(after).toEqual(before);
  });

  it("THE FILLED BUTTON DISPATCHES ITS OWN ACTION, not the one at its position", () => {
    const { container } = render(
      <WorkOrderActions workOrder={wo} role="admin" technicians={[]} showStatus={false} emphasizeFirst />,
    );
    const filled = container.querySelector(".wo-action-row .fo-button--primary");
    fireEvent.click(filled);
    // MarkReady transitions immediately; the assertion is that the VALUE travelled, not the index.
    expect(transitionWorkOrder).toHaveBeenCalled();
    expect(transitionWorkOrder.mock.calls[0][1]).toBe("MarkReady");
  });
});
