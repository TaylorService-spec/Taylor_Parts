// EI-P1d-2-2a -- pure registry-source BRIDGE. It turns an injected registry read (raw
// mobile_locations + trucks documents) into the EI-P1d-1 Truck Inventory SOURCE shape the
// merged workspace consumes, composing through the merged truckRegistry.composeTruckFleet.
//
// PURE and INJECTED: no Firebase import, no persistence, no reads. The governed read is
// injected as { status, mobileLocationDocs, truckDocs, accessVersion, ... }; NOTHING here
// reads a collection. Until a later, separately-authorized gate persists the collections +
// Rules + a Function-backed read and wires it in, the default is INERT (unavailable, no
// trucks) -- never fabricated records.
//
//   * boundary-keyed: the produced source is STAMPED with accessVersion, so the workspace's
//     readTruckInventorySource(source, boundaryKey) turns a prior-version READY source into
//     LOADING synchronously (stale-data prevention).
//   * sanitized states: DENIED / ERROR / UNAVAILABLE carry NO payload or raw error.
//   * inactive MOBILE Locations: their trucks stay VISIBLE and are clearly marked inactive.
import { composeTruckFleet, validateMobileLocation, validateTruckRecord } from "../domain/truckRegistry.js";

// The injected read outcomes this bridge accepts (anything else -> unavailable, fail-closed).
export const REGISTRY_READ_STATUS = Object.freeze(["ready", "loading", "denied", "error", "unavailable"]);

function docPairs(list) {
  return Array.isArray(list)
    ? list.filter((p) => p && typeof p === "object" && typeof p.docId === "string" && p.docId.trim() !== "")
    : [];
}

// Build truckId -> its validated MOBILE Location value, so the bridge can mark trucks whose
// location is inactive. composeTruckFleet (merged) is the authority for WHICH trucks appear
// (1:1 enforced) but does not expose the location's `active` flag, so this bridge re-derives
// the per-truck location to annotate active/inactive -- without changing that contract.
function truckLocationMap(mobileLocationDocs, truckDocs) {
  const locationById = new Map();
  for (const { docId, data } of docPairs(mobileLocationDocs)) {
    const r = validateMobileLocation(docId, data);
    if (r.valid) locationById.set(r.value.locationId, r.value);
  }
  const byTruck = new Map();
  for (const { docId, data } of docPairs(truckDocs)) {
    const locId = data && typeof data === "object" && typeof data.locationId === "string" ? data.locationId : undefined;
    const mobileLocation = locId !== undefined ? locationById.get(locId) : undefined;
    const r = validateTruckRecord(docId, data, { mobileLocation });
    if (r.valid) byTruck.set(r.value.truckId, mobileLocation);
  }
  return byTruck;
}

// Build the EI-P1d-1 TruckInventorySource { connected, status, accessVersion, trucks, options }
// from an injected registry read. Fail-closed on every axis.
export function buildTruckInventorySourceFromRegistry({ status, mobileLocationDocs = [], truckDocs = [], accessVersion, resolveDriverName, equipmentConditionOptions = [] } = {}) {
  const s = REGISTRY_READ_STATUS.includes(status) ? status : "unavailable";

  if (s !== "ready") {
    // Sanitized, inert states -- never a payload or a raw error object/message.
    return { connected: false, status: s, accessVersion, trucks: [] };
  }

  // READY: compose via the merged registry composer (1:1 invariant enforced there), then
  // annotate trucks whose MOBILE Location is inactive (kept visible, clearly marked).
  const fleet = composeTruckFleet({ mobileLocations: mobileLocationDocs, trucks: truckDocs, resolveDriverName, equipmentConditionOptions });
  const byTruck = truckLocationMap(mobileLocationDocs, truckDocs);
  const trucks = fleet.trucks.map((row) => {
    const loc = byTruck.get(row.id);
    const active = !(loc && loc.active === false);
    return { ...row, locationActive: active, location: active ? row.location : `${row.location} · Inactive` };
  });

  return { connected: true, status: "ready", accessVersion, trucks, options: fleet.options };
}
