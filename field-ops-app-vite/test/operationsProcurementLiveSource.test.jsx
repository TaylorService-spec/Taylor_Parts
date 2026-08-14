// site-work r4 item A -- proves the Operations dashboard's Procurement panel now
// sources the LIVE `reorder_purchase_orders` collection (written by
// domain/reorderPurchaseOrders.js's recordPurchaseOrder()/voidPurchaseOrder(), the
// same source Purchasing > Purchase Orders reads) instead of the dormant Epic-5
// `purchase_orders` collection (only writer: a demo seed script, no deployed
// callable). Before this fix, fetchPurchaseOrders() read `purchase_orders`
// unconditionally, so the panel was permanently empty in production even with
// live reorder purchase orders present -- exactly the bug this test pins.
//
// Part 1 (unit): services/operationsQueries.ts's fetchProcurementPurchaseOrders()
// queries `reorder_requests` + `reorder_purchase_orders` -- never `purchase_orders`
// -- and returns a non-empty row when reorder_purchase_orders has a matching row.
//
// Part 2 (integration): Operations.jsx wires fetchProcurementPurchaseOrders() (not
// fetchPurchaseOrders()) into ProcurementPanel, and the panel renders the live row.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---- Part 1: fetchProcurementPurchaseOrders reads the LIVE collections ----------
const FIXTURE_REQUEST = {
  id: "req-1",
  partId: "PART-77",
  status: "ORDERED",
  orderedBy: "uid-associate",
  orderedAt: 5000,
};
const FIXTURE_PO = {
  reorderRequestId: "req-1",
  partId: "PART-77",
  supplierName: "Acme Supply Co",
  externalPoNumber: "PO-9001",
  orderedQuantity: 12,
  orderedDate: "2026-08-01",
  expectedArrivalDate: "2026-08-10",
  status: "ORDERED",
  createdBy: "uid-associate",
  createdAt: 5000,
};

// Records every collection name this test's Firestore mock is asked to read, so
// the assertions can prove `purchase_orders` (dormant) is never touched and
// `reorder_requests` / `reorder_purchase_orders` (live) are.
const queriedCollections = [];

vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ __collection: name }),
  query: (ref, ...constraints) => ({ __collection: ref.__collection, constraints }),
  where: (field, op, value) => ({ field, op, value }),
  documentId: () => "__name__",
  getDocs: async (q) => {
    queriedCollections.push(q.__collection);
    let docs = [];
    if (q.__collection === "reorder_requests") {
      docs = [{ id: FIXTURE_REQUEST.id, data: () => FIXTURE_REQUEST }];
    } else if (q.__collection === "reorder_purchase_orders") {
      docs = [{ id: FIXTURE_PO.reorderRequestId, data: () => FIXTURE_PO }];
    }
    // The dormant Epic-5 `purchase_orders` collection (or anything else): always
    // empty in this fixture -- if the fix regresses to reading it, Part 1's "never
    // queries purchase_orders" assertion fails, and Part 2's row would come back
    // empty instead of populated.
    return { docs, forEach: (fn) => docs.forEach(fn) };
  },
}));

afterEach(() => {
  cleanup();
  queriedCollections.length = 0;
});

describe("operationsQueries.fetchProcurementPurchaseOrders (site-work r4 item A)", () => {
  it("queries reorder_requests + reorder_purchase_orders, never the dormant purchase_orders collection", async () => {
    const { fetchProcurementPurchaseOrders } = await import("../src/services/operationsQueries");
    const rows = await fetchProcurementPurchaseOrders();

    expect(queriedCollections).toContain("reorder_requests");
    expect(queriedCollections).toContain("reorder_purchase_orders");
    expect(queriedCollections).not.toContain("purchase_orders");

    // Non-empty when reorder_purchase_orders has a row -- this is the exact
    // fail-pre/pass-post gate: reading the dormant collection would yield [].
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      reorderRequestId: "req-1",
      partId: "PART-77",
      supplierName: "Acme Supply Co",
      externalPoNumber: "PO-9001",
      orderedQuantity: 12,
      viewStatus: "OPEN",
    });
  });
});

// ---- Part 2: Operations.jsx wires the live fetch into ProcurementPanel ----------
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useCanonicalPartNames", () => ({
  useCanonicalPartNames: () => ({ resolveName: (id) => id, namesUnavailable: false }),
}));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({
  normalizeLedgerTransaction: (t) => t,
  generateInventoryHealthDashboard: () => [],
  computeAvailableStockByPart: () => new Map(),
}));
vi.mock("../src/domain/warehouseReconciliationEngine", () => ({
  detectStockDiscrepancies: () => [],
  generateReconciliationReport: () => ({ totalDiscrepancies: 0 }),
}));
vi.mock("../src/domain/procurementDraftEngine", () => ({ generateProcurementDrafts: () => [] }));
vi.mock("../src/analytics/executionAnalyticsService", () => ({
  getInventoryConsumptionSnapshot: async () => ({ parts: [] }),
  getTechnicianVolumeBreakdown: async () => [],
}));

describe("Operations dashboard Procurement panel (site-work r4 item A) -- mounted", () => {
  it("renders a live reorder_purchase_orders row (non-empty procurement panel)", async () => {
    const Operations = (await import("../src/modules/operations/Operations.jsx")).default;
    render(<Operations accessVersion={1} />);

    // The live PO's own fields render -- proves the panel is fed by the live
    // fetch, not silently stuck on "No purchase orders yet." (the dormant-read bug).
    expect(await screen.findByText("Acme Supply Co")).toBeTruthy();
    expect(screen.getByText("PO-9001")).toBeTruthy();
    expect(screen.queryByText("No purchase orders yet.")).toBeNull();
  });
});
