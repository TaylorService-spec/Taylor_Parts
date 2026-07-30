// OD-3 -- PartsList feeds the shared InventoryHealthPanel (its 5th mount) a governed canonical
// resolver, derived from its EXISTING canonical read (no second read), access-version
// boundary-guarded. We spy on InventoryHealthPanel to capture the `resolveName` PartsList
// passes it (mount-agnostic, robust) and also assert PartsList's own canonical catalog table.
// Proves: READY -> canonical names; invalid/denied -> raw partId (never static); accessVersion
// change invalidates the resolver synchronously.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsByStatuses: r,
    useReorderRequestsAssignedTo: r, useReorderRequestsHistory: r, useReorderRequestById: r,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0 }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/shared/ui/FilterBar", () => ({ default: () => null }));
// Spy: capture the resolveName PartsList passes into its Inventory Health panel (5th mount).
const captured = [];
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({
  default: ({ resolveName }) => { captured.push(resolveName); return null; },
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); captured.length = 0; });

const latestResolve = (id) => captured[captured.length - 1](id);
const READY = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [] };

describe("PartsList + InventoryHealthPanel (OD-3)", () => {
  it("READY: catalog shows canonical name; the resolveName passed to the health panel resolves canonically; no static name", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    await screen.findByText("CANONICAL-NAME-A");            // PartsList's own canonical catalog table
    expect(latestResolve("TST-9001")).toBe("CANONICAL-NAME-A"); // 5th mount's resolver is canonical
    expect(latestResolve("TST-0000-ABSENT")).toBe("TST-0000-ABSENT"); // absent -> raw partId
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });

  it("invalid canonical documents: the health-panel resolver fails closed to the raw partId (never static)", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: READY.parts, invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value" }] });
    render(<PartsList accessVersion={1} />);
    await screen.findByText(/could not be verified against the canonical source/i);
    expect(latestResolve("TST-9001")).toBe("TST-9001");
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
  });

  it("accessVersion change invalidates the health-panel resolver synchronously", async () => {
    const deferreds = [];
    fetchPartMasterList.mockImplementation(() => { let r; const p = new Promise((res) => { r = res; }); deferreds.push({ resolve: r }); return p; });
    const { rerender } = render(<PartsList accessVersion={1} />);
    await act(async () => { deferreds[0].resolve(READY); });
    await screen.findByText("CANONICAL-NAME-A");
    expect(latestResolve("TST-9001")).toBe("CANONICAL-NAME-A");

    rerender(<PartsList accessVersion={2} />);              // same UID, access changes
    expect(latestResolve("TST-9001")).toBe("TST-9001");    // resolver invalidated immediately -> raw partId
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
  });
});
