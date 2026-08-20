// Inventory > Transfers -- hook tests for the X-TRANSFER-ORDERS-UNBOUNDED-READ remediation.
//
// hooks/useTransferOrders.js used to call the UNBOUNDED operationsQueries.fetchTransferOrderDocs/
// fetchWarehouses -- a plain getDocs over the whole collection, no cap, no truncated flag at all.
// It now calls the PAGE variants (fetchTransferOrderDocsPage/fetchWarehousesPage) and must surface
// each read's own truncation fact separately, never silently drop rows past the cap without saying
// so. These tests pin: the hook calls the PAGE functions (not the unbounded originals), returns the
// capped items, and reports transferOrdersTruncated/warehousesTruncated independently per source.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  transferOrdersPage: () => Promise.resolve({ items: [], truncated: false }),
  warehousesPage: () => Promise.resolve({ items: [], truncated: false }),
}));

const fetchTransferOrderDocsPage = vi.fn(() => h.transferOrdersPage());
const fetchWarehousesPage = vi.fn(() => h.warehousesPage());
// The unbounded originals must NEVER be called by this hook -- a call proves a regression back
// to the defect this remediation fixes.
const fetchTransferOrderDocs = vi.fn(() => Promise.reject(new Error("unbounded fetch must not be called")));
const fetchWarehouses = vi.fn(() => Promise.reject(new Error("unbounded fetch must not be called")));

vi.mock("../src/services/operationsQueries", () => ({
  fetchTransferOrderDocsPage: (...args) => fetchTransferOrderDocsPage(...args),
  fetchWarehousesPage: (...args) => fetchWarehousesPage(...args),
  fetchTransferOrderDocs: (...args) => fetchTransferOrderDocs(...args),
  fetchWarehouses: (...args) => fetchWarehouses(...args),
}));

const { useTransferOrders } = await import("../src/hooks/useTransferOrders.js");

const doc = (docId) => ({ docId, data: { partId: "PART-1", status: "REQUESTED" } });
const wh = (id) => ({ id, name: `Warehouse ${id}` });

describe("useTransferOrders -- bounded reads", () => {
  it("calls the PAGE fetchers, never the unbounded originals", async () => {
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchTransferOrderDocsPage).toHaveBeenCalled();
    expect(fetchWarehousesPage).toHaveBeenCalled();
    expect(fetchTransferOrderDocs).not.toHaveBeenCalled();
    expect(fetchWarehouses).not.toHaveBeenCalled();
  });

  it("reports transferOrdersTruncated=false and warehousesTruncated=false when neither page is capped", async () => {
    h.transferOrdersPage = () => Promise.resolve({ items: [doc("to-1")], truncated: false });
    h.warehousesPage = () => Promise.resolve({ items: [wh("wh-1")], truncated: false });
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferOrderDocs).toEqual([doc("to-1")]);
    expect(result.current.warehouses).toEqual([wh("wh-1")]);
    expect(result.current.transferOrdersTruncated).toBe(false);
    expect(result.current.warehousesTruncated).toBe(false);
  });

  it("reports transferOrdersTruncated=true independently when only the transfer_orders page is capped", async () => {
    h.transferOrdersPage = () => Promise.resolve({ items: [doc("to-1")], truncated: true });
    h.warehousesPage = () => Promise.resolve({ items: [wh("wh-1")], truncated: false });
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferOrdersTruncated).toBe(true);
    expect(result.current.warehousesTruncated).toBe(false);
  });

  it("reports warehousesTruncated=true independently when only the warehouses page is capped", async () => {
    h.transferOrdersPage = () => Promise.resolve({ items: [], truncated: false });
    h.warehousesPage = () => Promise.resolve({ items: [wh("wh-1")], truncated: true });
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferOrdersTruncated).toBe(false);
    expect(result.current.warehousesTruncated).toBe(true);
  });

  it("fails closed on a denied read -- error code surfaced, both truncated flags reset to false", async () => {
    h.transferOrdersPage = () => Promise.reject(Object.assign(new Error("nope"), { code: "permission-denied" }));
    h.warehousesPage = () => Promise.resolve({ items: [], truncated: false });
    const { result } = renderHook(() => useTransferOrders(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.transferOrderDocs).toEqual([]);
    expect(result.current.warehouses).toEqual([]);
    expect(result.current.transferOrdersTruncated).toBe(false);
    expect(result.current.warehousesTruncated).toBe(false);
  });
});
