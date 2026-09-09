// EI-P1d-2-2b -- one-shot reads for the Truck Registry: the `trucks` and `mobile_locations`
// collections, plus the bounded driver-name resolution they need.
//
// GOVERNED, NOT CLIENT-DIRECT. These were `getDocs` calls authorized by firestore.rules'
// admin/dispatcher grant. Firebase authenticates; EOS authorizes -- so they now read governed
// sources that resolve `inventory.truckRegistry.read` server-side, and the client-direct reads are
// denied in Rules. The population is unchanged: that capability is granted to the same shared
// admin+dispatcher base the Rule admitted.
//
// This file never writes. Truck mutations go through their own trusted callables
// (services/truckRegistryCommandClient.js) and are untouched.
//
// THE { docId, data } SHAPE IS DELIBERATE AND PRESERVED. The authoritative Firestore document id
// stays SEPARATE from the stored data so nothing can trust a stored id over the document id -- the
// registry contract fails closed on a stored-id conflict. The governed read returns a flat row with
// `id` authoritative (the projection puts the document id last precisely so a stored `id` cannot
// overwrite it), and this file splits it back apart rather than letting the two merge here.
import { governedCollectionClient } from "../access/governedCollectionClient";
import { collectDriverEmployeeIds } from "../domain/truckRegistryDrivers.js";

export const TRUCKS_COLLECTION = "trucks";
export const MOBILE_LOCATIONS_COLLECTION = "mobile_locations";

// The governed source's declared ceiling for an "in" filter, and Firestore's own limit for the
// query behind it. Was 10; the batching itself is unchanged -- a larger id set is still several
// reads, never one unbounded one.
const NAME_BATCH = 30;

// A registry read is a whole small collection, so it pages to exhaustion rather than taking the
// first page. A truncated registry is not a smaller registry: it is a truck that has silently
// stopped existing, and the caller has no way to tell.
const REGISTRY_PAGE = 200;

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

/**
 * Read one governed source to exhaustion, as { docId, data } pairs.
 *
 * THROWS on a refused or unreachable read, deliberately. Both callers previously propagated a
 * Firestore rejection, and their consumers distinguish a failed registry load from an empty one --
 * returning [] here would report "there are no trucks", which is a statement about the business
 * rather than about the read.
 */
async function readRegistrySource(sourceId) {
  const out = [];
  let cursor = null;
  do {
    const outcome = await governedCollectionClient.readGovernedList({
      sourceId,
      pageSize: REGISTRY_PAGE,
      cursor,
    });
    if (!outcome.ok) {
      const err = new Error(`truck registry read failed (${sourceId})`);
      // The same code shape a Firestore rejection carried, so downstream error handling that
      // switches on `code` keeps working unchanged.
      err.code = outcome.result === "DENIED" ? "permission-denied" : "unavailable";
      throw err;
    }
    for (const row of outcome.items) {
      const { id, ...data } = row;
      out.push({ docId: id, data });
    }
    cursor = outcome.nextCursor;
  } while (cursor);
  return out;
}

/** @returns {Promise<RegistryDoc[]>} every mobile_locations doc. */
export async function fetchMobileLocationDocs() {
  return readRegistrySource("mobileLocations");
}

/** @returns {Promise<RegistryDoc[]>} every trucks doc. */
export async function fetchTruckDocs() {
  return readRegistrySource("truckRegistry");
}

/**
 * Resolve Employee display names for ONLY the driver ids the given trucks reference, in bounded
 * batches -- NO N+1 (one batched pass over a de-duplicated id set, never one read per truck).
 *
 * Reads the same governed workforce directory `useEmployeeDirectory` uses (no new permission).
 * Returns a Map<employeeId, displayName>; an id with no readable or named Employee simply has no
 * entry, and the registry-source resolver maps that to a null driver, never a raw id.
 */
export async function fetchDriverNames(truckDocs) {
  const ids = collectDriverEmployeeIds(truckDocs);
  const map = new Map();
  for (let i = 0; i < ids.length; i += NAME_BATCH) {
    const batch = ids.slice(i, i + NAME_BATCH);
    if (batch.length === 0) continue;
    const outcome = await governedCollectionClient.readGovernedList({
      sourceId: "employeesByIds",
      filters: { ids: batch },
      pageSize: batch.length,
    });
    if (!outcome.ok) {
      const err = new Error("driver name resolution failed");
      err.code = outcome.result === "DENIED" ? "permission-denied" : "unavailable";
      throw err;
    }
    for (const row of outcome.items) {
      const name = row?.displayName;
      if (typeof name === "string" && name.trim() !== "") map.set(row.id, name);
    }
  }
  return map;
}
