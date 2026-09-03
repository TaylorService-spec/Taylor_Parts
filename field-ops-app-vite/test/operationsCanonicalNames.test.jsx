// OD-3 -- Operations dashboard integration gate (vitest + jsdom). Mounts the REAL Operations
// with the REAL useCanonicalPartNames hook + REAL panels; only the data services and Firebase
// are mocked. A procurement draft carrying partId "TST-9001" is injected so ProcurementPanel
// exercises resolveName. Proves, on the mounted path: ONE canonical read for the whole
// dashboard (not one per panel); READY -> canonical names; invalid/denied -> raw partIds +
// the bounded notice, with the panels' tables preserved and no static name / no raw invalid
// leak; and synchronous accessVersion boundary-key invalidation (prior names gone immediately
// on an access change, before the replacement read settles).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// Tiny static catalog so the shared composer fully accounts for the one canonical part.
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ collection: () => ({}), getDocs: async () => ({ docs: [] }) }));
vi.mock("../src/services/operationsQueries", () => ({
  fetchInventoryTransactions: async () => [], fetchWarehouses: async () => [],
  fetchTransferOrders: async () => [], fetchTransferOrderDocs: async () => [], fetchSuppliers: async () => [], fetchSupplierCatalog: async () => [],
  fetchProcurementPurchaseOrders: async () => [],
}));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({
  normalizeLedgerTransaction: (t) => t, generateInventoryHealthDashboard: () => [], computeAvailableStockByPart: () => new Map(),
}));
vi.mock("../src/domain/warehouseReconciliationEngine", () => ({
  detectStockDiscrepancies: () => [], generateReconciliationReport: () => ({ totalDiscrepancies: 0 }),
}));
// Inject one procurement draft carrying a partId so ProcurementPanel renders a resolved name.
vi.mock("../src/domain/procurementDraftEngine", () => ({
  generateProcurementDrafts: () => [{ partId: "TST-9001", recommendedQuantity: 3, urgency: "HIGH", suggestedSupplierId: null, estimatedUnitPrice: null, estimatedTotalCost: null }],
}));
vi.mock("../src/analytics/executionAnalyticsService", () => ({
  getInventoryConsumptionSnapshot: async () => ({ parts: [] }), getTechnicianVolumeBreakdown: async () => [],
}));
// Spy: capture the resolveName Operations passes into its Inventory Health panel (5th mount coverage here).
const capturedIHP = [];
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: ({ resolveName }) => { capturedIHP.push(resolveName); return null; } }));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import Operations from "../src/modules/operations/Operations.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOTICE = /Some part names are unavailable; Part IDs are shown/i;
const READY = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [] };

describe("Operations (OD-3) -- dashboard canonical name resolution, mounted path", () => {
  it("READY: ONE canonical read for the dashboard; ProcurementPanel shows the canonical name; no static name; no notice", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<Operations accessVersion={1} />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(fetchPartMasterList).toHaveBeenCalledTimes(1); // one shared read, not one per panel
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    // the Inventory Health panel mount receives the SAME single canonical resolver
    expect(capturedIHP[capturedIHP.length - 1]("TST-9001")).toBe("CANONICAL-NAME-A");
    // OD-3 closure: the header copy keeps the static-baseline / not-live-stock meaning but no
    // longer renders a static parts count.
    const copy = document.body.textContent;
    expect(copy).toMatch(/static baseline/);
    expect(copy).toMatch(/not live stock/);
    expect(copy).not.toMatch(/\(\d+ parts\)/);
  });

  it("invalid canonical documents: raw partId + bounded notice; draft row (table) preserved; no static name; no raw invalid leak", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: READY.parts, invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value" }] });
    render(<Operations accessVersion={1} />);
    await screen.findByText(NOTICE);
    expect(screen.getByText("TST-9001")).toBeTruthy();          // fail-closed name
    expect(screen.getByText("3")).toBeTruthy();                  // draft recommendedQuantity -- table preserved
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
    expect(document.body.textContent.includes("secretField")).toBe(false);
  });

  it("accessVersion change fail-closes prior data + names immediately; a denied replacement leaves raw partId + notice", async () => {
    // Deferred reads so we control resolution ordering across the accessVersion change.
    const deferreds = [];
    fetchPartMasterList.mockImplementation(() => { let r; const p = new Promise((res) => { r = res; }); deferreds.push({ resolve: r }); return p; });
    const { rerender } = render(<Operations accessVersion={1} />);
    await act(async () => { deferreds[0].resolve(READY); });
    await screen.findByText("CANONICAL-NAME-A");

    rerender(<Operations accessVersion={2} />); // same UID, access changes
    // EI-P1c-2 / P2-1: prior-scope DATA and names now invalidate SYNCHRONOUSLY -- the
    // dashboard fail-closes to loading before the replacement reads settle, so previously
    // authorized data can never linger during a slow/hung re-read.
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();   // prior name unrenderable immediately
    expect(screen.queryByText("TST-9001")).toBeNull();           // prior-scope data cleared (not preserved)

    await act(async () => { deferreds[deferreds.length - 1].resolve({ ok: false, code: "permission-denied" }); });
    await screen.findByText(NOTICE);
    expect(screen.getByText("TST-9001")).toBeTruthy();           // after the re-read: raw partId (names denied)
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
  });
});
