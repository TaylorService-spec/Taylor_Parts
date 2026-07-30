// OD-3 (Codex P1) -- RENDER gate proving accessVersion invalidation on the mounted
// production path for both role surfaces (vitest + jsdom). A same-UID access change must
// re-run the canonical name read, invalidate the prior name map immediately (before the
// replacement read settles), degrade a denied replacement to raw partIds + the bounded
// notice, and never let a stale completion from the OLD accessVersion overwrite the new
// state. Uses controllable deferred promises so read ordering is explicit. Shared composer
// + static catalog are REAL; only Firebase-touching hooks and heavy children are mocked.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [
    { sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 },
    { sku: "TST-9002", name: "STATIC-CATALOG-NAME-B", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 },
  ],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
// PartsManagerHome deps
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const row = [{ id: "r1", partId: "TST-9001", quantity: 3, urgency: "HIGH", reviewedAt: 1 }];
  return {
    // PartsManagerHome
    useReorderRequestsByStatus: () => ({ data: row, loading: false }),
    useReorderRequestsByStatuses: () => ({ data: [], loading: false, error: null }),
    useReviewedRequestsHistory: () => ({ data: [], loading: false, error: null }),
    // PartsAssociateHome
    useReorderRequestsAssignedTo: (uid, status) =>
      status === "ASSIGNED_TO_PARTS_ASSOCIATE" ? ({ data: row, loading: false }) : ({ data: [], loading: false }),
    useReorderRequestById: () => ({ data: null, loading: false }),
  };
});
vi.mock("../src/hooks/useAssignableEmployees", () => ({ useAssignableEmployees: () => ({ employees: [] }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  assignReorderRequest: vi.fn(), getDisplayQty: () => 3,
  startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn(),
}));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn() }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/modules/inventory/PartsList", () => ({ formatAssignmentAge: () => "1d", default: () => null }));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsManagerHome from "../src/modules/inventoryRole/PartsManagerHome.jsx";
import PartsAssociateHome from "../src/modules/inventoryRole/PartsAssociateHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOTICE = /Some part names are unavailable; Part IDs are shown/i;
const READY_A = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }, { partId: "TST-9002", name: "CANONICAL-NAME-B", category: "Valves", stockingUnit: "each" }], invalid: [] };

// A queue of deferred promises so we control resolution order across accessVersion changes.
function installDeferredFetch() {
  const deferreds = [];
  fetchPartMasterList.mockImplementation(() => {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    deferreds.push({ resolve });
    return p;
  });
  return deferreds;
}

describe.each([
  ["PartsManagerHome", PartsManagerHome],
  ["PartsAssociateHome", PartsAssociateHome],
])("%s (OD-3 Codex P1) -- accessVersion invalidation", (label, Surface) => {
  it("changed accessVersion triggers a new read, invalidates prior names immediately, and a denied replacement leaves raw partIds + notice", async () => {
    const deferreds = installDeferredFetch();
    const { rerender } = render(<Surface accessVersion={1} />);
    expect(deferreds.length).toBe(1); // read #1 for accessVersion 1
    await act(async () => { deferreds[0].resolve(READY_A); });
    await screen.findByText("CANONICAL-NAME-A");

    // Same UID, accessVersion changes 1 -> 2: must trigger a NEW read and clear prior names NOW.
    rerender(<Surface accessVersion={2} />);
    expect(deferreds.length).toBe(2); // read #2 triggered
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull(); // prior canonical name unrenderable immediately
    expect(screen.getByText("TST-9001")).toBeTruthy(); // operational table + raw partId preserved

    // Denied replacement read -> raw partIds + bounded notice.
    await act(async () => { deferreds[1].resolve({ ok: false, code: "permission-denied" }); });
    await screen.findByText(NOTICE);
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.getByText("TST-9001")).toBeTruthy();
  });

  it("a stale completion from the OLD accessVersion cannot overwrite the new state", async () => {
    const deferreds = installDeferredFetch();
    const { rerender } = render(<Surface accessVersion={1} />); // read #1 (pending)
    rerender(<Surface accessVersion={2} />); // read #2 (pending)
    expect(deferreds.length).toBe(2);

    // Resolve the OLD read #1 LATE with canonical names -- it must be dropped (stale token).
    await act(async () => { deferreds[0].resolve(READY_A); });
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();

    // Resolve the CURRENT read #2 -> its result applies.
    await act(async () => { deferreds[1].resolve(READY_A); });
    await screen.findByText("CANONICAL-NAME-A");
  });
});
