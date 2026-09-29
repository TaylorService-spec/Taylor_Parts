// Wave 6 -- master-data-in-Parts. Proves the new entry points actually mount the
// shared PartWriteModal from within the Parts experience (PartsList "New Part",
// PartDetail "Edit part"/"Change status") -- an authorized user never has
// to navigate to the separate Part Master screen to do normal Part master-data
// work. Mocks PartWriteModal itself (its own governed-flow behavior is covered by
// test/partWriteModal.test.jsx) so these stay focused on WIRING: the right button
// opens the right mode with the right part.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => { const searchParts = vi.fn(); return { searchParts, readPartsForView: (partIds) => searchParts({ partIds }), isCatalogReadRefused: (code) => code === "FORBIDDEN" || code === "NOT_SIGNED_IN" }; });
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsByStatuses: r,
    useMyAssignedReorderRequests: r, useReorderRequestsHistory: r, useReorderRequestById: r,
    useReorderRequestForPart: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn() }));
vi.mock("../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/domain/workflowActionError", () => ({ workflowActionErrorMessage: () => "" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({
    loading: false,
    errorStatus: null,
    result: { status: "ready", manufacturers: [{ manufacturerId: "MFG-1", name: "Acme Valve Co", status: "ACTIVE" }], excludedCount: 0 },
  }),
}));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/ui/form", async (orig) => ({ ...(await orig()), FormError: () => null }));
vi.mock("../src/shared/inventory/RequestReorderControl", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ partId: "TST-9001" }), useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

// DQ-034: the Catalog mutation hold is a CODE constant and is ON in every build. These flows exercise the UNHELD
// governed path, so the hold module is mocked with a mutable `held` (default false here); the held state has its own
// block below, and the committed constant itself is pinned by test/catalogMutationHold.test.jsx.
const hold = vi.hoisted(() => ({ held: false }));
vi.mock("../src/config/catalogMutationHold.js", async (orig) => ({ ...(await orig()), CATALOG_MUTATION_HOLD: hold }));

const captured = [];
vi.mock("../src/shared/partMaster/PartWriteModal.jsx", () => ({
  default: (props) => { captured.push(props); return <div data-testid="part-write-modal">{props.mode}</div>; },
}));

import { searchParts } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); captured.length = 0; hold.held = false; });

const READY = { ok: true, parts: [{ partId: "TST-9001", internalPartNumber: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each", controlType: "STANDARD", stockingClass: "STOCKED", status: "ACTIVE", version: 2, manufacturerId: "MFG-1" }], invalid: [] };

describe("PartsList -- New Part entry point", () => {
  it("no modal mounted until 'New Part' is clicked; clicking opens mode='create'", async () => {
    searchParts.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    expect(screen.queryByTestId("part-write-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /new part/i }));
    expect(screen.getByTestId("part-write-modal").textContent).toBe("create");
    expect(captured[0].mode).toBe("create");
  });
});

describe("PartDetail -- Edit/Status entry points", () => {
  // RENAMED, not rewired. The Parts North Star P1 composition takes the design's shorter labels
  // ("Edit part" / "Change status"); the commands, the modal modes and the part they act on are
  // unchanged, which is what this test is actually for.
  it("Edit part and Change status buttons open the modal in the matching mode, for THIS part", async () => {
    searchParts.mockResolvedValue(READY);
    render(<PartDetail />);
    await screen.findByRole("button", { name: /^edit part$/i });

    fireEvent.click(screen.getByRole("button", { name: /^edit part$/i }));
    expect(screen.getByTestId("part-write-modal").textContent).toBe("edit");
    expect(captured[captured.length - 1].mode).toBe("edit");
    expect(captured[captured.length - 1].part.partId).toBe("TST-9001");
    expect(captured[captured.length - 1].part.version).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /change status/i }));
    expect(screen.getByTestId("part-write-modal").textContent).toBe("status");
    expect(captured[captured.length - 1].mode).toBe("status");
  });

  it("shows the resolved Manufacturer NAME (via the trusted catalog read), not the opaque manufacturerId", async () => {
    searchParts.mockResolvedValue(READY);
    render(<PartDetail />);
    // findAllByText, not findByText: P1v2 states the manufacturer TWICE by design (Owner ruling,
    // 2026-08-31) — once in the identity line for recognition, once in the Part information band's
    // master-data summary. What this test is about is unchanged and is asserted on the line below:
    // the NAME reaches the reader and the opaque id never does, wherever it appears.
    const shown = await screen.findAllByText("Acme Valve Co");
    expect(shown.length).toBeGreaterThan(0);
    expect(screen.queryByText("MFG-1")).toBeNull();
  });

  it("no Edit/Status buttons when the canonical read cannot resolve this part (BLOCKED)", async () => {
    searchParts.mockResolvedValue({ ok: true, parts: READY.parts, invalid: [{ partId: "TST-9001", secretField: "x", invalid: true }] });
    render(<PartDetail />);
    await screen.findByText(/could not be verified against the canonical source/i);
    expect(screen.queryByRole("button", { name: /edit part details/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
  });
});

describe("DQ-034 hold -- no Part change is OFFERED while Catalog changes are paused", () => {
  it("PartsList: New Part is locked with the reason and opens nothing", async () => {
    hold.held = true;
    searchParts.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const newPart = screen.getByRole("button", { name: /new part/i });
    expect(newPart.disabled).toBe(true);
    expect(screen.getByText(/catalog changes are paused during the migration/i)).toBeTruthy();
    fireEvent.click(newPart);
    expect(screen.queryByTestId("part-write-modal")).toBeNull();
  });

  it("PartDetail: Edit part / Change status are disabled, the pause is stated, and the Part still reads", async () => {
    hold.held = true;
    searchParts.mockResolvedValue(READY);
    render(<PartDetail />);
    const edit = await screen.findByRole("button", { name: /^edit part$/i });
    const status = screen.getByRole("button", { name: /change status/i });
    expect(edit.disabled).toBe(true);
    expect(status.disabled).toBe(true);
    expect(screen.getByText(/catalog changes are paused during the migration/i)).toBeTruthy();
    fireEvent.click(edit);
    fireEvent.click(status);
    expect(screen.queryByTestId("part-write-modal")).toBeNull();
    // Reads continue from PostgreSQL: the canonical read ran and the record rendered.
    expect(searchParts).toHaveBeenCalled();
  });
});
