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
// reads the governed Reorder queue + Reorder Purchase Orders -- never Firestore, and
// never `purchase_orders` -- and returns a non-empty row when a matching PO exists.
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
  id: "req-1",
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

// BOTH SIDES MOVED to the governed PostgreSQL Reorder authority (the Reorder Requests through
// readReorderQueue, and -- since the Reorder activation -- their purchase orders through
// readReorderPurchaseOrders). The point of this suite survives the move intact: the panel must read
// the LIVE reorder purchase orders and never the dormant Epic-5 collection. It now also proves the
// frozen Firestore reorder_purchase_orders snapshot is not read at all.
const reorderCalls = [];
// Admin full-access defect (2026-10-09): when set, the governed queue read refuses as it does for a caller without the
// REORDER_QUEUE Operational Scope.
let refuseQueue = false;
vi.mock("../src/services/reorderApiClient.js", () => ({
  reorderApiClient: {
    call: async (operation, input) => {
      reorderCalls.push({ operation, input });
      if (refuseQueue && operation === "readReorderQueue") {
        return { ok: false, code: "FORBIDDEN", message: "reading the Reorder queue requires the REORDER_QUEUE Operational Scope" };
      }
      if (operation === "readReorderPurchaseOrders") return { ok: true, result: { purchaseOrders: [FIXTURE_PO] } };
      return { ok: true, result: [{ ...FIXTURE_REQUEST, id: FIXTURE_REQUEST.id }] };
    },
  },
}));
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ __collection: name }),
  query: (ref, ...constraints) => ({ __collection: ref.__collection, constraints }),
  where: (field, op, value) => ({ field, op, value }),
  documentId: () => "__name__",
  orderBy: () => ({}),
  limit: () => ({}),
  getDocs: async (q) => {
    queriedCollections.push(q.__collection);
    // Every Firestore collection is empty in this fixture: the procurement rows can only come from the
    // governed reads above.
    return { docs: [], forEach: () => {} };
  },
}));

afterEach(() => {
  cleanup();
  refuseQueue = false;
  queriedCollections.length = 0;
  reorderCalls.length = 0;
});

describe("operationsQueries.fetchProcurementPurchaseOrders (site-work r4 item A)", () => {
  it("reads Reorders AND their purchase orders from the governed authority -- never Firestore", async () => {
    const { fetchProcurementPurchaseOrders } = await import("../src/services/operationsQueries");
    const rows = await fetchProcurementPurchaseOrders();

    // Neither side touches Firestore at all.
    expect(reorderCalls.map((c) => c.operation)).toEqual(["readReorderQueue", "readReorderPurchaseOrders"]);
    expect(reorderCalls[1].input).toEqual({ reorderRequestIds: ["req-1"] });
    expect(queriedCollections).not.toContain("reorder_requests");
    expect(queriedCollections).not.toContain("reorder_purchase_orders");
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
// The dashboard's INVENTORY truth is EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): stock
// health from the governed on-hand / movement loader, warehouses from eos_ops, transfer orders from the EOS list.
vi.mock("../src/hooks/useInventoryLedger.js", () => ({
  loadEosInventoryHealth: async () => ({ transactions: [], healthEntries: [], integrity: { state: "COMPLETE", reason: null, unavailablePartIds: [] } }),
}));
vi.mock("../src/services/inventoryLocationClient.js", () => ({ fetchInventoryWarehouseOptions: async () => [] }));
vi.mock("../src/services/transferCommandClient.js", () => ({ listTransferOrderDocs: async () => ({ items: [], truncated: false }) }));
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

// Admin full-access defect (2026-10-09): one refused read must not blank the whole Inventory & Supply Overview.
describe("Operations -- a refused Reorder queue read stays inside the Procurement panel", () => {
  it("renders the other panels and says why purchase orders are unavailable", async () => {
    refuseQueue = true;
    const Operations = (await import("../src/modules/operations/Operations.jsx")).default;
    render(<Operations accessVersion={1} />);
    const note = await screen.findByText(/Purchase orders aren't available: reading the Reorder queue requires the REORDER_QUEUE Operational Scope/);
    expect(note.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Warehouse" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Procurement" })).toBeTruthy();
    expect(screen.queryByText("No purchase orders yet.")).toBeNull();
  });
});
