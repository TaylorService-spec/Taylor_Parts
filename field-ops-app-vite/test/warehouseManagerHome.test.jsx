// Issue #100 — RENDER / lifecycle gate for WarehouseManagerHome's canonical Parts Catalog cutover.
// Runs in CI via `npm run test:components` (vitest + jsdom). Proves the surface reads canonical `parts`
// as PRIMARY (canonical names render, not static), fails closed on a denied/unavailable canonical read
// (blocked banner, NEVER the static catalog), and shows a loading state — through the real component +
// real composition, with only the Firebase-touching seams (fetch + ledger/actions hooks) and the heavy
// InventoryHealthPanel mocked, plus a tiny 2-row static catalog fixture so the composition reaches READY.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// --- mock the Firebase-touching seams + heavy child + shrink the static catalog to a matchable fixture ---
vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn() }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [
    { sku: "TST-9001", name: "Static Name A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 42 },
    { sku: "TST-9002", name: "Static Name B", category: "Fittings", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 7 },
  ],
  getCatalogItem: (id) => ({ "TST-9001": { name: "Static Name A" }, "TST-9002": { name: "Static Name B" } }[id]),
}));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import WarehouseManagerHome from "../src/modules/inventoryRole/WarehouseManagerHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const canonicalMatching = [
  { partId: "TST-9001", name: "Canonical Name A", category: "Valves", stockingUnit: "each" },
  { partId: "TST-9002", name: "Canonical Name B", category: "Fittings", stockingUnit: "each" },
];

describe("WarehouseManagerHome — canonical Parts Catalog cutover", () => {
  it("renders canonical names as PRIMARY (not the static names) when the canonical read succeeds", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalMatching });
    render(<WarehouseManagerHome />);
    await screen.findByText("Canonical Name A");
    expect(screen.getByText("Canonical Name B")).toBeTruthy();
    // static names must NOT be the rendered identity
    expect(screen.queryByText("Static Name A")).toBeNull();
    expect(screen.getByText(/2 parts in catalog/)).toBeTruthy();
    expect(fetchPartMasterList).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED on a permission-denied canonical read: blocked banner, never the static catalog", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "permission-denied" });
    render(<WarehouseManagerHome />);
    await screen.findByText(/catalog is unavailable right now/i);
    expect(screen.queryByText("Static Name A")).toBeNull();
    expect(screen.queryByText("Canonical Name A")).toBeNull();
    expect(screen.queryByText(/parts in catalog/)).toBeNull();
  });

  it("FAILS CLOSED on an unavailable canonical read: blocked banner, no static fallback", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "unavailable" });
    render(<WarehouseManagerHome />);
    await screen.findByText(/catalog is unavailable right now/i);
    expect(screen.queryByText("Static Name A")).toBeNull();
  });

  it("shows a loading state while the canonical read is in flight (no static shown)", async () => {
    let resolve;
    fetchPartMasterList.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<WarehouseManagerHome />);
    expect(screen.getAllByText(/Loading canonical parts/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Static Name A")).toBeNull();
    await act(async () => { resolve({ ok: true, parts: canonicalMatching }); });
    await screen.findByText("Canonical Name A");
  });
});
