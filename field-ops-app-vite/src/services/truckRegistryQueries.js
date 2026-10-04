// TRUCK REGISTRY READS -- from PostgreSQL through the EOS operations transport (Controller TRUCK INVENTORY ACTIVATION,
// 2026-10-01, Package I). Replaces the client-direct Firestore reads of `trucks`, `mobile_locations` and `employees`.
//
//   listTruckRoster {}                   the trucks this person may see: the tenant roster for warehouse readers,
//                                        dispatchers and registry administrators; only their own scoped trucks for a
//                                        Technician (decided by the SERVER, never here)
//   readTruckStock  { mobileLocationId } one truck's stock -- quantities from the movement ledger and serialized units --
//                                        reachable through the caller's MOBILE scope or warehouse scope; NOT_FOUND otherwise
//
// The answer is adapted into the registry's existing { docId, data } pairs so the workspace's validators and composer
// keep one code path. There is NO driver field any more (OD-T1): who works from a truck is an Employee's MOBILE scope.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";

const INVENTORY = EOS_OPERATIONS_ROUTES.INVENTORY;
const OPTS = Object.freeze({ serviceLabel: "the truck inventory service" });

/** The registry pairs for the workspace, from one roster read, plus each reachable truck's stock (keyed by truck id). */
export async function fetchTruckRegistry(call = eosOperationOrThrow) {
  const roster = await call(INVENTORY, "listTruckRoster", {}, OPTS);
  const trucks = Array.isArray(roster?.trucks) ? roster.trucks : [];
  const mobileLocationDocs = [];
  const truckDocs = [];
  for (const t of trucks) {
    if (!t?.mobileLocation?.locationId) continue; // an unlinked truck has no stock location to show
    const loc = t.mobileLocation;
    mobileLocationDocs.push({ docId: loc.locationId, data: { type: "MOBILE", locationId: loc.locationId, displayLabel: loc.displayLabel ?? loc.locationId, active: loc.active === true } });
    truckDocs.push({ docId: t.truckId, data: { truckId: t.truckId, locationId: loc.locationId, vehicleNumber: t.vehicleNumber, displayLabel: t.displayLabel,
      status: t.status, homeWarehouseId: t.homeWarehouseId, assignedDriverEmployeeId: null,
      // #210: who works from this truck NOW = the Employees whose governed MOBILE scope is this truck's location (OD-T1).
      scopedTechnicianNames: Array.isArray(t.scopedEmployeeNames) ? t.scopedEmployeeNames : [] } });
  }
  const stockByTruck = new Map();
  await Promise.all(trucks.filter((t) => t?.mobileLocation?.locationId).map(async (t) => {
    try {
      const s = await call(INVENTORY, "readTruckStock", { mobileLocationId: t.mobileLocation.locationId }, OPTS);
      stockByTruck.set(t.truckId, {
        parts: (s?.quantities ?? []).map((q) => ({ internalSku: q.partId, onHand: q.onHand, available: q.onHand })),
        serializedEquipment: (s?.serializedUnits ?? []).map((u) => ({ assetId: `${u.partId}/${u.serialNumber}`, internalSku: u.partId, serial: u.serialNumber,
          status: u.status, currentLocation: t.mobileLocation.displayLabel ?? t.mobileLocation.locationId })),
      });
    } catch (err) {
      if (err?.category !== "NOT_FOUND" && err?.code !== "NOT_FOUND") throw err; // not reachable by this person: no stock shown
    }
  }));
  return { mobileLocationDocs, truckDocs, stockByTruck };
}
