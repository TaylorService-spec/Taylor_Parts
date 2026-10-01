// Truck Inventory activation (2026-10-01, OD-T7 / Package J): the workspace's truck command client is RETIRED. Every command
// refuses with where the act now lives (Administration -> Truck registry; Employee MOBILE scope) and sends NOTHING -- no
// Firebase callable, no network. Warehouse options come from eos_ops.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { truckRegistryCommandClient, fetchWarehouseOptions, TRUCK_REGISTRY_ADMINISTRATION_MOVED } from "../src/services/truckRegistryCommandClient.js";

describe("truckRegistryCommandClient (retired)", () => {
  it("every command refuses FAILED_PRECONDITION with the Administration pointer, and imports no Firebase", async () => {
    for (const [name, fn] of Object.entries(truckRegistryCommandClient)) {
      await expect(fn({ truckId: "T" })).rejects.toMatchObject({ code: "failed-precondition", message: TRUCK_REGISTRY_ADMINISTRATION_MOVED }, name);
    }
    const src = readFileSync(resolve(process.cwd(), "src/services/truckRegistryCommandClient.js"), "utf8");
    expect(src).not.toMatch(/from "firebase\//);
    expect(src).not.toMatch(/Callable"/);
  });

  it("fetchWarehouseOptions reads the governed EOS warehouses, sorted by label", async () => {
    const call = vi.fn(async () => ({ items: [{ warehouseId: "WH-2", name: "Beta" }, { warehouseId: "WH-1", name: "Alpha" }] }));
    expect(await fetchWarehouseOptions(call)).toEqual([{ id: "WH-1", label: "Alpha" }, { id: "WH-2", label: "Beta" }]);
    expect(call.mock.calls[0][1]).toBe("listInventoryWarehouses");
  });
});
