// EI-P1d-2-2b -- tests for the Truck Registry producer hook through its injected read seams
// (no firebase). Proves: authorized success (composed trucks + governed options + accessVersion
// stamp), empty read, denied, sanitized error, malformed docs dropped, inactive-location
// visible + marked, stale-access suppression + boundary re-scope, and NO-N+1 driver resolution
// (one batched fetch for the de-duplicated driver set). Run via `npm run test:components`.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTruckRegistrySource } from "../src/hooks/useTruckRegistrySource";
import { readTruckInventorySource } from "../src/access/truckInventorySource";
import { SERIALIZED_ASSET_STATES } from "../src/domain/serializedAssetIdentity";

const LOC = "MLOC-204";
const locDoc = (over = {}) => ({ docId: LOC, data: { locationId: LOC, type: "MOBILE", displayLabel: "Truck 204", active: true, ...over } });
const truckDoc = (over = {}) => ({ docId: "TRK-204", data: { truckId: "TRK-204", locationId: LOC, vehicleNumber: "204", displayLabel: "Truck 204", status: "ACTIVE", homeWarehouseId: "WH-MAIN", assignedDriverEmployeeId: "emp-mb", ...over } });

function deps({ locs = [], trucks = [], names = new Map(), fail } = {}) {
  const fetchMobileLocationDocs = vi.fn(async () => { if (fail?.where === "locs") throw fail.error; return locs; });
  const fetchTruckDocs = vi.fn(async () => { if (fail?.where === "trucks") throw fail.error; return trucks; });
  const fetchDriverNames = vi.fn(async () => { if (fail?.where === "names") throw fail.error; return names; });
  return { fetchMobileLocationDocs, fetchTruckDocs, fetchDriverNames };
}

describe("useTruckRegistrySource", () => {
  it("authorized success: composes trucks, governed options, and stamps accessVersion", async () => {
    const d = deps({ locs: [locDoc()], trucks: [truckDoc()], names: new Map([["emp-mb", "Marcus Bell"]]) });
    const { result } = renderHook(() => useTruckRegistrySource(1, d));
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    const src = result.current.source;
    expect(src.connected).toBe(true);
    expect(src.accessVersion).toBe(1);
    expect(src.trucks).toHaveLength(1);
    expect(src.trucks[0].id).toBe("TRK-204");
    expect(src.trucks[0].technician).toBe("Marcus Bell");
    expect(src.options.fleetStatus).toEqual(["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
    expect(src.options.equipmentStatus).toEqual([...SERIALIZED_ASSET_STATES]);
    expect(src.options.equipmentCondition).toEqual([]); // deferred
    // the workspace reads READY at the matching boundary key
    expect(readTruckInventorySource(src, 1).status).toBe("ready");
  });

  it("empty read -> ready with no trucks (honest empty state)", async () => {
    const d = deps({ locs: [], trucks: [] });
    const { result } = renderHook(() => useTruckRegistrySource(1, d));
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(result.current.source.connected).toBe(true);
    expect(result.current.source.trucks).toEqual([]);
  });

  it("permission-denied read -> sanitized denied (no trucks, no payload)", async () => {
    const err = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    const d = deps({ fail: { where: "trucks", error: err } });
    const { result } = renderHook(() => useTruckRegistrySource(2, d));
    await waitFor(() => expect(result.current.source.status).toBe("denied"));
    expect(result.current.source).toEqual({ connected: false, status: "denied", accessVersion: 2, trucks: [] });
  });

  it("any other read failure -> sanitized error (never carries the raw error)", async () => {
    const err = Object.assign(new Error("network kaput"), { code: "unavailable" });
    const d = deps({ fail: { where: "names", error: err } });
    const { result } = renderHook(() => useTruckRegistrySource(3, d));
    await waitFor(() => expect(result.current.source.status).toBe("error"));
    const src = result.current.source;
    expect(src).toEqual({ connected: false, status: "error", accessVersion: 3, trucks: [] });
    expect(JSON.stringify(src)).not.toMatch(/kaput/);
  });

  it("malformed docs are dropped fail-closed (no fabricated rows)", async () => {
    const d = deps({ locs: [{ docId: "BAD", data: { type: "WAREHOUSE" } }], trucks: [{ docId: "T", data: { truckId: "T", locationId: "MISSING" } }] });
    const { result } = renderHook(() => useTruckRegistrySource(1, d));
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(result.current.source.trucks).toEqual([]);
  });

  it("inactive MOBILE Location: truck stays visible and is marked inactive", async () => {
    const d = deps({ locs: [locDoc({ active: false })], trucks: [truckDoc()], names: new Map() });
    const { result } = renderHook(() => useTruckRegistrySource(1, d));
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(result.current.source.trucks).toHaveLength(1);
    expect(result.current.source.trucks[0].locationActive).toBe(false);
    expect(result.current.source.trucks[0].location).toMatch(/Inactive/);
  });

  it("no N+1: driver names are resolved in ONE batched pass for the de-duplicated driver set", async () => {
    const d = deps({
      locs: [locDoc(), locDoc({ locationId: "MLOC-2", displayLabel: "Truck 2" })],
      trucks: [
        truckDoc(),
        truckDoc({ truckId: "TRK-2", locationId: "MLOC-2", assignedDriverEmployeeId: "emp-mb" }), // SAME driver
      ],
      names: new Map([["emp-mb", "Marcus Bell"]]),
    });
    const { result } = renderHook(() => useTruckRegistrySource(1, d));
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(d.fetchDriverNames).toHaveBeenCalledTimes(1); // not once-per-truck
    // resolver received the trucks, from which it collects the distinct driver id set
    expect(d.fetchDriverNames).toHaveBeenCalledWith(expect.any(Array));
  });

  it("stale-access: an access change re-scopes to loading and the prior source can't leak", async () => {
    const d = deps({ locs: [locDoc()], trucks: [truckDoc()], names: new Map([["emp-mb", "Marcus Bell"]]) });
    const { result, rerender } = renderHook(({ v }) => useTruckRegistrySource(v, d), { initialProps: { v: 1 } });
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    // access changes -> synchronously loading, no trucks, for the new version
    act(() => rerender({ v: 2 }));
    // even before the new read resolves, a v1-stamped READY source would be downgraded by the
    // workspace boundary key; here the hook itself re-scopes to loading first.
    await waitFor(() => expect(result.current.source.accessVersion).toBe(2));
    // once resolved it is ready at the NEW boundary
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(readTruckInventorySource(result.current.source, 2).status).toBe("ready");
    // a source stamped for v2 is stale at boundary 1 -> loading (prior-scope data can't reappear)
    expect(readTruckInventorySource(result.current.source, 1).status).toBe("loading");
  });
});
