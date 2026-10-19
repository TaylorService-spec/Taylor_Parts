// The scanner's two serialized-unit reads on EOS (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01), returned in the
// envelope LookupScan already consumes -- never the Firebase getAvailableEquipment / getLocationDisplay callables.
//
//   fetchSerializedUnits    /operations/equipment listAvailableEquipmentUnits (inventory.serializedAsset.read)
//   fetchLocationLabels     /operations/inventory listInventoryLocations (the caller's governed warehouses and bins)
//
// A refusal is `{ errorStatus: "permission-denied" }`, a failure `{ errorStatus: "unavailable" }`: the scanner renders
// them as DENIED / UNAVAILABLE, never as "nothing here".
import { callEquipmentApi, EQUIPMENT_LIST_MAX } from "./equipmentApiClient.js";

export async function fetchSerializedUnits({ partId } = {}, call = callEquipmentApi) {
  const res = await call("listAvailableEquipmentUnits", { limit: EQUIPMENT_LIST_MAX, ...(partId ? { partId } : {}) });
  if (!res.ok) return { errorStatus: res.code === "FORBIDDEN" ? "permission-denied" : "unavailable" };
  return {
    result: {
      status: "ready",
      availableEquipment: (res.result?.units ?? []).map((u) => ({
        serialNo: u.serialNumber, partId: u.partId, currentLocationId: u.locationId, inventoryState: u.status, currentEquipmentId: null,
      })),
    },
  };
}

/**
 * A SCANNED SERIAL NUMBER, resolved to its unit(s) (Firebase exit B3-x): the same listAvailableEquipmentUnits read with its `serialNumber` filter.
 * The server filters to the caller's operating companies in the WHERE, so another company's unit is simply absent. It answers only for whole units
 * in warehouse or bin custody that are AVAILABLE or RESERVED; a unit on a truck, in transit or installed is not found here, and the screen says
 * what was searched. A serial number is not unique across Parts, so every match is returned and none is picked.
 */
export async function fetchUnitsBySerial({ serialNumber } = {}, call = callEquipmentApi) {
  const res = await call("listAvailableEquipmentUnits", { limit: 20, serialNumber });
  if (!res.ok) return { errorStatus: res.code === "FORBIDDEN" ? "permission-denied" : "unavailable" };
  return {
    result: {
      units: (res.result?.units ?? []).map((u) => ({
        serialNo: u.serialNumber, partId: u.partId, partName: u.partName ?? null, inventoryState: u.status,
        warehouseName: u.warehouseName ?? null, binCode: u.binCode ?? null, locationId: u.locationId,
      })),
    },
  };
}

// The inventory location client is loaded LAZILY: its transport initializes the browser's Firebase Auth seam at import,
// and this module must stay importable in plain node where the contract tests run.
const defaultLocationList = async (input) => (await import("./inventoryLocationClient.js")).listInventoryLocations(input);

export async function fetchLocationLabels(locationIds = [], list = defaultLocationList) {
  let items;
  try {
    items = await list({});
  } catch (err) {
    return { errorStatus: err?.code === "FORBIDDEN" || err?.code === "permission-denied" ? "permission-denied" : "unavailable" };
  }
  const byId = new Map(items.map((i) => [i.locationId, i]));
  const warehouseName = new Map(items.filter((i) => i.type === "WAREHOUSE").map((i) => [i.warehouseId, i.name]));
  return {
    result: {
      status: "ready",
      locations: locationIds.map((id) => {
        const i = byId.get(id);
        if (!i) return { locationId: id, type: "UNRESOLVED", label: null };
        const label = i.type === "BIN" ? [warehouseName.get(i.warehouseId), i.code ?? i.name].filter(Boolean).join(" / ") : i.name;
        return label ? { locationId: id, type: "WAREHOUSE", label } : { locationId: id, type: "UNRESOLVED", label: null };
      }),
    },
  };
}
