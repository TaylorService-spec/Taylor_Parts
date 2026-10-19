// Inventory > Transfers -- the read hook on EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// hooks/useTransferOrders.js reads the governed PostgreSQL list (listTransferOrders) and the caller's governed
// warehouses (listInventoryWarehouses) -- never Firestore `transfer_orders` / `warehouses`. These tests pin: the EOS
// reads are the only sources, rows keep the { docId, data } shape the canonical view-model validates, the transfer
// list's own truncation is disclosed, and a refusal is an error code, never an empty list.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  orders: () => Promise.resolve({ items: [], truncated: false }),
  warehouses: () => Promise.resolve([]),
  scoped: () => Promise.resolve([]),
  trucks: () => Promise.resolve([]),
  parts: () => Promise.resolve({ ok: true, parts: [] }),
}));
const listTransferOrderDocs = vi.fn((...a) => h.orders(...a));
const fetchCompanyWarehouseOptions = vi.fn(() => h.warehouses());
const fetchInventoryWarehouseOptions = vi.fn(() => h.scoped());
const fetchTruckLabels = vi.fn(() => h.trucks());
const fetchPartsByIds = vi.fn((ids) => h.parts(ids));
// Firestore must never be touched by this hook.
const firestoreTouched = vi.fn();
vi.mock("../src/services/operationsQueries", () => new Proxy({}, { get: () => firestoreTouched }));
vi.mock("../src/services/transferCommandClient.js", () => ({ listTransferOrderDocs: (...a) => listTransferOrderDocs(...a) }));
vi.mock("../src/services/inventoryLocationClient.js", () => ({
  fetchCompanyWarehouseOptions: (...a) => fetchCompanyWarehouseOptions(...a),
  fetchInventoryWarehouseOptions: (...a) => fetchInventoryWarehouseOptions(...a),
  fetchTruckLabels: (...a) => fetchTruckLabels(...a),
}));
vi.mock("../src/services/partMasterQueries.js", () => ({ fetchPartsByIds: (...a) => fetchPartsByIds(...a) }));

const { useTransferOrders } = await import("../src/hooks/useTransferOrders.js");

const doc = (docId) => ({ docId, data: { partId: "PART-1", status: "REQUESTED" } });

describe("useTransferOrders -- EOS reads", () => {
  it("reads the governed transfer list and warehouses, never Firestore", async () => {
    h.orders = () => Promise.resolve({ items: [doc("trf_1")], truncated: false });
    h.warehouses = () => Promise.resolve([{ id: "taylor-main", name: "Taylor Main Warehouse", status: "ACTIVE" }]);
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listTransferOrderDocs).toHaveBeenCalled();
    // ISO inventory: endpoints are NAMED from the COMPANY-WIDE read, so an out-of-scope destination shows its name.
    expect(fetchCompanyWarehouseOptions).toHaveBeenCalled();
    expect(firestoreTouched).not.toHaveBeenCalled();
    expect(result.current.transferOrderDocs).toEqual([doc("trf_1")]);
    expect(result.current.warehouses).toEqual([{ id: "taylor-main", name: "Taylor Main Warehouse", status: "ACTIVE", inScope: true }]);
    expect(result.current.transferOrdersTruncated).toBe(false);
  });

  it("discloses the transfer list's own truncation", async () => {
    h.orders = () => Promise.resolve({ items: [doc("trf_1")], truncated: true });
    h.warehouses = () => Promise.resolve([]);
    const { result } = renderHook(() => useTransferOrders(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferOrdersTruncated).toBe(true);
    expect(result.current.warehousesTruncated).toBe(false);
  });

  it("a refused read is an error code, never an empty list", async () => {
    h.orders = () => Promise.reject(Object.assign(new Error("no"), { code: "permission-denied" }));
    const { result } = renderHook(() => useTransferOrders(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.transferOrderDocs).toEqual([]);
  });
});

describe("useTransferOrders -- names every endpoint and the part (ISO inventory)", () => {
  it("carries the out-of-scope destination warehouse, its inScope mark, the part name and the truck name", async () => {
    h.orders = () => Promise.resolve({ items: [{ docId: "trf_2", data: { partId: "PRT-1005", status: "REQUESTED" } }], truncated: false });
    h.warehouses = () => Promise.resolve([
      { id: "taylor-main", name: "Taylor Main", status: "ACTIVE", inScope: true },
      { id: "taylor-service", name: "Taylor Service", status: "ACTIVE", inScope: false },
    ]);
    h.trucks = () => Promise.resolve([{ locationId: "taylor-sample-truck-01-stock", label: "Sample Truck 01" }]);
    h.parts = () => Promise.resolve({ ok: true, parts: [{ id: "PRT-1005", name: "Condenser Fan Motor" }] });
    const { result } = renderHook(() => useTransferOrders(10));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warehouses.find((w) => w.id === "taylor-service")).toEqual({ id: "taylor-service", name: "Taylor Service", status: "ACTIVE", inScope: false });
    expect(result.current.partNames).toEqual({ "PRT-1005": "Condenser Fan Motor" });
    expect(result.current.truckNames).toEqual({ "taylor-sample-truck-01-stock": "Sample Truck 01" });
    expect(fetchPartsByIds).toHaveBeenLastCalledWith(["PRT-1005"]);
  });

  it("a name that cannot be read leaves the id fallback -- never a failed list, never a made-up name", async () => {
    h.orders = () => Promise.resolve({ items: [{ docId: "trf_3", data: { partId: "PRT-1", status: "REQUESTED" } }], truncated: false });
    h.warehouses = () => Promise.reject(Object.assign(new Error("no"), { code: "permission-denied" }));
    h.scoped = () => Promise.reject(new Error("also no"));
    h.trucks = () => Promise.reject(new Error("no trucks"));
    h.parts = () => Promise.resolve({ ok: false, code: "FORBIDDEN" });
    const { result } = renderHook(() => useTransferOrders(11));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.transferOrderDocs).toHaveLength(1);
    expect(result.current.warehouses).toEqual([]);
    expect(result.current.partNames).toEqual({});
    expect(result.current.truckNames).toEqual({});
  });
});
