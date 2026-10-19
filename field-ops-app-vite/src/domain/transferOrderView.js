// Enterprise Inventory -- the pure Transfer Order ADAPTER (EOS shape only).
//
// PURE and DETERMINISTIC: no Firebase, no persistence, no writes, no UI. It maps ONE governed EOS transfer item (as
// services/transferCommandClient.js toTransferOrderDoc presents it: { docId, data } with origin/destination Location
// refs) into the EI-P1b-2 transferRef { transferOrderId, partId, origin, destination, status }, fail-closed.
// Node-importable and unit-tested directly (test/transferOrderView.test.mjs).
//
// Firebase exit (Owner: main is EOS-only, 2026-10-19): the Firestore-era legacy warehouse-only shape
// (fromWarehouseId / toWarehouseId) is no longer read by any build and is not accepted here.
//
//   * `docId` (the EOS transferOrderId) is the ONLY source of transferOrderId; a stored `id` that conflicts fails closed.
//   * Only the five transferRef fields are produced; quantity, timestamps, trackingMode and serials are ignored.
import { validateLocationRef } from "./inventoryLocation.js";
import { validateTransferRef, TRANSFER_ORDER_STATUSES } from "./inventoryTransferPairing.js";

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fail(reason) {
  return { valid: false, value: null, reason };
}

// Map one EOS transfer item to the EI-P1b-2 transferRef. Returns { valid, value, reason }.
export function toTransferRef(docId, data) {
  if (!isNonEmptyString(docId)) return fail("doc_id_invalid");
  if (!isPlainObject(data)) return fail("not_object");
  if (data.id !== undefined && data.id !== docId) return fail("stored_id_conflict");
  if (!isNonEmptyString(data.partId)) return fail("part_id_invalid");
  if (!TRANSFER_ORDER_STATUSES.includes(data.status)) return fail("status_invalid");
  if (data.origin === undefined && data.destination === undefined) return fail("endpoints_missing");
  const o = validateLocationRef(data.origin);
  if (!o.valid) return fail("origin_invalid");
  const d = validateLocationRef(data.destination);
  if (!d.valid) return fail("destination_invalid");
  // Final compatibility gate: non-VIRTUAL, distinct endpoints, canonical status, non-empty ids.
  const ref = validateTransferRef({ transferOrderId: docId, partId: data.partId, origin: o.value, destination: d.value, status: data.status });
  if (!ref.valid) return fail(ref.reason);
  return { valid: true, value: ref.value, reason: null };
}

export function isTransferRefRecord(docId, data) {
  return toTransferRef(docId, data).valid;
}
