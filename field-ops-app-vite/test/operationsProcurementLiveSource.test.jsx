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
// Supplier read isolation (2026-10-09), now on EOS (Firebase exit F2, 2026-10-17): the supplier list is EOS listSuppliers
// and the supplier catalog is each recommended Part's governed terms (listPartSupplierItems). Each can be refused on its
// own, with the server's own message.
const refuseOps = new Set();
const EOS_REFUSED = "this read requires a capability the caller does not hold";
let supplierRows = [];
// listPartSupplierItems answers per Part: a list of items, or { refuse: code } for that Part only.
let termsByPart = {};
vi.mock("../src/services/reorderApiClient.js", () => {
  const call = async (operation, input) => {
    reorderCalls.push({ operation, input });
    if (refuseQueue && operation === "readReorderQueue") {
      return { ok: false, code: "FORBIDDEN", message: "reading the Reorder queue requires the REORDER_QUEUE Operational Scope" };
    }
    if (refuseOps.has(operation)) return { ok: false, code: "FORBIDDEN", message: EOS_REFUSED };
    if (operation === "readReorderPurchaseOrders") return { ok: true, result: { purchaseOrders: [FIXTURE_PO] } };
    if (operation === "listSuppliers") return { ok: true, result: { items: supplierRows.map((s) => ({ supplierId: s.id, name: s.name })) } };
    if (operation === "listPartSupplierItems") {
      const terms = termsByPart[input.partId] ?? [];
      if (terms.refuse) return { ok: false, code: terms.refuse, message: `refused ${input.partId}` };
      return { ok: true, result: { partId: input.partId, items: terms } };
    }
    return { ok: true, result: [{ ...FIXTURE_REQUEST, id: FIXTURE_REQUEST.id }] };
  };
  return { reorderApiClient: { call }, callReorderApi: call };
});
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
  refuseOps.clear();
  supplierRows = [];
  termsByPart = {};
  generateDraftsCalls.length = 0;
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
// One Part needs reordering, so the Procurement panel reads that Part's governed supplier terms.
vi.mock("../src/hooks/useInventoryLedger.js", () => ({
  loadEosInventoryHealth: async () => ({
    transactions: [],
    healthEntries: [{ partId: "PART-99", stock: { availableStock: 1 }, usage: null,
      recommendation: { urgency: "HIGH", recommendedOrderQty: 4, daysRemaining: Infinity } }],
    integrity: { state: "COMPLETE", reason: null, unavailablePartIds: [] },
  }),
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
  hasUsageHistory: () => false,
}));
vi.mock("../src/domain/warehouseReconciliationEngine", () => ({
  detectStockDiscrepancies: () => [],
  generateReconciliationReport: () => ({ totalDiscrepancies: 0 }),
}));
// One draft naming supplier "sup-1", so the Suggested Supplier column's name resolution is visible.
const generateDraftsCalls = [];
vi.mock("../src/domain/procurementDraftEngine", () => ({
  generateProcurementDrafts: (recommendations, catalog) => {
    generateDraftsCalls.push(catalog);
    return [{ partId: "PART-88", recommendedQuantity: 4, urgency: "HIGH", suggestedSupplierId: "sup-1", estimatedUnitPrice: 2.5, estimatedTotalCost: 10 }];
  },
}));
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

// Supplier read isolation (2026-10-09, nonprod evidence): an EOS-only Administrator session was refused the then-Firestore
// supplier reads and the WHOLE Overview showed "Failed to load". Each supplier read -- EOS since Firebase exit F2 -- fails
// on its own, inside the Procurement panel; every other panel and the purchase orders still render.
describe("Operations -- a refused supplier read stays inside the Procurement panel", () => {
  const renderOverview = async () => {
    const Operations = (await import("../src/modules/operations/Operations.jsx")).default;
    render(<Operations accessVersion={1} />);
    await screen.findByRole("heading", { name: "Procurement" });
  };
  const otherPanelsRender = () => {
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Warehouse" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Execution Insights" })).toBeTruthy();
    expect(screen.getByText("Acme Supply Co")).toBeTruthy(); // the purchase orders (EOS) still render
  };

  it("the supplier LIST refused: names say unavailable, drafts still render, nothing else blanks", async () => {
    refuseOps.add("listSuppliers");
    await renderOverview();
    otherPanelsRender();
    const note = screen.getByText(`Supplier names aren't available: ${EOS_REFUSED}`);
    expect(note.hasAttribute("data-suppliers-unavailable")).toBe(true);
    expect(screen.getByText("Supplier name unavailable")).toBeTruthy(); // never "Unknown supplier" or the raw id
    expect(screen.queryByText("sup-1")).toBeNull();
    expect(screen.queryByText(/supplier catalog could not be read/)).toBeNull();
  });

  it("the supplier CATALOG refused: draft proposals are said unavailable, not 'No supplier available' rows", async () => {
    refuseOps.add("listPartSupplierItems");
    await renderOverview();
    otherPanelsRender();
    const note = screen.getByText(`Draft proposals aren't available: the supplier catalog could not be read (${EOS_REFUSED}).`);
    expect(note.hasAttribute("data-supplier-catalog-unavailable")).toBe(true);
    expect(generateDraftsCalls).toEqual([]); // no drafts are generated from an empty stand-in catalog
    expect(screen.queryByText("PART-88")).toBeNull();
    expect(screen.queryByText(/No draft proposals/)).toBeNull();
    expect(screen.queryByText(/Supplier names aren't available/)).toBeNull();
  });

  it("both supplier reads AND the Reorder queue refused: each is said in place; the EOS panels still render", async () => {
    refuseOps.add("listSuppliers");
    refuseOps.add("listPartSupplierItems");
    refuseQueue = true;
    const Operations = (await import("../src/modules/operations/Operations.jsx")).default;
    render(<Operations accessVersion={1} />);
    await screen.findByRole("heading", { name: "Procurement" });
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Warehouse" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Execution Insights" })).toBeTruthy();
    expect(screen.getByText(/Purchase orders aren't available/)).toBeTruthy();
    expect(screen.getByText(/Supplier names aren't available/)).toBeTruthy();
    expect(screen.getByText(/supplier catalog could not be read/)).toBeTruthy();
  });

  it("both supplier reads succeed: no unavailable notes, drafts render with the resolved supplier name", async () => {
    supplierRows = [{ id: "sup-1", name: "Northwind Parts" }];
    await renderOverview();
    otherPanelsRender();
    expect(screen.getByText("Northwind Parts")).toBeTruthy();
    expect(screen.getByText("PART-88")).toBeTruthy();
    expect(generateDraftsCalls).toHaveLength(1);
    // Both are EOS reads: the recommended Part's terms were read, and no Firestore supplier collection was touched.
    expect(reorderCalls.filter((c) => c.operation === "listPartSupplierItems").map((c) => c.input)).toEqual([{ partId: "PART-99" }]);
    expect(queriedCollections).not.toContain("suppliers");
    expect(queriedCollections).not.toContain("supplier_catalog");
    expect(screen.queryByText(/aren't available/)).toBeNull();
    expect(screen.queryByText("Supplier name unavailable")).toBeNull();
  });
});

// ---- Firebase exit F2: the supplier catalog is the governed EOS part-supplier terms --------------------------------
const item = (over) => ({ itemId: `${over.partId}__${over.supplierId}`, status: "ACTIVE", availability: "AVAILABLE", preferred: false,
  cost: "10.00", currency: "USD", ...over });

describe("fetchSupplierCatalogForParts (EOS listPartSupplierItems, per recommended Part)", () => {
  it("maps each governed item to the draft engine's shape; a withheld cost is null, never a number", async () => {
    termsByPart = {
      "P-1": [item({ partId: "P-1", supplierId: "s-a", cost: "12.50" }), item({ partId: "P-1", supplierId: "s-b", availability: "UNAVAILABLE" })],
      "P-2": [item({ partId: "P-2", supplierId: "s-a", cost: undefined, currency: undefined, preferred: true })], // COMMERCIAL withheld
    };
    const { fetchSupplierCatalogForParts } = await vi.importActual("../src/services/partsOperationsReads.js");
    const rows = await fetchSupplierCatalogForParts(["P-1", "P-2", "P-1"]);
    expect(reorderCalls.filter((c) => c.operation === "listPartSupplierItems").map((c) => c.input.partId)).toEqual(["P-1", "P-2"]);
    expect(rows).toEqual([
      { id: "P-1__s-a", supplierId: "s-a", partId: "P-1", unitPrice: 12.5, currency: "USD", available: true, preferred: false },
      { id: "P-1__s-b", supplierId: "s-b", partId: "P-1", unitPrice: 10, currency: "USD", available: false, preferred: false },
      { id: "P-2__s-a", supplierId: "s-a", partId: "P-2", unitPrice: null, currency: null, available: true, preferred: true },
    ]);
  });

  it("a Part the Catalog does not hold contributes nothing; any other refusal fails the whole catalog", async () => {
    const { fetchSupplierCatalogForParts } = await vi.importActual("../src/services/partsOperationsReads.js");
    termsByPart = { "P-1": [item({ partId: "P-1", supplierId: "s-a" })], "P-GONE": { refuse: "NOT_FOUND" } };
    expect((await fetchSupplierCatalogForParts(["P-1", "P-GONE"])).map((r) => r.id)).toEqual(["P-1__s-a"]);
    termsByPart = { "P-1": { refuse: "FORBIDDEN" } };
    await expect(fetchSupplierCatalogForParts(["P-1"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("generateProcurementDrafts over governed terms", () => {
  const rec = (partId) => ({ partId, recommendedQuantity: 3, urgency: "HIGH", source: "EPIC3_ANALYTICS" });
  it("picks the cheapest available item when prices are readable in one currency (the rule it always had)", async () => {
    const { generateProcurementDrafts } = await vi.importActual("../src/domain/procurementDraftEngine");
    const drafts = generateProcurementDrafts([rec("P-1")], [
      { id: "a", supplierId: "s-a", partId: "P-1", unitPrice: 9, currency: "USD", available: true, preferred: true },
      { id: "b", supplierId: "s-b", partId: "P-1", unitPrice: 7, currency: "USD", available: true, preferred: false },
      { id: "c", supplierId: "s-c", partId: "P-1", unitPrice: 1, currency: "USD", available: false, preferred: false },
    ]);
    expect(drafts[0]).toMatchObject({ suggestedSupplierId: "s-b", estimatedUnitPrice: 7, estimatedTotalCost: 21 });
  });
  it("cost withheld: the PREFERRED supplier is suggested and no price is estimated", async () => {
    const { generateProcurementDrafts } = await vi.importActual("../src/domain/procurementDraftEngine");
    const drafts = generateProcurementDrafts([rec("P-1")], [
      { id: "a", supplierId: "s-a", partId: "P-1", unitPrice: null, available: true, preferred: false },
      { id: "b", supplierId: "s-b", partId: "P-1", unitPrice: null, available: true, preferred: true },
    ]);
    expect(drafts[0]).toMatchObject({ suggestedSupplierId: "s-b", estimatedUnitPrice: null, estimatedTotalCost: null });
  });
});
