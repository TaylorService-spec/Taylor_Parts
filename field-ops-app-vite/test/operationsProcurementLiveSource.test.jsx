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

// Records every SOURCE ID the governed client is asked for, so the assertions can still prove
// the dormant Epic-5 purchase orders are never read and the live ones are.
//
// The mock moved from firebase/firestore to the governed client because that is what this code
// now talks to: the client names an EOS source id and the server owns the collection. Left
// mocking Firestore, these tests would have gone on passing against a module the code under test
// no longer imports -- green, and proving nothing.
const queriedSources = [];

vi.mock("../src/access/governedCollectionClient", () => {
  const read = async ({ sourceId }) => {
    queriedSources.push(sourceId);
    let items = [];
    if (sourceId === "reorderRequestsQueue") {
      items = [{ ...FIXTURE_REQUEST }];
    } else if (sourceId === "purchaseOrdersByIds") {
      items = [{ ...FIXTURE_PO, id: FIXTURE_PO.reorderRequestId }];
    }
    // `legacyPurchaseOrders` (the dormant Epic-5 collection) and anything else: always empty in
    // this fixture, so a regression to it fails Part 1's "never reads the dormant source"
    // assertion AND leaves Part 2's panel empty.
    return { ok: true, result: "OK", items, hasMore: false, nextCursor: null };
  };
  return {
    READ_RESULT: { OK: "OK", DENIED: "DENIED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" },
    readGovernedList: read,
    governedCollectionClient: { readGovernedList: read, readAllGoverned: read },
  };
});

afterEach(() => {
  cleanup();
  queriedSources.length = 0;
});

describe("operationsQueries.fetchProcurementPurchaseOrders (site-work r4 item A)", () => {
  it("reads the LIVE reorder sources, never the dormant legacy purchase orders", async () => {
    const { fetchProcurementPurchaseOrders } = await import("../src/services/operationsQueries");
    const rows = await fetchProcurementPurchaseOrders();

    expect(queriedSources).toContain("reorderRequestsQueue");
    expect(queriedSources).toContain("purchaseOrdersByIds");
    expect(queriedSources).not.toContain("legacyPurchaseOrders");

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
