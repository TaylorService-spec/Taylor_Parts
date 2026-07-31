// INV-EQ-P1b -- focused tests for the real paginated hook through its injected read
// seams (no firebase). Proves cursor/limit progression, bounded name resolution,
// accessVersion reset, stale-completion suppression, denied first-page handling, and
// partial load-more failure. Run via `npm run test:components` (vitest + jsdom).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useInstalledEquipmentPage } from "../src/hooks/useInstalledEquipmentPage";
import { ACCOUNTS_COLLECTION, LOCATIONS_COLLECTION } from "../src/domain/constants";

const upperNames = vi.fn(async ({ ids }) => new Map(ids.map((id) => [id, id.toUpperCase()])));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useInstalledEquipmentPage", () => {
  it("loads page 1 by documentId cursor, resolves bounded names, and appends on loadMore", async () => {
    const readEquipmentPage = vi.fn(async ({ cursor }) => {
      if (cursor == null) return { docs: [{ id: "e1", accountId: "a1" }, { id: "e2", accountId: "a1", locationId: "l1" }], lastId: "e2", hasMore: true };
      if (cursor === "e2") return { docs: [{ id: "e3", accountId: "a2" }], lastId: "e3", hasMore: false };
      return { docs: [], lastId: cursor, hasMore: false };
    });
    const readNames = vi.fn(upperNames);
    const { result } = renderHook(() => useInstalledEquipmentPage(1, { readEquipmentPage, readNames, pageSize: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.docs.map((d) => d.id)).toEqual(["e1", "e2"]);
    expect(result.current.hasMore).toBe(true);
    expect(readEquipmentPage).toHaveBeenCalledWith({ cursor: null, pageSize: 2 });
    // bounded name reads only for the distinct ids present in the loaded page
    expect(readNames).toHaveBeenCalledWith({ collectionName: ACCOUNTS_COLLECTION, ids: ["a1"] });
    expect(readNames).toHaveBeenCalledWith({ collectionName: LOCATIONS_COLLECTION, ids: ["l1"] });
    await waitFor(() => expect(result.current.accountNames.get("a1")).toBe("A1"));

    await act(async () => { await result.current.loadMore(); });
    expect(readEquipmentPage).toHaveBeenCalledWith({ cursor: "e2", pageSize: 2 });
    expect(result.current.docs.map((d) => d.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("resets rows and reloads page 1 when accessVersion changes", async () => {
    const readEquipmentPage = vi.fn(async () => ({ docs: [{ id: "e1", accountId: "a1" }], lastId: "e1", hasMore: false }));
    const readNames = vi.fn(upperNames);
    const { result, rerender } = renderHook(
      ({ v }) => useInstalledEquipmentPage(v, { readEquipmentPage, readNames, pageSize: 2 }),
      { initialProps: { v: 1 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    readEquipmentPage.mockClear();
    rerender({ v: 2 });
    await waitFor(() => expect(readEquipmentPage).toHaveBeenCalledWith({ cursor: null, pageSize: 2 }));
    // the reset clears rows then reloads asynchronously -- wait for the repopulated page
    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toEqual(["e1"]));
  });

  it("discards a stale first-page completion after an accessVersion reset", async () => {
    const d1 = deferred();
    const d2 = deferred();
    let call = 0;
    const readEquipmentPage = vi.fn(() => (call++ === 0 ? d1.promise : d2.promise));
    const readNames = vi.fn(upperNames);
    const { result, rerender } = renderHook(
      ({ v }) => useInstalledEquipmentPage(v, { readEquipmentPage, readNames, pageSize: 2 }),
      { initialProps: { v: 1 } },
    );
    // v=1 load is in flight (d1). Reset to v=2 -> a new run starts (d2).
    rerender({ v: 2 });
    // Resolve the STALE v=1 page LATE; it must be discarded.
    await act(async () => { d1.resolve({ docs: [{ id: "STALE", accountId: "a1" }], lastId: "STALE", hasMore: false }); });
    await act(async () => { d2.resolve({ docs: [{ id: "FRESH", accountId: "a2" }], lastId: "FRESH", hasMore: false }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.docs.map((d) => d.id)).toEqual(["FRESH"]);
  });

  it("fails closed as denied on a permission-denied first page", async () => {
    const readEquipmentPage = vi.fn(async () => { const e = new Error("nope"); e.code = "permission-denied"; throw e; });
    const readNames = vi.fn(upperNames);
    const { result } = renderHook(() => useInstalledEquipmentPage(1, { readEquipmentPage, readNames }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.denied).toBe(true);
    expect(result.current.docs).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it("keeps loaded rows and surfaces partialError when a later page fails", async () => {
    const readEquipmentPage = vi.fn(async ({ cursor }) => {
      if (cursor == null) return { docs: [{ id: "e1", accountId: "a1" }], lastId: "e1", hasMore: true };
      throw new Error("boom");
    });
    const readNames = vi.fn(upperNames);
    const { result } = renderHook(() => useInstalledEquipmentPage(1, { readEquipmentPage, readNames, pageSize: 1 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.partialError).toBeTruthy();
    expect(result.current.denied).toBe(false);
    expect(result.current.docs.map((d) => d.id)).toEqual(["e1"]); // rows retained
  });
});
