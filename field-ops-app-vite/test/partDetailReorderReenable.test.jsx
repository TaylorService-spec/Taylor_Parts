// Site-work round-4, Item C -- RENDER tests (vitest + jsdom), following
// test/partDetailInvalid.test.jsx's / test/appHeaderReorderRequestsErrorState.test.jsx's
// convention (mock the Firebase-touching hooks + router + heavy children, render the
// real component).
//
// Pins three fixes to PartDetail.jsx / hooks/useReorderRequests.js:
//
// Fix 1 (P1 dead-end): PartDetail used to gate "Request Reorder" on plain
// !reorderRequest, and useReorderRequestForPart() returns the most-recent request for
// the part REGARDLESS of status -- once that request reached a terminal status
// (RECEIVED/CANCELLED/REJECTED/VOIDED), the control never came back. Mirrors
// PartsList.jsx's pendingRequests-style scoping: a part whose only request is terminal
// is requestable again; a part with an ACTIVE (non-terminal) request is not.
//
// Fix 2 (P1 reliability): useReorderRequestForPart()'s onSnapshot error callbacks used
// to discard the real Firestore SDK error code (into "not_found" on the requestId
// path, into `null` on the no-requestId path) -- indistinguishable from "genuinely
// empty"/"genuinely missing". Both paths now preserve the real code, and PartDetail
// renders a distinct "access denied or a read error" message for it, separate from the
// genuine not-found/mismatch copy.
//
// Fix 3 (P2 ux): action-handler catches now route through workflowActionErrorMessage(),
// same as this file's pre-existing Approve/Reject handlers, instead of a raw err.message.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [
    { sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 },
  ],
  getCatalogItem: () => undefined,
}));

const HEALTH_ENTRY = {
  partId: "TST-9001",
  stock: { availableStock: 5 },
  usage: {},
  recommendation: { recommendationStatus: "READY", urgency: "LOW", reorderPoint: 2, recommendedOrderQty: 10, daysRemaining: 5 },
};
vi.mock("../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ({ transactions: [], healthEntries: [HEALTH_ENTRY], loading: false, error: null }),
}));

const reorderRequestState = vi.hoisted(() => ({ current: { data: null, loading: false, error: null, refresh: () => {} } }));
vi.mock("../src/hooks/useReorderRequests", () => ({
  useReorderRequestForPart: () => reorderRequestState.current,
}));

vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: {}, loading: false }),
  resolveActorDisplayName: (id) => id,
}));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));

const assignReorderRequest = vi.fn();
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  requestReorderForRecommendation: vi.fn(),
  getDisplayQty: () => 0,
  reviewReorderRequest: vi.fn(),
  assignReorderRequest: (...args) => assignReorderRequest(...args),
  startPurchasing: vi.fn(),
  updatePurchasingProgress: vi.fn(),
  receiveReorderRequest: vi.fn(),
  cancelReorderRequest: vi.fn(),
}));
vi.mock("../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1" }, role: "admin", operationalRoles: [] }),
}));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/ui/form", () => ({ FormError: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ employeeId: "e1", userId: "u2" })}>
      Select Employee (test stub)
    </button>
  ),
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useParams: () => ({ partId: "TST-9001" }),
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children }) => children,
  };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

const CANONICAL_OK = {
  ok: true,
  parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }],
  invalid: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  reorderRequestState.current = { data: null, loading: false, error: null, refresh: () => {} };
});

describe("PartDetail -- Fix 1: requestable again once the only request is terminal", () => {
  it("a part whose most-recent request is RECEIVED (terminal) shows Request Reorder again", async () => {
    reorderRequestState.current = {
      data: { id: "r1", partId: "TST-9001", status: "RECEIVED", receivedBy: "u9", receivedAt: 1000 },
      loading: false,
      error: null,
      refresh: () => {},
    };
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");
    // Terminal-status history card still shows (this fix must not hide history)...
    expect(screen.getByText("Reorder Request -- Received")).toBeTruthy();
    // ...AND the part is requestable again -- this is the dead-end fix.
    expect(screen.getByRole("button", { name: "Request Reorder" })).toBeTruthy();
  });

  it("a part with an ACTIVE (PENDING_REVIEW) request does NOT show Request Reorder", async () => {
    reorderRequestState.current = {
      data: { id: "r2", partId: "TST-9001", status: "PENDING_REVIEW", createdAt: 1000 },
      loading: false,
      error: null,
      refresh: () => {},
    };
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.getByText("Reorder Request -- Pending Review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request Reorder" })).toBeNull();
  });

  it("a part with no request at all shows Request Reorder (pre-existing behavior preserved)", async () => {
    reorderRequestState.current = { data: null, loading: false, error: null, refresh: () => {} };
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.getByRole("button", { name: "Request Reorder" })).toBeTruthy();
  });
});

describe("PartDetail -- Fix 2: an access/read error is not reported as 'not found'", () => {
  it("a denied read (permission-denied) surfaces a distinct access-error message, not the not-found copy, and withholds Request Reorder", async () => {
    reorderRequestState.current = { data: null, loading: false, error: "permission-denied", refresh: () => {} };
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.getByText(/access denied or a read error/i)).toBeTruthy();
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    // Fail-closed: an unresolved read error must not offer a re-request action either.
    expect(screen.queryByRole("button", { name: "Request Reorder" })).toBeNull();
  });

  it("a genuinely missing document (not_found) still shows the not-found copy (regression pin)", async () => {
    reorderRequestState.current = { data: null, loading: false, error: "not_found", refresh: () => {} };
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.getByText(/this reorder request could not be found/i)).toBeTruthy();
  });
});

describe("PartDetail -- Fix 3: workflow action failures show safe categorized copy, never a raw error", () => {
  it("a failed Assign shows workflowActionErrorMessage's safe copy, not the raw error", async () => {
    reorderRequestState.current = {
      data: { id: "r3", partId: "TST-9001", status: "READY_FOR_PARTS_MANAGER", reviewedAt: 1000 },
      loading: false,
      error: null,
      refresh: () => {},
    };
    const rawError = new Error("RAW-INTERNAL-DETAIL-should-never-render");
    rawError.code = "permission-denied";
    assignReorderRequest.mockRejectedValue(rawError);
    fetchPartMasterList.mockResolvedValue(CANONICAL_OK);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-NAME-A");

    fireEvent.click(screen.getByRole("button", { name: "Select Employee (test stub)" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(assignReorderRequest).toHaveBeenCalled());
    await screen.findByText("You're not allowed to perform this action. Nothing was changed.");
    expect(screen.queryByText(/RAW-INTERNAL-DETAIL/)).toBeNull();
  });
});
