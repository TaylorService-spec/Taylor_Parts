// PartDetail must CONSUME useInventoryLedger's `error`, the way PartsList already does.
//
// A failed ledger read is not an empty ledger. Before this, PartDetail destructured only
// { transactions, healthEntries, loading }, so a read that FAILED rendered "No ledger movements have been
// recorded for this part" and "No movements have been recorded against this part" -- a false statement
// about the part. Once useInventoryLedger fails closed on a single unreadable ledger row (lane L3), that
// false statement would be made about EVERY part. Compatible with the current hook: it already returns
// `error`, so this is harmless before and correct after.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => { const searchParts = vi.fn(); return { searchParts, readPartsForView: (partIds) => searchParts({ partIds }), isCatalogReadRefused: (code) => code === "FORBIDDEN" || code === "NOT_SIGNED_IN" }; });
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
const ledgerState = vi.hoisted(() => ({ current: null }));
vi.mock("../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ledgerState.current,
}));

// B3-x: the governed balance read. OFF unless a test states otherwise (the environment has not switched it on).
const balanceState = vi.hoisted(() => ({ current: { status: "OFF", balance: null } }));
vi.mock("../src/hooks/usePartBalance.js", () => ({
  BALANCE_STATUS: { OFF: "OFF", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", FAILED: "FAILED" },
  usePartBalance: () => balanceState.current,
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
// The Work Order demand band is its own read (the EOS Work Order route since the Work Order cutover) with its own suite
// (partWorkOrderDemandSection.test.jsx). Isolated here like every other neighbouring hook, so this suite's "unavailable"
// assertions are about the LEDGER band only -- and do not depend on whether an EOS API is configured.
vi.mock("../src/hooks/usePartWorkOrderDemand", async () => {
  const actual = await vi.importActual("../src/hooks/usePartWorkOrderDemand");
  return { ...actual, usePartWorkOrderDemand: () => ({ status: actual.PART_WORK_ORDER_DEMAND_STATE.READY, rows: [], scannedCount: 0, totalOpenWorkOrders: 0 }) };
});

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

import { searchParts } from "../src/services/partMasterQueries";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

const CANONICAL_OK = {
  ok: true,
  parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }],
  invalid: [],
};


afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  balanceState.current = { status: "OFF", balance: null };
});

const renderWithLedger = async (ledger) => {
  ledgerState.current = ledger;
  searchParts.mockResolvedValue(CANONICAL_OK);
  render(<PartDetail />);
  await screen.findByText("CANONICAL-NAME-A");
};

describe("PartDetail -- a failed ledger read is UNAVAILABLE, never an empty history", () => {
  it("a ledger read error renders the unavailable state in BOTH ledger bands and never the empty-history sentences", async () => {
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: new Error("unreadable ledger row") });
    expect(screen.getByText(/this part's stock forecast is unavailable/)).toBeTruthy();
    expect(screen.getByText(/this part's movements are unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No ledger movements have been recorded/)).toBeNull();
    expect(screen.queryByText(/No movements have been recorded against this part/)).toBeNull();
    // A failure, announced as one.
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    // Nothing derived from a ledger that was not read is offered.
    expect(screen.queryByRole("button", { name: "Request Reorder" })).toBeNull();
  });

  it("a successful read with no movements still says so honestly (the empty state is for real emptiness only)", async () => {
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: null });
    expect(screen.getByText(/No ledger movements have been recorded for this part/)).toBeTruthy();
    expect(screen.getByText(/No movements have been recorded against this part/)).toBeTruthy();
    // (B3-x: the empty state now also offers the manual-quantity Request Reorder, whose warehouse picker may state its own
    // availability; what must stay absent is the LEDGER bands' unavailable sentences.)
    expect(screen.queryByText(/stock forecast is unavailable/)).toBeNull();
    expect(screen.queryByText(/movements are unavailable/)).toBeNull();
  });

  it("B3-x: a Part the ledger has NOTHING on can still be requested for -- the entry that needs no forecast", async () => {
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: null });
    expect(screen.getByRole("button", { name: "Request Reorder" })).toBeTruthy();
    expect(screen.getByLabelText("Manual reorder quantity")).toBeTruthy();
  });

  it("while the ledger is loading neither band claims emptiness", async () => {
    await renderWithLedger({ transactions: [], healthEntries: [], loading: true, error: null });
    expect(screen.queryByText(/No ledger movements have been recorded/)).toBeNull();
    expect(screen.queryByText(/No movements have been recorded against this part/)).toBeNull();
  });

  it("B3-x: where the governed balance answers, Part Detail shows it -- UNKNOWN as Unknown, On Order as its figure, locations by warehouse", async () => {
    const K = (value) => ({ state: "KNOWN", value });
    balanceState.current = { status: "READY", balance: {
      onHand: K(13), reserved: K(3), available: K(10), onOrder: K(7), byLocation: [{ warehouseId: "wh-1", quantity: 13 }],
    } };
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: null });
    const stock = screen.getByLabelText("Governed stock position");
    expect(stock.textContent).toMatch(/On Hand.*13/);
    expect(stock.textContent).toMatch(/Reserved.*3/);
    expect(stock.textContent).toMatch(/Available.*10/);
    expect(screen.getByLabelText("On hand by warehouse").textContent).toMatch(/wh-1.*13/);
    expect(screen.getByText("7")).toBeTruthy(); // On Order
    expect(screen.queryByText(/Locations can.t be listed yet/)).toBeNull();
  });

  it("B3-x: a refused or failed balance read says so -- it is neither the switched-off sentence nor a zero", async () => {
    balanceState.current = { status: "DENIED", balance: null };
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: null });
    expect(screen.getByText(/not available to your role/)).toBeTruthy();
    cleanup();
    balanceState.current = { status: "FAILED", balance: null };
    await renderWithLedger({ transactions: [], healthEntries: [], loading: false, error: null });
    expect(screen.getByText(/could not be read\. This is not a statement about how much there is/)).toBeTruthy();
  });

  it("a successful read with movements is unaffected", async () => {
    await renderWithLedger({ transactions: [], healthEntries: [HEALTH_ENTRY], loading: false, error: null });
    expect(screen.queryByText(/stock forecast is unavailable/)).toBeNull();
    expect(screen.getByRole("button", { name: "Request Reorder" })).toBeTruthy();
  });
});
