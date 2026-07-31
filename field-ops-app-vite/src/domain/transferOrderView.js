// Enterprise Inventory -- EI-P1c-1 pure Transfer Order ADAPTER.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no writes, no Rules, no
// UI. It maps ONE raw transfer_orders document (legacy warehouse-only OR additively
// generalized with Location refs) into the exact EI-P1b-2 transferRef
// { transferOrderId, partId, origin, destination, status }, fail-closed. Node-importable
// and unit-tested directly (test/transferOrderView.test.mjs). Mirrors the EI-P1a / EI-P1b
// pure-contract precedent and the codebase's read-adapter pattern (partDetailView.js).
//
// GOVERNANCE (authorized EI-P1c-1 decisions):
//   * Additive generalized Location refs with legacy compatibility; no parallel collection.
//   * SERIAL transfer-line membership is a LATER gate -- not read or produced here.
//   * trackingMode is Part authority -- never stored on, derived from, or copied out of a
//     transfer order. This adapter neither reads nor emits it.
//   * The authoritative Firestore document ID is passed separately and is the ONLY source
//     of transferOrderId; a stored `id` that conflicts fails closed (never trusted).
//   * Only the five transferRef fields are produced; quantity, timestamps, trackingMode,
//     serial membership, labels, and any other stored authority are ignored (never copied).
//
// BOUNDARIES: no UI, writes, transfer lines, persistence, Firestore, Rules, indexes,
// Functions, capability changes, migration, or deployment.
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

// A Location identity is the WHOLE {type, locationId} reference (EI-P1b-1/-2 convention).
function sameLocation(a, b) {
  return a.type === b.type && a.locationId === b.locationId;
}

function fail(reason) {
  return { valid: false, value: null, reason };
}

// Map a raw transfer_orders record to the EI-P1b-2 transferRef. `docId` is the
// authoritative Firestore document ID (never the stored `id`). Returns { valid, value,
// reason }; value is the normalized transferRef on success.
export function toTransferRef(docId, data) {
  if (!isNonEmptyString(docId)) return fail("doc_id_invalid");
  if (!isPlainObject(data)) return fail("not_object");
  // Never trust a stored id: a present-but-different id is a conflict.
  if (data.id !== undefined && data.id !== docId) return fail("stored_id_conflict");
  if (!isNonEmptyString(data.partId)) return fail("part_id_invalid");
  if (!TRANSFER_ORDER_STATUSES.includes(data.status)) return fail("status_invalid");

  // Resolve endpoints from whichever representation(s) are present. A raw document may
  // legitimately also carry quantity/timestamps/other fields -- those are ignored.
  const generalizedPresent = data.origin !== undefined || data.destination !== undefined;
  const legacyPresent = data.fromWarehouseId !== undefined || data.toWarehouseId !== undefined;
  if (!generalizedPresent && !legacyPresent) return fail("endpoints_missing");

  let genOrigin = null;
  let genDestination = null;
  if (generalizedPresent) {
    const o = validateLocationRef(data.origin);
    if (!o.valid) return fail("origin_invalid");
    const d = validateLocationRef(data.destination);
    if (!d.valid) return fail("destination_invalid");
    genOrigin = o.value;
    genDestination = d.value;
  }

  let legOrigin = null;
  let legDestination = null;
  if (legacyPresent) {
    const o = isNonEmptyString(data.fromWarehouseId)
      ? validateLocationRef({ type: "WAREHOUSE", locationId: data.fromWarehouseId })
      : { valid: false };
    if (!o.valid) return fail("origin_invalid");
    const d = isNonEmptyString(data.toWarehouseId)
      ? validateLocationRef({ type: "WAREHOUSE", locationId: data.toWarehouseId })
      : { valid: false };
    if (!d.valid) return fail("destination_invalid");
    legOrigin = o.value;
    legDestination = d.value;
  }

  // If both representations exist they must agree exactly, endpoint by endpoint.
  if (generalizedPresent && legacyPresent) {
    if (!sameLocation(genOrigin, legOrigin) || !sameLocation(genDestination, legDestination)) {
      return fail("endpoint_disagreement");
    }
  }

  const origin = generalizedPresent ? genOrigin : legOrigin;
  const destination = generalizedPresent ? genDestination : legDestination;

  // Final compatibility gate: the produced transferRef must satisfy the EI-P1b-2 contract
  // (non-VIRTUAL, distinct endpoints, canonical status, non-empty ids). Its reason is
  // surfaced directly so a rejected endpoint (e.g. VIRTUAL/same) fails closed here too.
  const ref = validateTransferRef({ transferOrderId: docId, partId: data.partId, origin, destination, status: data.status });
  if (!ref.valid) return fail(ref.reason);
  return { valid: true, value: ref.value, reason: null };
}

export function isTransferRefRecord(docId, data) {
  return toTransferRef(docId, data).valid;
}
