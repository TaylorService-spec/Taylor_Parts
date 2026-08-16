// Manufacturer -- read-only client service for the Manufacturer admin workspace
// (modules/inventory/Manufacturers.jsx).
//
// Part 11 reconciliation (2026-08-15): this used to read the `manufacturers` collection
// DIRECTLY over the client SDK, which is Rules-closed (`allow read, write: if false`) --
// so the read ALWAYS failed with permission-denied, independent of who was signed in or
// what they were authorized to do. That blocker predates the governed Manufacturer catalog
// read (`getManufacturerCatalog`, functions/src/partMaster/manufacturerReadService.ts,
// capability `inventory.catalog.read`) landing for the Parts picker surfaces. Revalidated,
// not stale: that governed read now also carries the `version` field this admin workspace's
// write commands need for optimistic concurrency (added in the same reconciliation), so it
// is sufficient here too -- no second capability, no broadened Rules, no parallel read path.
// Firestore Rules on `manufacturers` remain deny-all; this file makes NO client-direct
// Firestore call at all, read or write.
import { fetchManufacturerCatalog } from "./manufacturerReadCallableClient.js";

/** Resolves { ok:true, manufacturers, invalidCount } or { ok:false, code } where code is
 * "permission-denied" (ungranted/deactivated in this environment) or "unavailable"
 * (transient/internal). `invalidCount` is the trusted read's own honest excludedCount --
 * malformed records are never fabricated into fake rows, only counted. */
export async function fetchManufacturerList() {
  const { result, errorStatus } = await fetchManufacturerCatalog();
  if (errorStatus) {
    return { ok: false, code: errorStatus === "denied" ? "permission-denied" : "unavailable" };
  }
  if (!result || result.status !== "ready" || !Array.isArray(result.manufacturers)) {
    return { ok: false, code: "unavailable" };
  }
  const invalidCount = Number.isInteger(result.excludedCount) ? result.excludedCount : 0;
  return { ok: true, manufacturers: result.manufacturers, invalidCount };
}
