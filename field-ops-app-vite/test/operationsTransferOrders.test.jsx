// EI-P1c-2 -- focused render test (vitest + jsdom) for the location-aware Transfer Orders
// table in WarehousePanel. WarehousePanel is a pure renderer and buildTransferOrdersView +
// the transfer-order adapter are pure, so NO Firebase/service mocks are needed. Proves:
// columns (Part | Origin | Destination | Status), no Quantity column, WAREHOUSE names +
// non-warehouse type badges, invalid-record hidden warning (never a partial row), empty
// state, no action/write controls, and a horizontal-scroll wrapper.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WarehousePanel from "../src/modules/operations/panels/WarehousePanel.jsx";

afterEach(cleanup);

const WAREHOUSES = [{ id: "WH-1", name: "Main Warehouse" }, { id: "WH-2", name: "Satellite" }];
const NO_RECON = { totalDiscrepancies: 0 };
const resolveName = (id) => `NAME(${id})`;

function renderPanel(transferOrders) {
  return render(
    <WarehousePanel
      warehouses={WAREHOUSES}
      stockLocations={[]}
      transferOrders={transferOrders}
      reconciliationReport={NO_RECON}
      resolveName={resolveName}
    />,
  );
}

describe("WarehousePanel location-aware Transfer Orders table", () => {
  it("renders Part | Origin | Destination | Status and NO Quantity column", () => {
    renderPanel([{ id: "TO-1", partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", quantity: 9, status: "COMPLETED" }]);
    expect(screen.getByText("Origin")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
    // "Part" and "Status" appear as headers.
    expect(screen.getAllByText("Part").length).toBeGreaterThan(0);
    expect(screen.getByText("Status")).toBeTruthy();
    // No Quantity column anywhere in the panel.
    expect(screen.queryByText("Quantity")).toBeNull();
    // Warehouse names resolved; part resolved via resolveName.
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
    expect(screen.getByText("Satellite")).toBeTruthy();
    expect(screen.getByText("NAME(PART-1)")).toBeTruthy();
    expect(screen.getByText("COMPLETED")).toBeTruthy();
  });

  it("shows a type badge + raw locationId for non-warehouse endpoints", () => {
    renderPanel([{ id: "TO-2", partId: "PART-1", origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "MOBILE", locationId: "TRUCK-7" }, status: "IN_TRANSIT" }]);
    const badge = screen.getByText("MOBILE");
    expect(badge.className).toContain("fo-badge");
    expect(screen.getByText("TRUCK-7")).toBeTruthy();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
  });

  it("counts invalid/contradictory records in a hidden warning and never renders them", () => {
    renderPanel([
      { id: "TO-VALID", partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" },
      { id: "TO-BAD", partId: "PART-2", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "PENDING" },
    ]);
    expect(screen.getByText(/1 transfer order hidden/i)).toBeTruthy();
    // The valid row renders; the invalid one never leaks (its status/part are absent).
    expect(screen.getByText("NAME(PART-1)")).toBeTruthy();
    expect(screen.queryByText("PENDING")).toBeNull();
    expect(screen.queryByText("NAME(PART-2)")).toBeNull();
  });

  it("shows the empty state when there are no transfer orders", () => {
    renderPanel([]);
    expect(screen.getByText("No transfer orders.")).toBeTruthy();
  });

  it("has no action/write controls and wraps the table for horizontal scrolling", () => {
    const { container } = renderPanel([{ id: "TO-1", partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "REQUESTED" }]);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector(".fo-table-scroll")).toBeTruthy();
  });
});
