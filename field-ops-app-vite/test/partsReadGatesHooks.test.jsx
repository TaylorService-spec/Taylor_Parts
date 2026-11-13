// UAT RO-01 -- the three hooks that gained an `enabled` switch make NO request while it is off, settle at the answer a refused read would
// have produced (so a consumer's existing denied/empty handling applies), and read when it flips on.
// Run: npx vitest run test/partsReadGatesHooks.test.jsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const fetchManufacturerCatalog = vi.hoisted(() => vi.fn());
const fetchSupplierList = vi.hoisted(() => vi.fn());
const callReorder = vi.hoisted(() => vi.fn());
vi.mock("../src/services/manufacturerCatalogClient.js", () => ({ fetchManufacturerCatalog }));
vi.mock("../src/services/partsOperationsReads.js", () => ({ fetchSupplierList }));
vi.mock("../src/services/reorderApiClient.js", () => ({ reorderApiClient: { call: callReorder } }));

import { useManufacturerCatalog } from "../src/hooks/useManufacturerCatalog.js";
import { useSuppliers } from "../src/hooks/useSuppliers.js";
import { useReorderRequestsHistory } from "../src/hooks/useReorderRequests.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("useManufacturerCatalog(enabled)", () => {
  it("off: no request, settled at 'denied'; on: reads once", async () => {
    const { result, rerender } = renderHook(({ on }) => useManufacturerCatalog(on), { initialProps: { on: false } });
    expect(result.current).toEqual({ loading: false, errorStatus: "denied", result: null });
    expect(fetchManufacturerCatalog).not.toHaveBeenCalled();
    fetchManufacturerCatalog.mockResolvedValue({ result: { status: "ready", manufacturers: [] } });
    rerender({ on: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchManufacturerCatalog).toHaveBeenCalledTimes(1);
    expect(result.current.errorStatus).toBeNull();
  });

  it("the default is ON (every existing caller is unchanged)", async () => {
    fetchManufacturerCatalog.mockResolvedValue({ result: { status: "ready", manufacturers: [] } });
    renderHook(() => useManufacturerCatalog());
    await waitFor(() => expect(fetchManufacturerCatalog).toHaveBeenCalledTimes(1));
  });
});

describe("useSuppliers(accessVersion, enabled)", () => {
  it("off: no request, settled at the FORBIDDEN a refused read gives; the default is ON", async () => {
    const off = renderHook(() => useSuppliers(0, false));
    expect(off.result.current).toEqual({ loading: false, error: "FORBIDDEN", suppliers: [], truncated: false });
    expect(fetchSupplierList).not.toHaveBeenCalled();
    fetchSupplierList.mockResolvedValue([{ id: "s1", name: "Acme" }]);
    renderHook(() => useSuppliers(0));
    await waitFor(() => expect(fetchSupplierList).toHaveBeenCalledTimes(1));
  });
});

describe("useReorderRequestsHistory({ enabled })", () => {
  const args = { statuses: ["RECEIVED"], pageSize: 25 };
  it("off: the page reader is never called and the answer is empty, not loading, no error", async () => {
    const fetchPageImpl = vi.fn();
    const { result } = renderHook(() => useReorderRequestsHistory({ ...args, fetchPageImpl, enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPageImpl).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("on (the default): reads the first page", async () => {
    const fetchPageImpl = vi.fn().mockResolvedValue({ docs: [{ id: "r1" }], lastVisible: null, size: 1 });
    const { result } = renderHook(() => useReorderRequestsHistory({ ...args, fetchPageImpl }));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(fetchPageImpl).toHaveBeenCalledTimes(1);
  });
});
