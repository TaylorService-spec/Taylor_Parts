// Issue #100 C1/C2 invalid-passthrough — RENDER gate for PartsList (C1). Runs via `npm run test:components`
// (vitest + jsdom). Proves PartsList passes fetchPartMasterList's `invalid` into the shared composer and,
// when the canonical read reports invalid documents, renders the BLOCKED catalog message — showing
// neither canonical nor static catalog rows and never raw invalid-document data. The shared composer +
// static catalog are REAL (so the block genuinely happens); only the Firebase-touching hooks, router, and
// heavy children are mocked.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const BLOCKED_INCOMPLETE = /could not be verified against the canonical source, so no parts are shown/i;
const canonicalMatching = [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }];

describe("PartsList (C1) — invalid-passthrough fail-closed render", () => {
  it("canonical read with invalid documents => BLOCKED catalog message; NO canonical rows, NO static rows, no raw invalid data", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalMatching, invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value", invalid: true }] });
    render(<PartsList />);
    await screen.findByText(BLOCKED_INCOMPLETE);
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
    expect(document.body.textContent.includes("secretField")).toBe(false);
  });

  it("malformed invalid metadata (non-array) also blocks the catalog", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalMatching, invalid: "not-an-array" });
    render(<PartsList />);
    await screen.findByText(BLOCKED_INCOMPLETE);
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });

  it("empty invalid renders the catalog READY (backward-compatible; canonical name shown, static name not)", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalMatching, invalid: [] });
    render(<PartsList />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });
});
