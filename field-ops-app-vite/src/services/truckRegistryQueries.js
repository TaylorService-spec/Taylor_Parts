// EI-P1d-2-2b -- client-direct, one-shot reads (getDocs, not onSnapshot) for the Truck
// Registry: the `trucks` and `mobile_locations` collections. Same precedent as
// services/operationsQueries.js and hooks/useInstalledEquipmentPage.js's bounded name reads.
//
// These are governed backend collections: firestore.rules grants admin/dispatcher READ and
// denies ALL client create/update/delete (writes are a separately-gated trusted-Function
// concern). This file never writes; it only reads what an admin/dispatcher is allowed to see,
// and returns { docId, data } pairs so the authoritative Firestore id stays SEPARATE from the
// stored data (the registry contract fails closed on a stored-id conflict) -- exactly the
// shape services/operationsQueries.js's fetchTransferOrderDocs uses.
import { collection, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EMPLOYEES_COLLECTION } from "../domain/constants";
import { collectDriverEmployeeIds } from "../domain/truckRegistryDrivers.js";

export const TRUCKS_COLLECTION = "trucks";
export const MOBILE_LOCATIONS_COLLECTION = "mobile_locations";

// Firestore `in` supports at most 10 values -> resolve driver names in bounded batches.
const NAME_BATCH = 10;

// --- Read shapes (documented; validated downstream by domain/truckRegistry.js) ---
//
// A `mobile_locations/{locationId}` document (docId IS the inventory locationId):
//   { locationId: string, type: "MOBILE", displayLabel?: string, active?: boolean }
// A `trucks/{truckId}` document (docId IS the business truckId):
//   { truckId: string, locationId: string, vehicleNumber?: string, displayLabel?: string,
//     status?: "ACTIVE"|"IDLE"|"OUT_OF_SERVICE", homeWarehouseId: string,
//     assignedDriverEmployeeId?: string|null }
// Both are returned as { docId, data } so nothing trusts a stored id over the document id.
/** @typedef {{ docId: string, data: Record<string, unknown> }} RegistryDoc */

/** @returns {Promise<RegistryDoc[]>} one-shot read of every mobile_locations doc. */
export async function fetchMobileLocationDocs() {
  const snap = await getDocs(collection(db, MOBILE_LOCATIONS_COLLECTION));
  return snap.docs.map((d) => ({ docId: d.id, data: d.data() }));
}

/** @returns {Promise<RegistryDoc[]>} one-shot read of every trucks doc. */
export async function fetchTruckDocs() {
  const snap = await getDocs(collection(db, TRUCKS_COLLECTION));
  return snap.docs.map((d) => ({ docId: d.id, data: d.data() }));
}

// Resolve Employee display names for ONLY the driver ids the given trucks reference, in
// bounded batches -> NO N+1 (one batched pass over a de-duplicated id set, never one read per
// truck). Reads employees/{employeeId} by documentId -- the same unfiltered admin/dispatcher
// directory read hooks/useEmployeeDirectory already relies on (no new permission, no index).
// Returns a Map<employeeId, displayName>; an id with no readable/named Employee simply has no
// entry, and the registry-source resolver maps that to a null driver (never a raw id).
export async function fetchDriverNames(truckDocs) {
  const ids = collectDriverEmployeeIds(truckDocs);
  const map = new Map();
  for (let i = 0; i < ids.length; i += NAME_BATCH) {
    const batch = ids.slice(i, i + NAME_BATCH);
    if (batch.length === 0) continue;
    const snap = await getDocs(query(collection(db, EMPLOYEES_COLLECTION), where(documentId(), "in", batch)));
    snap.docs.forEach((d) => {
      const name = d.data()?.displayName;
      if (typeof name === "string" && name.trim() !== "") map.set(d.id, name);
    });
  }
  return map;
}
