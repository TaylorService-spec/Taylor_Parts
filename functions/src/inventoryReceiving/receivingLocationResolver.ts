// Receiving Location Authority -- I-LA5: the concrete production `resolveLocationActive` resolver for the
// unexported receiveInventoryStock command. Reads warehouses/{locationId} THROUGH the command's Firestore
// transaction and returns true IFF the location is a fully governed, status===ACTIVE WAREHOUSE, per the
// merged §3A validator. Never throws for data reasons and never leaks raw details -- it returns a plain
// boolean; the command maps false -> DESTINATION_INVALID. Because the read is in the command's transaction,
// a concurrent warehouse ACTIVE->INACTIVE transition conflicts the command's commit, forcing a retry that
// re-reads INACTIVE and fails closed (no stale receipt). INERT: not exported from index.ts.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { validateGovernedWarehouse } from "../warehouseGovernance/governedWarehouseValidation.js";

function isPlainObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }

// A value is safe to use as a SINGLE top-level Firestore document-ID segment (warehouses/{locationId})
// iff it is a non-blank string that contains no "/" (path traversal / nested addressing), is not "." or
// "..", is not a reserved "__…__" id, and is within Firestore's 1500-byte id limit. This binds the
// resolver to the exact warehouses/{locationId} authority and rejects slash/path-invalid identities
// BEFORE any Firestore reference is constructed or read.
const MAX_DOC_ID_BYTES = 1500;
export function isSafeDocumentIdSegment(id: unknown): id is string {
  if (typeof id !== "string" || id.trim() === "") return false;
  if (id.includes("/")) return false;
  if (id === "." || id === "..") return false;
  if (/^__.*__$/.test(id)) return false;
  if (Buffer.byteLength(id, "utf8") > MAX_DOC_ID_BYTES) return false;
  return true;
}

// Factory: bind the resolver to a Firestore instance. The returned function reads through the injected txn.
export function makeResolveWarehouseLocationActive(db: Firestore): (txn: Transaction, location: { type: string; locationId: string }) => Promise<boolean> {
  return async function resolveLocationActive(txn: Transaction, location: { type: string; locationId: string }): Promise<boolean> {
    // First slice: WAREHOUSE only. Non-WAREHOUSE types, and locationIds that are not a valid single,
    // path-safe warehouses/{locationId} document-ID segment (slash/traversal/reserved/oversized), fail
    // closed BEFORE any Firestore reference is constructed.
    if (!isPlainObject(location) || location.type !== "WAREHOUSE" || !isSafeDocumentIdSegment(location.locationId)) return false;
    const snap = await txn.get(db.collection(WAREHOUSES_COLLECTION).doc(location.locationId));
    if (!snap.exists) return false;
    // The complete stored document must pass the shared §3A validator (bound to the doc id) -- this
    // rejects id mismatch, lingering `active`, missing/partial version/updated/provenance metadata, and
    // malformed records -- AND the governed status must be exactly ACTIVE.
    const parsed = validateGovernedWarehouse(snap.data(), location.locationId);
    if (!parsed.valid) return false;
    return parsed.value.status === "ACTIVE";
  };
}
