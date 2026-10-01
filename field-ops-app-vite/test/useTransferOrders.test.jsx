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
}));
const listTransferOrderDocs = vi.fn((...a) => h.orders(...a));
const fetchInventoryWarehouseOptions = vi.fn(() => h.warehouses());
// Firestore must never be touched by this hook.
const firestoreTouched = vi.fn();
vi.mock("../src/services/operationsQueries", () => new Proxy({}, { get: () => firestoreTouched }));
vi.mock("../src/services/transferCommandClient.js", () => ({ listTransferOrderDocs: (...a) => listTransferOrderDocs(...a) }));
vi.mock("../src/services/inventoryLocationClient.js", () => ({ fetchInventoryWarehouseOptions: (...a) => fetchInventoryWarehouseOptions(...a) }));

const { useTransferOrders } = await import("../src/hooks/useTransferOrders.js");

const doc = (docId) => ({ docId, data: { partId: "PART-1", status: "REQUESTED" } });

describe("useTransferOrders -- EOS reads", () => {
  it("reads the governed transfer list and warehouses, never Firestore", async () => {
    h.orders = () => Promise.resolve({ items: [doc("trf_1")], truncated: false });
    h.warehouses = () => Promise.resolve([{ id: "taylor-main", name: "Taylor Main Warehouse", status: "ACTIVE" }]);
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listTransferOrderDocs).toHaveBeenCalled();
    expect(fetchInventoryWarehouseOptions).toHaveBeenCalled();
    expect(firestoreTouched).not.toHaveBeenCalled();
    expect(result.current.transferOrderDocs).toEqual([doc("trf_1")]);
    expect(result.current.warehouses).toEqual([{ id: "taylor-main", name: "Taylor Main Warehouse" }]);
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
