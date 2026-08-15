// WO Parts Planning -- component tests for the operational planning surface
// (src/modules/workOrders/WorkOrderPartsPlanEditor.jsx).
//
// Proves the properties that make this a PLANNING surface and not a second inventory system:
// planning sends only planned quantities through the ONE governed command; recorded usage is shown
// but never sent and never erasable; a terminal Work Order offers no edit; catalog read failures and
// command denials are reported honestly instead of collapsing into an empty state; and a successful
// save never optimistically fabricates the new plan.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

import WorkOrderPartsPlanEditor from "../src/modules/workOrders/WorkOrderPartsPlanEditor.jsx";

afterEach(cleanup);

const CATALOG = {
  ok: true,
  parts: [
    { partId: "P-1", internalPartNumber: "SKU-1", name: "Filter" },
    { partId: "P-2", internalPartNumber: "SKU-2", name: "Belt" },
    { partId: "P-3", internalPartNumber: "SKU-3", name: "Gasket" },
  ],
};

function wo(overrides = {}) {
  return {
    id: "WO-1",
    status: "SCHEDULED",
    inventorySnapshot: [{ partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2, qtyUsed: 0 }],
    ...overrides,
  };
}

function deps({ client, fetchParts } = {}) {
  return {
    client: client ?? vi.fn().mockResolvedValue({ success: true, workOrderId: "WO-1", plannedCount: 1 }),
    fetchParts: fetchParts ?? vi.fn().mockResolvedValue(CATALOG),
  };
}

// Entering edit mode kicks off the catalog read. Flush it inside act() so the resulting state
// update is not reported as an unwrapped update, and so assertions see a settled component.
async function beginEdit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /edit parts plan/i }));
  });
}

describe("WorkOrderPartsPlanEditor", () => {
  it("renders the persisted plan read-only until editing begins", async () => {
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={deps()} />);
    expect(screen.getByText("Filter")).toBeTruthy();
    expect(screen.getByText("SKU-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit parts plan/i })).toBeTruthy();
    // No quantity input before entering edit mode.
    expect(screen.queryByLabelText(/planned quantity/i)).toBeNull();
  });

  it("shows an honest empty state when nothing is planned", async () => {
    render(<WorkOrderPartsPlanEditor workOrder={wo({ inventorySnapshot: [] })} deps={deps()} />);
    expect(screen.getByText(/no parts planned/i)).toBeTruthy();
  });

  it("offers NO edit affordance on a terminal Work Order, and says why", async () => {
    for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
      const { unmount } = render(<WorkOrderPartsPlanEditor workOrder={wo({ status })} deps={deps()} />);
      expect(screen.queryByRole("button", { name: /edit parts plan/i })).toBeNull();
      expect(screen.getByText(/can no longer be changed/i)).toBeTruthy();
      unmount();
    }
  });

  it("sends ONLY planned quantities through the governed command -- never qtyUsed, never sku", async () => {
    const d = deps();
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [{ partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2, qtyUsed: 1 }],
        })}
        deps={d}
      />,
    );
    await beginEdit();
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save parts plan/i }));

    await waitFor(() => expect(d.client).toHaveBeenCalledTimes(1));
    const [workOrderId, plan] = d.client.mock.calls[0];
    expect(workOrderId).toBe("WO-1");
    expect(plan).toEqual([{ partId: "P-1", name: "Filter", qtyPlanned: 5 }]);
    // PLAN != USE, and identity is partId-only: the payload carries neither.
    expect(JSON.stringify(plan)).not.toContain("qtyUsed");
    expect(JSON.stringify(plan)).not.toContain("SKU-1");
  });

  it("cannot remove a part that has recorded usage", async () => {
    const d = deps();
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [{ partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2, qtyUsed: 3 }],
        })}
        deps={d}
      />,
    );
    await beginEdit();
    const remove = screen.getByRole("button", { name: /remove/i });
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    // Still present; nothing was sent.
    expect(screen.getByText("Filter")).toBeTruthy();
    expect(d.client).not.toHaveBeenCalled();
  });

  it("blocks the save when a used part would be dropped by zeroing its quantity", async () => {
    const d = deps();
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [{ partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2, qtyUsed: 3 }],
        })}
        deps={d}
      />,
    );
    await beginEdit();
    // Zeroing is an intent to un-plan, which for a used part is blocked.
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "0" } });
    expect(screen.getByText(/cannot be removed from the plan/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save parts plan/i }).disabled).toBe(true);
    expect(d.client).not.toHaveBeenCalled();
  });

  it("adds a catalog part by search and plans it", async () => {
    const d = deps();
    render(<WorkOrderPartsPlanEditor workOrder={wo({ inventorySnapshot: [] })} deps={d} />);
    await beginEdit();
    await waitFor(() => expect(d.fetchParts).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/add a part/i), { target: { value: "belt" } });
    fireEvent.click(await screen.findByRole("button", { name: /add Belt/i }));
    fireEvent.click(screen.getByRole("button", { name: /save parts plan/i }));

    await waitFor(() => expect(d.client).toHaveBeenCalledTimes(1));
    expect(d.client.mock.calls[0][1]).toEqual([{ partId: "P-2", name: "Belt", qtyPlanned: 1 }]);
  });

  it("reports a catalog permission denial honestly instead of showing 'no matching part'", async () => {
    const d = deps({ fetchParts: vi.fn().mockResolvedValue({ ok: false, code: "permission-denied" }) });
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={d} />);
    await beginEdit();
    expect(await screen.findByText(/do not have permission to read the parts catalog/i)).toBeTruthy();
    expect(screen.getByLabelText(/add a part/i).disabled).toBe(true);
  });

  it("reports a command permission denial without claiming success", async () => {
    const denied = Object.assign(new Error("nope"), { code: "functions/permission-denied" });
    const d = deps({ client: vi.fn().mockRejectedValue(denied) });
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={d} />);
    await beginEdit();
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save parts plan/i }));

    expect(await screen.findByText(/do not have permission to change/i)).toBeTruthy();
    expect(screen.queryByText(/parts plan saved/i)).toBeNull();
  });

  it("reports an undeployed command as unavailable, not as a permission problem", async () => {
    const missing = Object.assign(new Error("not found"), { code: "functions/not-found" });
    const d = deps({ client: vi.fn().mockRejectedValue(missing) });
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={d} />);
    await beginEdit();
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save parts plan/i }));

    expect(await screen.findByText(/not available in this environment/i)).toBeTruthy();
    expect(screen.queryByText(/do not have permission/i)).toBeNull();
  });

  it("does not enable save until the plan actually changed", async () => {
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={deps()} />);
    await beginEdit();
    expect(screen.getByRole("button", { name: /save parts plan/i }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: /save parts plan/i }).disabled).toBe(false);
  });

  it("cancel discards the draft and restores the persisted plan", async () => {
    render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={deps()} />);
    await beginEdit();
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Back to read-only, showing the persisted quantity -- not the abandoned draft.
    expect(screen.queryByLabelText(/planned quantity/i)).toBeNull();
    expect(screen.getByRole("row", { name: /Filter/ }).textContent).toContain("2");
    expect(screen.getByRole("row", { name: /Filter/ }).textContent).not.toContain("9");
  });


  it("keeps a legacy (partId-less) planned row VISIBLE and refuses to edit rather than risk dropping it", async () => {
    const d = deps();
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [
            { partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2 },
            { sku: "LEGACY-9", qtyPlanned: 4 }, // predates canonical identity
          ],
        })}
        deps={d}
      />,
    );
    // The legacy row is shown -- hiding it would misrepresent the plan.
    // Appears twice by design: the name cell degrades to the raw SKU, and the SKU cell shows it.
    expect(screen.getAllByText("LEGACY-9").length).toBe(2);
    // ...and editing is refused entirely, because the command replaces the WHOLE plan and the client
    // has no identity for that row: any save would delete it.
    expect(screen.queryByRole("button", { name: /edit parts plan/i })).toBeNull();
    expect(screen.getByText(/cannot be edited here without risking their removal/i)).toBeTruthy();
    expect(d.client).not.toHaveBeenCalled();
  });

  it("a legacy row with usage but no planned quantity does not block planning", async () => {
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [
            { partId: "P-1", sku: "SKU-1", name: "Filter", qtyPlanned: 2 },
            { sku: "LEGACY-9", qtyUsed: 3 }, // nothing planned -> nothing to lose
          ],
        })}
        deps={deps()}
      />,
    );
    expect(screen.getByRole("button", { name: /edit parts plan/i })).toBeTruthy();
  });

  it("OD-3: planned rows use snapshot name/category/unit or the neutral fallback, with NO catalog lookup", async () => {
    // This invariant moved here with the planned-parts display. A row with no recorded name/category/
    // unit must degrade to raw SKU / neutral marker / "unit(s)" -- never a value invented from a
    // static catalog.
    render(
      <WorkOrderPartsPlanEditor
        workOrder={wo({
          inventorySnapshot: [
            { partId: "P-1", sku: "TST-9001", name: "RECORDED-A", category: "Valves", unit: "each", qtyPlanned: 2, qtyUsed: 1 },
            { partId: "P-2", sku: "TST-9002", qtyPlanned: 3 },
          ],
        })}
        deps={deps()}
      />,
    );
    expect(screen.getByText("RECORDED-A")).toBeTruthy();
    expect(screen.getByText("Valves")).toBeTruthy();
    expect(screen.getByText(/each/)).toBeTruthy();
    // name-less row degrades to its raw SKU, with the neutral category/unit fallbacks
    expect(screen.getAllByText("TST-9002").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/unit\(s\)/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("STATIC-LEAK");
  });

  it("after a successful save, renders the PERSISTED plan rather than optimistic client state", async () => {
    const d = deps();
    const { rerender } = render(<WorkOrderPartsPlanEditor workOrder={wo()} deps={d} />);
    await beginEdit();
    fireEvent.change(screen.getByLabelText(/planned quantity for Filter/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save parts plan/i }));
    await waitFor(() => expect(d.client).toHaveBeenCalled());

    // The live document listener has not yet delivered the new value; the component must show what
    // is persisted (2), never the value it optimistically hoped for (7).
    rerender(<WorkOrderPartsPlanEditor workOrder={wo()} deps={d} />);
    await waitFor(() => expect(screen.queryByLabelText(/planned quantity/i)).toBeNull());
    const row = screen.getByRole("row", { name: /Filter/ });
    expect(row.textContent).toContain("2");
    expect(row.textContent).not.toContain("7");
  });
});
