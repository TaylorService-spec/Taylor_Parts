// OD-3 -- RENDER gate for PartsAssociateHome canonical part-name resolution (vitest + jsdom,
// via `npm run test:components`). Proves the "My Purchasing" surface resolves its assigned
// reorder-request part names through the shared fail-closed governed path and, when the
// canonical read is invalid/denied/unavailable, degrades names to the raw partId (never the
// static-catalog name), shows a bounded inline notice, keeps the Waiting/In-Progress tables
// rendering, and never leaks raw invalid-document contents. Shared composer + static catalog
// are REAL; only the Firebase-touching hooks and heavy children are mocked.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const waitingRow = [{ id: "r1", partId: "TST-9001", quantity: 3, urgency: "HIGH" }];
  return {
    useReorderRequestsAssignedTo: (uid, status) =>
      status === "ASSIGNED_TO_PARTS_ASSOCIATE" ? ({ data: waitingRow, loading: false }) : ({ data: [], loading: false }),
    useReorderRequestById: () => ({ data: null, loading: false }),
  };
});
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn(), getDisplayQty: () => 3,
}));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn() }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsAssociateHome from "../src/modules/inventoryRole/PartsAssociateHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOTICE = /Some part names are unavailable; Part IDs are shown/i;
const canonicalOK = [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }];

describe("PartsAssociateHome (OD-3) -- canonical name resolution, fail-closed", () => {
  it("READY: canonical name shown; static name NOT shown; no unavailable notice", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalOK, invalid: [] });
    render(<PartsAssociateHome />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("invalid canonical documents: names degrade to raw partId, Waiting table still renders, notice shown, no raw invalid leak, no static name", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalOK, invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value" }] });
    render(<PartsAssociateHome />);
    await screen.findByText(NOTICE);
    // operational table preserved: the waiting row + its View action still render
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.getByRole("button", { name: /View TST-9001/i })).toBeTruthy();
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
    expect(document.body.textContent.includes("secretField")).toBe(false);
  });

  it("unavailable canonical read: names degrade to raw partId, table renders, notice shown", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "unavailable" });
    render(<PartsAssociateHome />);
    await screen.findByText(NOTICE);
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });
});
