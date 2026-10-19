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

// ────────────────────────────────────────────── B3-x: the Part balance, client side
// (Kept in this file because it is named by the Parts North Star workflow; the hook is the REAL one, the mock above is for PartDetail.)
import { balanceProjection, fetchBalanceForScan, fetchPartBalance } from "../src/services/partsOperationsReads.js";
import { partBalanceView, partPurchasingSection, partNoHistoryRecommendation } from "../src/domain/partsNorthStar.js";
const actualBalance = await vi.importActual("../src/hooks/usePartBalance.js");

const BK = (value) => ({ state: "KNOWN", value });
const UNKNOWN = { state: "UNKNOWN", value: null };
const SERVER = {
  partId: "P1", trackingMode: "NONE", scopedWarehouseIds: ["wh-1"],
  onHand: BK(13), reserved: BK(3), available: BK(10), onOrder: BK(7),
  byLocation: [{ warehouseId: "wh-1", quantity: 13 }],
};
const answering = (result) => ({ call: vi.fn().mockResolvedValue({ ok: true, result }) });
const refusing = (code, message = "refused") => ({ call: vi.fn().mockResolvedValue({ ok: false, code, message }) });

describe("the transport", () => {
  it("asks readPartBalance for ONE part and nothing else", async () => {
    const o = answering(SERVER);
    expect(await fetchPartBalance("P1", o)).toEqual(SERVER);
    expect(o.call.mock.calls[0].slice(0, 2)).toEqual(["readPartBalance", { partId: "P1" }]);
  });

  it("the scan lookup receives the projection with the warehouse key renamed -- and every figure untouched", async () => {
    const out = await fetchBalanceForScan({ partId: "P1" }, answering({ ...SERVER, onHand: UNKNOWN, available: UNKNOWN }));
    expect(out.errorStatus).toBeUndefined();
    expect(out.result.onHand).toEqual(UNKNOWN);
    expect(out.result.reserved).toEqual(BK(3));
    expect(out.result.byLocation).toEqual([{ locationId: "wh-1", quantity: 13 }]);
    expect(balanceProjection(null).byLocation).toEqual([]);
  });

  it("a refusal is permission-denied; anything else is internal -- never an empty balance", async () => {
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("FORBIDDEN"))).errorStatus).toBe("permission-denied");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("INTERNAL"))).errorStatus).toBe("internal");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("NOT_FOUND"))).errorStatus).toBe("internal");
    expect((await fetchBalanceForScan({ partId: "P1" }, refusing("FORBIDDEN"))).result).toBeUndefined();
  });
});

function Probe({ partId, ready, fetchBalance }) {
  const s = actualBalance.usePartBalance(partId, { ready, fetchBalance });
  return <p data-testid="s">{s.status}{s.balance ? `:${s.balance.onHand.value}` : ""}</p>;
}
const stable = (fn) => fn; // a stable reference per test, so the effect does not re-run

describe("usePartBalance", () => {
  it("asks NOTHING where the environment has not switched the read on (OFF)", async () => {
    const fetchBalance = vi.fn();
    render(<Probe partId="P1" ready={false} fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(actualBalance.BALANCE_STATUS.OFF);
    expect(fetchBalance).not.toHaveBeenCalled();
  });

  it("OFF without a Part, even when the read is on", () => {
    const fetchBalance = vi.fn();
    render(<Probe partId={null} ready fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(actualBalance.BALANCE_STATUS.OFF);
    expect(fetchBalance).not.toHaveBeenCalled();
  });

  it("LOADING, then READY with the figures", async () => {
    const fetchBalance = stable(vi.fn().mockResolvedValue(SERVER));
    render(<Probe partId="P1" ready fetchBalance={fetchBalance} />);
    expect(screen.getByTestId("s").textContent).toBe(actualBalance.BALANCE_STATUS.LOADING);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("READY:13"));
    expect(fetchBalance).toHaveBeenCalledWith("P1");
  });

  it("a server refusal is DENIED; any other failure is FAILED -- three different claims", async () => {
    const denied = stable(vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "FORBIDDEN" })));
    render(<Probe partId="P1" ready fetchBalance={denied} />);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe(actualBalance.BALANCE_STATUS.DENIED));
    cleanup();
    const failed = stable(vi.fn().mockRejectedValue(new Error("down")));
    render(<Probe partId="P1" ready fetchBalance={failed} />);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe(actualBalance.BALANCE_STATUS.FAILED));
  });
});

describe("the view", () => {
  it("UNKNOWN reads Unknown -- never 0 -- and a serial Part's quantities are counted by unit", () => {
    const v = partBalanceView({ onHand: UNKNOWN, reserved: BK(0), available: UNKNOWN, byLocation: [] });
    expect(v.rows.map((r) => [r.label, r.value])).toEqual([["On Hand", "Unknown"], ["Reserved", "0"], ["Available", "Unknown"]]);
    const s = partBalanceView({ onHand: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, reserved: { state: "NOT_COUNTED_BY_QUANTITY", value: null },
      available: { state: "NOT_COUNTED_BY_QUANTITY", value: null }, byLocation: [] });
    expect(s.rows.every((r) => r.value === "Counted by unit")).toBe(true);
  });

  it("locations are labelled through the resolver and keep the id when it will not resolve", () => {
    const v = partBalanceView(SERVER, (id) => (id === "wh-1" ? "Main warehouse" : id));
    expect(v.locations).toEqual([{ key: "wh-1", label: "Main warehouse", quantity: 13 }]);
    expect(partBalanceView({ ...SERVER, byLocation: [{ warehouseId: "wh-9", quantity: 2 }] }, (id) => id).locations[0].label).toBe("wh-9");
  });

  it("On Order: a known figure, a stated UNKNOWN, and the old absence where the read is off", () => {
    expect(partPurchasingSection(SERVER).rows[0]).toMatchObject({ key: "onOrder", value: "7", absence: null });
    expect(partPurchasingSection({ onOrder: BK(0) }).rows[0].value).toBe("0");
    expect(partPurchasingSection({ onOrder: UNKNOWN }).rows[0]).toMatchObject({ value: null });
    expect(partPurchasingSection({ onOrder: UNKNOWN }).rows[0].absence).toMatch(/Unknown/);
    expect(partPurchasingSection().rows[0]).toMatchObject({ value: null, absence: "Not available in this environment" });
  });

  it("a Part with no ledger history gets the NEEDS_PLANNING recommendation, with no quantity or urgency invented", () => {
    const r = partNoHistoryRecommendation("P9");
    expect(r).toMatchObject({ partId: "P9", recommendationStatus: "NEEDS_PLANNING", urgency: null, recommendedOrderQty: 0 });
  });
});
