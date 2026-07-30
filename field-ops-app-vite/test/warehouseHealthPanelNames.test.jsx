// OD-3 -- WarehouseManagerHome integration with the REAL InventoryHealthPanel (vitest + jsdom).
// Proves WMH feeds the shared panel a governed canonical resolver: canonical names render in
// the health panel; a denied canonical read degrades panel names to the raw partId (never a
// static name); and a same-UID accessVersion change invalidates the prior name synchronously
// with stale-completion suppression. Only Firebase-touching seams + heavy chrome are mocked;
// InventoryHealthPanel + the composition are REAL.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn() }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ URGENCY_ORDER: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }, hasUsageHistory: () => true }));
// One health entry (with usage history so it's NOT "needs planning") -> renders in the
// read-only Inventory Health mount, its Part cell resolved via WMH's resolveName.
vi.mock("../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ({
    healthEntries: [{ partId: "TST-9001", stock: { availableStock: 5 }, usage: { avgDailyUsage: 1.5 }, recommendation: { urgency: "HIGH", daysRemaining: 3, recommendedOrderQty: 10 } }],
    loading: false, error: null,
  }),
}));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "Static Name A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 42 }],
  getCatalogItem: (id) => ({ "TST-9001": { name: "Static Name A" } }[id]),
}));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import WarehouseManagerHome from "../src/modules/inventoryRole/WarehouseManagerHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const READY = { ok: true, parts: [{ partId: "TST-9001", name: "Canonical Name A", category: "Valves", stockingUnit: "each" }], invalid: [] };

describe("WarehouseManagerHome + InventoryHealthPanel (OD-3)", () => {
  it("READY: the health panel shows the CANONICAL name, never the static name", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<WarehouseManagerHome accessVersion={1} />);
    // canonical name appears in the health panel (and WMH's canonical catalog table) -- both canonical.
    expect((await screen.findAllByText("Canonical Name A")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Static Name A")).toBeNull();
  });

  it("permission-denied: the health panel degrades to the raw partId, never the static name", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "permission-denied" });
    render(<WarehouseManagerHome accessVersion={1} />);
    await screen.findByText("TST-9001");
    expect(screen.queryByText("Canonical Name A")).toBeNull();
    expect(screen.queryByText("Static Name A")).toBeNull();
  });

  it("accessVersion change invalidates the prior canonical name immediately (synchronous render-time guard)", async () => {
    const deferreds = [];
    fetchPartMasterList.mockImplementation(() => { let r; const p = new Promise((res) => { r = res; }); deferreds.push({ resolve: r }); return p; });
    const { rerender } = render(<WarehouseManagerHome accessVersion={1} />);
    await act(async () => { deferreds[0].resolve(READY); });
    expect((await screen.findAllByText("Canonical Name A")).length).toBeGreaterThan(0);

    rerender(<WarehouseManagerHome accessVersion={2} />);
    expect(screen.queryAllByText("Canonical Name A")).toHaveLength(0); // prior name unrenderable immediately
    expect(screen.getAllByText("TST-9001").length).toBeGreaterThan(0); // health row preserved, raw partId

    await act(async () => { deferreds[1].resolve(READY); });            // the CURRENT (av 2) read applies
    expect((await screen.findAllByText("Canonical Name A")).length).toBeGreaterThan(0);
  });

  it("stale completion: an OLD-boundary read LEFT PENDING across the access change cannot alter the new boundary", async () => {
    const deferreds = [];
    fetchPartMasterList.mockImplementation(() => { let r; const p = new Promise((res) => { r = res; }); deferreds.push({ resolve: r }); return p; });
    const { rerender } = render(<WarehouseManagerHome accessVersion={1} />);
    expect(deferreds).toHaveLength(1);                                  // read #1 issued, LEFT PENDING (not resolved)
    rerender(<WarehouseManagerHome accessVersion={2} />);
    expect(deferreds).toHaveLength(2);                                  // read #2 issued for the new boundary

    // Resolve the OLD read #1 NOW, AFTER the boundary changed -> its result must be dropped
    // (stale request token + render-time key mismatch), never presented.
    await act(async () => { deferreds[0].resolve({ ok: true, parts: [{ partId: "TST-9001", name: "STALE-OLD-NAME", category: "Valves", stockingUnit: "each" }], invalid: [] }); });
    expect(screen.queryAllByText("STALE-OLD-NAME")).toHaveLength(0);
    expect(screen.getAllByText("TST-9001").length).toBeGreaterThan(0); // still raw partId under the new boundary

    // The CURRENT read #2 applies normally.
    await act(async () => { deferreds[1].resolve(READY); });
    expect((await screen.findAllByText("Canonical Name A")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("STALE-OLD-NAME")).toHaveLength(0);
  });
});
