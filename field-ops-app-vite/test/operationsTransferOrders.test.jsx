// EI-P1c-2 -- render tests (vitest + jsdom).
//
// Part 1: focused WarehousePanel render tests (pure renderer; no mocks needed) -- columns
// (Part | Origin | Destination | Status), no Quantity column, WAREHOUSE names + non-
// warehouse type badges, invalid-record hidden warning (never a partial row), empty state,
// no action/write controls, and a horizontal-scroll wrapper.
//
// Part 2: mounted Operations tests for the fail-closed accessVersion invalidation -- on an
// access-boundary change, prior-scope rows disappear SYNCHRONOUSLY (back to loading) and a
// stale prior-version read completion can never restore them.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// Controllable state for the mounted-Operations tests (Part 2). The WarehousePanel-direct
// tests (Part 1) don't touch any mocked module, so these mocks don't affect them.
const h = vi.hoisted(() => ({
  warehouses: [],
  transferResult: () => Promise.resolve([]),
}));
vi.mock("../src/services/operationsQueries", () => ({
  fetchInventoryTransactions: async () => [],
  fetchWarehouses: async () => h.warehouses,
  fetchTransferOrderDocs: () => h.transferResult(),
  fetchTransferOrders: async () => [],
  fetchSuppliers: async () => [],
  fetchSupplierCatalog: async () => [],
  fetchProcurementPurchaseOrders: async () => [],
}));
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ collection: () => ({}), getDocs: async () => ({ docs: [] }) }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useCanonicalPartNames", () => ({ useCanonicalPartNames: () => ({ resolveName: (id) => id, namesUnavailable: false }) }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ normalizeLedgerTransaction: (t) => t, generateInventoryHealthDashboard: () => [], computeAvailableStockByPart: () => new Map() }));
vi.mock("../src/domain/warehouseReconciliationEngine", () => ({ detectStockDiscrepancies: () => [], generateReconciliationReport: () => ({ totalDiscrepancies: 0 }) }));
vi.mock("../src/domain/procurementDraftEngine", () => ({ generateProcurementDrafts: () => [] }));
vi.mock("../src/analytics/executionAnalyticsService", () => ({ getInventoryConsumptionSnapshot: async () => ({ parts: [] }), getTechnicianVolumeBreakdown: async () => [] }));

import WarehousePanel from "../src/modules/operations/panels/WarehousePanel.jsx";
import Operations from "../src/modules/operations/Operations.jsx";

afterEach(cleanup);

const WAREHOUSES = [{ id: "WH-1", name: "Main Warehouse" }, { id: "WH-2", name: "Satellite" }];
const resolveName = (id) => `NAME(${id})`;
const legacyDoc = (docId, status) => ({ docId, data: { partId: "PART-1", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", quantity: 9, status } });

function renderPanel(transferOrderDocs) {
  return render(
    <WarehousePanel
      warehouses={WAREHOUSES}
      transferOrderDocs={transferOrderDocs}
      resolveName={resolveName}
    />,
  );
}

describe("WarehousePanel location-aware Transfer Orders table", () => {
  it("renders Part | Origin | Destination | Status and NO Quantity column", () => {
    renderPanel([legacyDoc("TO-1", "COMPLETED")]);
    expect(screen.getByText("Origin")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getAllByText("Part").length).toBeGreaterThan(0);
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.queryByText("Quantity")).toBeNull();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
    expect(screen.getByText("Satellite")).toBeTruthy();
    expect(screen.getByText("NAME(PART-1)")).toBeTruthy();
    expect(screen.getByText("COMPLETED")).toBeTruthy();
  });

  it("shows a type badge + raw locationId for non-warehouse endpoints", () => {
    renderPanel([{ docId: "TO-2", data: { partId: "PART-1", origin: { type: "WAREHOUSE", locationId: "WH-1" }, destination: { type: "MOBILE", locationId: "TRUCK-7" }, status: "IN_TRANSIT" } }]);
    const badge = screen.getByText("MOBILE");
    expect(badge.className).toContain("fo-status-pill");
    expect(screen.getByText("TRUCK-7")).toBeTruthy();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
  });

  it("counts invalid/contradictory records in a hidden warning and never renders them", () => {
    renderPanel([
      legacyDoc("TO-VALID", "REQUESTED"),
      { docId: "TO-BAD", data: { partId: "PART-2", fromWarehouseId: "WH-1", toWarehouseId: "WH-2", status: "PENDING" } },
    ]);
    expect(screen.getByText(/1 transfer order hidden/i)).toBeTruthy();
    expect(screen.getByText("NAME(PART-1)")).toBeTruthy();
    expect(screen.queryByText("PENDING")).toBeNull();
    expect(screen.queryByText("NAME(PART-2)")).toBeNull();
  });

  it("shows the empty state when there are no transfer orders", () => {
    renderPanel([]);
    expect(screen.getByText("No transfer orders.")).toBeTruthy();
  });

  it("has no action/write controls and wraps the table for horizontal scrolling", () => {
    const { container } = renderPanel([legacyDoc("TO-1", "REQUESTED")]);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector(".fo-table-scroll")).toBeTruthy();
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Operations accessVersion fail-closed invalidation", () => {
  it("drops prior-scope rows synchronously on an accessVersion change (before new read settles)", async () => {
    h.warehouses = WAREHOUSES;
    h.transferResult = () => Promise.resolve([legacyDoc("TO-1", "REQUESTED")]);
    let view;
    await act(async () => {
      view = render(<Operations accessVersion={1} />);
    });
    expect(screen.getByText("REQUESTED")).toBeTruthy();

    // Access changes; the new read is hung (never settles).
    const hung = deferred();
    h.transferResult = () => hung.promise;
    await act(async () => {
      view.rerender(<Operations accessVersion={2} />);
    });
    // Prior-scope row is gone immediately even though the new read has not settled.
    expect(screen.queryByText("REQUESTED")).toBeNull();

    // Clean up the pending read.
    await act(async () => {
      hung.resolve([]);
    });
  });

  it("a stale prior-version read completion can never restore prior rows", async () => {
    h.warehouses = WAREHOUSES;
    // v1 read is deferred (pending) -> mount stays in loading, no rows.
    const d1 = deferred();
    h.transferResult = () => d1.promise;
    let view;
    await act(async () => {
      view = render(<Operations accessVersion={1} />);
    });
    expect(screen.queryByText("CANCELLED")).toBeNull();

    // Access changes to v2 (own deferred) BEFORE v1 settles.
    const d2 = deferred();
    h.transferResult = () => d2.promise;
    await act(async () => {
      view.rerender(<Operations accessVersion={2} />);
    });

    // The STALE v1 read now completes -> it must NOT restore a v1-scope row.
    await act(async () => {
      d1.resolve([legacyDoc("TO-STALE", "CANCELLED")]);
    });
    expect(screen.queryByText("CANCELLED")).toBeNull();

    // The fresh v2 read completes -> its rows render.
    await act(async () => {
      d2.resolve([legacyDoc("TO-FRESH", "COMPLETED")]);
    });
    expect(screen.getByText("COMPLETED")).toBeTruthy();
  });
});
