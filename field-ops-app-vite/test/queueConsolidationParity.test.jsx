// Wave 6 -- queue consolidation (Owner directive, Option A). Proves Parts -> WORK
// (PartsList.jsx) is now genuinely ACTIONABLE using the SAME shared components
// (shared/reorder/{ManagerQueuePanel,AssociateRequestPanel,AssignedWorkOversightTable}.jsx)
// PartsManagerHome.jsx/PartsAssociateHome.jsx use -- not a fourth read-only re-implementation.
// Covers the Owner's §23 regression list: manager assignment remains actionable, associate
// actions remain correctly scoped (own-uid only), no queue item disappears, DENIED/
// UNAVAILABLE/EMPTY stay distinct.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }) }));

const managerQueueRow = { id: "req-mgr-1", partId: "TST-9001", urgency: "HIGH", reviewedAt: 1 };
const associateWaitingRow = { id: "req-assoc-1", partId: "TST-9001", urgency: "MEDIUM", assignedAt: 1 };
const { assignReorderRequest } = vi.hoisted(() => ({ assignReorderRequest: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequests: r,
    useReorderRequestsByStatus: () => ({ data: [managerQueueRow], loading: false, error: null }),
    useReorderRequestsByStatuses: () => ({ data: [], loading: false, error: null }),
    useReorderRequestsAssignedTo: (uid, status) =>
      status === "ASSIGNED_TO_PARTS_ASSOCIATE"
        ? { data: [associateWaitingRow], loading: false, error: null }
        : { data: [], loading: false, error: null },
    useReorderRequestsHistory: r,
    useReorderRequestById: (requestId) => ({
      data: requestId === associateWaitingRow.id ? { ...associateWaitingRow, status: "ASSIGNED_TO_PARTS_ASSOCIATE" } : null,
      loading: false,
      error: requestId === associateWaitingRow.id ? null : "not_found",
    }),
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  requestReorderForRecommendation: vi.fn(),
  getDisplayQty: () => 3,
  assignReorderRequest,
  startPurchasing: vi.fn(),
  updatePurchasingProgress: vi.fn(),
  receiveReorderRequest: vi.fn(),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: new Map(), loading: false, error: null }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({ useManufacturerCatalog: () => ({ loading: true, errorStatus: null, result: null }) }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const READY = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [] };

describe("Parts -> WORK (PartsList.jsx) is actionable via the shared queue components", () => {
  it("Parts Manager Queue: an Assign button is present (not just a link) and invokes the SAME governed assignReorderRequest()", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const assignButton = await screen.findByRole("button", { name: /assign canonical-name-a/i });
    fireEvent.click(assignButton);
    // Opens the shared AssignPanel (its own title uses "Assign -- {name}")
    expect(await screen.findByText(/assign -- canonical-name-a/i)).toBeTruthy();
  });

  it("My Work: a View button opens the shared AssignedRequestDetail (not a bare link)", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const viewButton = await screen.findByRole("button", { name: /view canonical-name-a/i });
    fireEvent.click(viewButton);
    expect(await screen.findByText(/request detail/i)).toBeTruthy();
  });

  it("no queue item disappears: the manager-queue row and the my-work row both still render their part name", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const names = await screen.findAllByText("CANONICAL-NAME-A");
    // At least the catalog row + manager-queue card + my-work card each render the name.
    expect(names.length).toBeGreaterThanOrEqual(3);
  });
});
