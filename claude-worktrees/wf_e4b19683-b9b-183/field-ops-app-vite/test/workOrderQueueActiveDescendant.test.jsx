import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkOrderQueue from "../src/modules/dispatcherBoard/WorkOrderQueue.jsx";

// Arrow-key navigation in DispatcherBoard.jsx moves `selectedId` while DOM focus stays
// on the outer listbox div (option rows are tabIndex={-1}). Without aria-activedescendant
// wired to the selected option's id, a screen-reader user gets no announcement of which
// Work Order is now selected even though the visible `disp-wo-card--selected` highlight
// moves. This guards the listbox <-> option id contract that fixes that divergence.
const workOrders = [
  { id: "wo-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH", priority: 2, type: "SERVICE_CALL", customerId: "cust-1", createdAt: null },
  { id: "wo-2", woNumber: "WO-1002", status: "SCHEDULED", priority: 3, type: "PM", customerId: "cust-2", createdAt: null },
];

function renderQueue(selectedId) {
  return render(
    <WorkOrderQueue
      workOrders={workOrders}
      customerNames={new Map()}
      recommendationsByWorkOrderId={new Map()}
      technicians={[]}
      selectedId={selectedId}
      onSelect={() => {}}
    />
  );
}

describe("WorkOrderQueue aria-activedescendant", () => {
  it("has no aria-activedescendant when nothing is selected", () => {
    renderQueue(null);
    const listbox = screen.getByRole("listbox", { name: "Work Order queue" });
    expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("points aria-activedescendant at the id of the currently-selected option", () => {
    renderQueue("wo-2");
    const listbox = screen.getByRole("listbox", { name: "Work Order queue" });
    const activeId = listbox.getAttribute("aria-activedescendant");
    expect(activeId).toBe("disp-wo-option-wo-2");

    const options = screen.getAllByRole("option");
    const activeOption = options.find((el) => el.id === activeId);
    expect(activeOption).toBeTruthy();
    expect(activeOption.getAttribute("aria-selected")).toBe("true");
  });

  it("updates aria-activedescendant when selection moves to a different option", () => {
    const { rerender } = render(
      <WorkOrderQueue
        workOrders={workOrders}
        customerNames={new Map()}
        recommendationsByWorkOrderId={new Map()}
        technicians={[]}
        selectedId="wo-1"
        onSelect={() => {}}
      />
    );
    let listbox = screen.getByRole("listbox", { name: "Work Order queue" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe("disp-wo-option-wo-1");

    rerender(
      <WorkOrderQueue
        workOrders={workOrders}
        customerNames={new Map()}
        recommendationsByWorkOrderId={new Map()}
        technicians={[]}
        selectedId="wo-2"
        onSelect={() => {}}
      />
    );
    listbox = screen.getByRole("listbox", { name: "Work Order queue" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe("disp-wo-option-wo-2");
  });
});
