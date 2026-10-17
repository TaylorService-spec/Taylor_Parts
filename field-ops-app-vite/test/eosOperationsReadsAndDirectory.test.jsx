// FIREBASE EXIT F2-remainder + F4 (DECISIONS #246 / #247) -- the Part movement history and the governed directory, proved.
// Run: npx vitest run test/eosOperationsReadsAndDirectory.test.jsx
//
//   1. usePartMovementHistory: the EOS ledger read for ONE Part -- mapped, bounded, principal-isolated, never an empty-looking failure.
//   2. WarehouseManagerHome "Part Activity": under EOS the panel shows those movements AND the frozen inventory_actions notes stay
//      reachable, read-only, under the plain "Legacy notes" label (interim, D-246-1); under Firebase it is the legacy panel as before.
//   3. PartDetail: under EOS the frozen notes disclosure is rendered too (read-only, labelled "Legacy notes (frozen 2026-08-30; not
//      stock movements)", actors named by the governed read, no Firestore employees listen) and the assignee is named by the
//      governed Employee-name read; under Firebase the disclosure keeps its old title.
//   4. useGovernedEmployeeDirectory: one answer per signed-in principal (no sharing across people), and a read that never answers
//      settles as an error.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, renderHook, act, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ eos: true, uid: "u1", actionsHookCalls: 0, employeeDirectoryHookCalls: 0 }));

vi.mock("../src/access/eosSessionSource.js", () => ({ get EOS_SESSION_SOURCE() { return h.eos; } }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: h.uid }, role: "admin", operationalRoles: [] }) }));

const fetchInventoryMovements = vi.hoisted(() => vi.fn());
vi.mock("../src/services/partsOperationsReads.js", () => ({ fetchInventoryMovements, fetchInventoryPosition: vi.fn() }));
vi.mock("../src/hooks/useInventoryActions", () => ({
  useInventoryActionsForPart: () => { h.actionsHookCalls += 1; return { data: [{ id: "legacy-1", transactionType: "ADJUST_STOCK", quantityDelta: 9, reason: "legacy note", createdBy: "uid-x", createdAt: 1 }], loading: false, error: null }; },
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: (args) => { if (args?.enabled !== false) h.employeeDirectoryHookCalls += 1; return { byUserId: new Map(), loading: false, error: null }; },
  resolveActorDisplayName: (id, map) => (id ? (map?.get?.(id)?.displayName ?? "Unknown user") : id),
}));
const governedAsked = vi.hoisted(() => []);
const governedNames = vi.hoisted(() => ({ byEmployeeId: new Map(), byUserId: new Map() }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", () => ({
  useGovernedEmployeeDirectory: (args) => { governedAsked.push(args); return { byEmployeeId: governedNames.byEmployeeId, byUserId: governedNames.byUserId, loading: false, error: null }; },
  resolveActorDisplayName: (id, map) => (id ? (map?.get?.(id)?.displayName ?? "Unknown user") : id),
}));

vi.mock("../src/services/partMasterQueries", () => { const searchParts = vi.fn(); return { searchParts, readPartsForView: (partIds) => searchParts({ partIds }), isCatalogReadRefused: (code) => code === "FORBIDDEN" || code === "NOT_SIGNED_IN" }; });
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
const HEALTH_ENTRY = {
  partId: "TST-9001", stock: { availableStock: 5 }, usage: {},
  recommendation: { recommendationStatus: "READY", urgency: "LOW", reorderPoint: 2, recommendedOrderQty: 10, daysRemaining: 5 },
};
vi.mock("../src/hooks/useInventoryLedger", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useInventoryLedger: () => ({ transactions: [], healthEntries: [HEALTH_ENTRY], loading: false, error: null, integrity: null }) };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, reviewReorderRequest: vi.fn(), assignReorderRequest: vi.fn(),
  startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn(), cancelReorderRequest: vi.fn(),
}));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
const reorderRequestState = vi.hoisted(() => ({ current: { data: null, loading: false, error: null, refresh: () => {} } }));
vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestForPart: () => reorderRequestState.current }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/hooks/usePartWorkOrderDemand", async () => {
  const actual = await vi.importActual("../src/hooks/usePartWorkOrderDemand");
  return { ...actual, usePartWorkOrderDemand: () => ({ status: actual.PART_WORK_ORDER_DEMAND_STATE.READY, rows: [], scannedCount: 0, totalOpenWorkOrders: 0 }) };
});
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ partId: "TST-9001" }), useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { searchParts } from "../src/services/partMasterQueries";
import WarehouseManagerHome from "../src/modules/inventoryRole/WarehouseManagerHome.jsx";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";
import { LEGACY_INVENTORY_NOTES_LABEL } from "../src/domain/constants";
import { usePartMovementHistory, readPartMovements, PART_MOVEMENT_LIMIT } from "../src/hooks/usePartMovementHistory.js";

const CANONICAL_OK = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-A", category: "Valves", stockingUnit: "each" }], invalid: [] };

const MOVEMENTS = {
  scopedWarehouseIds: ["wh-1"],
  truncated: false,
  items: [
    { movementId: "m2", partId: "TST-9001", movementType: "RECEIVED", quantityDelta: 12, sourceKind: "RECEIPT", sourceId: "rcpt-1", occurredAt: "2026-10-02T10:00:00.000Z" },
    { movementId: "m1", partId: "TST-9001", movementType: "ADJUSTED", quantityDelta: -2, sourceKind: "WORK_ORDER", sourceId: "WO-77", occurredAt: "2026-10-01T10:00:00.000Z" },
  ],
};

beforeEach(() => {
  h.eos = true; h.uid = "u1"; h.actionsHookCalls = 0; h.employeeDirectoryHookCalls = 0;
  governedAsked.length = 0; governedNames.byEmployeeId = new Map(); governedNames.byUserId = new Map();
  reorderRequestState.current = { data: null, loading: false, error: null, refresh: () => {} };
  searchParts.mockResolvedValue(CANONICAL_OK);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("usePartMovementHistory -- the EOS ledger for one Part", () => {
  it("asks for exactly this Part, bounded, and returns word-typed rows with the work order only where there is one", async () => {
    fetchInventoryMovements.mockResolvedValue(MOVEMENTS);
    const { result } = renderHook(() => usePartMovementHistory("TST-9001"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchInventoryMovements).toHaveBeenCalledWith({ partIds: ["TST-9001"], limit: PART_MOVEMENT_LIMIT }, expect.objectContaining({ signal: expect.anything() }));
    expect(result.current.error).toBeNull();
    expect(result.current.data.map((r) => [r.type, r.quantity, r.workOrderId])).toEqual([["Received", 12, null], ["Adjusted", -2, "WO-77"]]);
  });

  it("a refusal or failure is an ERROR with the server's code and no rows -- never an empty-looking history", async () => {
    fetchInventoryMovements.mockRejectedValue(Object.assign(new Error("no"), { code: "FORBIDDEN" }));
    const { result } = renderHook(() => usePartMovementHistory("TST-9001"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("FORBIDDEN");
    expect(result.current.data).toEqual([]);
  });

  it("a read that never answers settles as UNREACHABLE (no infinite Loading)", async () => {
    vi.useFakeTimers();
    fetchInventoryMovements.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePartMovementHistory("TST-9001"));
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("UNREACHABLE");
  });

  it("a different signed-in principal never sees the previous principal's answer, not even for one render", async () => {
    fetchInventoryMovements.mockResolvedValue(MOVEMENTS);
    const { result, rerender } = renderHook(() => usePartMovementHistory("TST-9001"));
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    let release;
    fetchInventoryMovements.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    h.uid = "u2";
    rerender();
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => { release({ ...MOVEMENTS, items: [] }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
  });

  it("readPartMovements reports truncation as the server states it", async () => {
    const out = await readPartMovements("TST-9001", { fetchMovements: async () => ({ ...MOVEMENTS, truncated: true }) });
    expect(out.truncated).toBe(true);
    expect(out.rows).toHaveLength(2);
  });
});

describe("WarehouseManagerHome -- Part Activity", () => {
  const openActivity = async () => {
    render(<WarehouseManagerHome />);
    fireEvent.click(await screen.findByRole("button", { name: /View Activity for CANONICAL-A/ }));
  };

  it("under EOS it shows the EOS ledger movements, and the frozen notes stay reachable, read-only, under the Legacy notes label", async () => {
    h.eos = true;
    fetchInventoryMovements.mockResolvedValue(MOVEMENTS);
    await openActivity();
    await screen.findByText("Received");
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("WO-77")).toBeTruthy();
    const legacy = screen.getByText(LEGACY_INVENTORY_NOTES_LABEL).closest("details");
    expect(legacy).toBeTruthy();
    // The notes are NOT merged into the movements table: they live only inside the labelled disclosure.
    expect(within(legacy).getByText("legacy note")).toBeTruthy();
    expect(screen.getAllByText("legacy note")).toHaveLength(1);
    // Read-only: nothing to press or type inside the notes.
    expect([...legacy.querySelectorAll("button, input, textarea, select, form")].filter((el) => !el.closest("th"))).toHaveLength(0); // column-sort headers are the only controls
    expect(h.actionsHookCalls).toBeGreaterThan(0);
  });

  it("under EOS the notes remain readable even when the movements cannot be loaded", async () => {
    h.eos = true;
    fetchInventoryMovements.mockRejectedValue(Object.assign(new Error("no"), { code: "FORBIDDEN" }));
    await openActivity();
    await screen.findByText(/Unable to load part activity right now/);
    expect(within(screen.getByText(LEGACY_INVENTORY_NOTES_LABEL).closest("details")).getByText("legacy note")).toBeTruthy();
  });

  it("under EOS a refused read says it could not be loaded, not 'no activity'", async () => {
    h.eos = true;
    fetchInventoryMovements.mockRejectedValue(Object.assign(new Error("no"), { code: "FORBIDDEN" }));
    await openActivity();
    await screen.findByText(/Unable to load part activity right now/);
    expect(screen.queryByText(/No movements recorded/)).toBeNull();
  });

  it("under EOS with no scoped movements it says so honestly", async () => {
    h.eos = true;
    fetchInventoryMovements.mockResolvedValue({ scopedWarehouseIds: [], items: [], truncated: false });
    await openActivity();
    await screen.findByText(/No movements recorded for this part in the warehouses you work in/);
  });

  it("under Firebase it is the legacy panel and reads no EOS ledger", async () => {
    h.eos = false;
    await openActivity();
    await screen.findByText("legacy note");
    expect(h.actionsHookCalls).toBeGreaterThan(0);
    expect(fetchInventoryMovements).not.toHaveBeenCalled();
  });
});

describe("PartDetail -- the frozen notes, and the assignee name", () => {
  it("under EOS the notes disclosure renders read-only under the Legacy notes label, names its actors through the governed read and starts no Firestore employees listen; the assignee is named by the governed read", async () => {
    h.eos = true;
    reorderRequestState.current = {
      data: { id: "rr-1", partId: "TST-9001", status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedEmployeeId: "emp-9", requestedQty: 3, urgency: "HIGH" },
      loading: false, error: null, refresh: () => {},
    };
    governedNames.byEmployeeId = new Map([["emp-9", { id: "emp-9", displayName: "Pat Associate" }]]);
    governedNames.byUserId = new Map([["uid-x", { id: "uid-x", displayName: "Dana Clerk" }]]);
    render(<PartDetail />);
    await screen.findByText("CANONICAL-A");
    const legacy = screen.getByText(LEGACY_INVENTORY_NOTES_LABEL).closest("details");
    expect(legacy).toBeTruthy();
    expect(screen.queryAllByText("Inventory Action History").filter((n) => n.tagName === "SUMMARY")).toHaveLength(0);
    // The frozen notes are read from their current source, with the actor named, and are not editable.
    expect(h.actionsHookCalls).toBeGreaterThan(0);
    expect(within(legacy).getByText("legacy note")).toBeTruthy();
    expect(within(legacy).getByText("Dana Clerk")).toBeTruthy();
    expect([...legacy.querySelectorAll("button, input, textarea, select, form")].filter((el) => !el.closest("th"))).toHaveLength(0); // column-sort headers are the only controls
    expect(h.employeeDirectoryHookCalls).toBe(0);
    expect(governedAsked).toContainEqual({ enabled: true, actorSubjects: ["uid-x"] });
    expect(governedAsked).toContainEqual({ employeeIds: ["emp-9"] });
    expect(screen.getAllByText("Pat Associate").length).toBeGreaterThan(0);
  });

  it("under Firebase the disclosure stays and the Firestore directory names the legacy actors", async () => {
    h.eos = false;
    render(<PartDetail />);
    await screen.findByText("CANONICAL-A");
    expect(screen.getAllByText("Inventory Action History").length).toBeGreaterThan(0);
    expect(screen.queryByText(LEGACY_INVENTORY_NOTES_LABEL)).toBeNull();
    // Firebase is the source: the Firestore directory is read, the governed actor read is disabled.
    expect(h.employeeDirectoryHookCalls).toBeGreaterThan(0);
    expect(governedAsked).toContainEqual({ enabled: false, actorSubjects: ["uid-x"] });
  });
});
