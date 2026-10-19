// "WE RECORDED THE RECEIPT WRONG" -- the receipt correction transport (Firebase exit B3-x; DECISIONS #193, #B3-x).
//
//   browser -> THIS -> services/reorderApiClient.js -> POST /operations/inventory
//     Reorder receipt   -> correctReorderReceipt                  { receivingId, correction: VOID | CORRECTED, reason, idempotencyKey, replacement? }
//     Supplier-PO receipt -> correctSupplierPurchaseOrderReceipt  { receivingId, reason, idempotencyKey }           (VOID only)
//
// The two authorities never fall back to each other: the operation is chosen by the receipt's own source kind, and a request the chosen
// authority cannot take is refused HERE, before any call (a supplier receipt has no CORRECTED; a CORRECTED names where it goes). The server
// re-decides everything -- capability (inventory.receipt.correct), company, warehouse scope, "stock still where the receipt put it" -- and its
// own sentence is returned so a screen can say WHY ("only 2 of the 4 received remain..."), never a bare "conflict".
import { callReorderApi } from "./reorderApiClient.js";

export const RECEIPT_CORRECTION_OPERATION = Object.freeze({
  REORDER_PURCHASE_ORDER: "correctReorderReceipt",
  PURCHASE_ORDER: "correctSupplierPurchaseOrderReceipt",
});

export const CORRECTION_KIND = Object.freeze({ VOID: "VOID", CORRECTED: "CORRECTED" });

/** Which corrections a receipt of this source kind can take. Pure. */
export function correctionKindsFor(sourceKind) {
  if (sourceKind === "PURCHASE_ORDER") return [CORRECTION_KIND.VOID];
  if (sourceKind === "REORDER_PURCHASE_ORDER") return [CORRECTION_KIND.VOID, CORRECTION_KIND.CORRECTED];
  return [];
}

/**
 * The call for one correction, or null when the request is not one the receipt's authority can take. Pure.
 * `replacementLocation` is `{ type, locationId }` and is required by (and only accepted for) CORRECTED.
 */
export function buildCorrectionCall({ sourceKind, receivingId, kind, reason, idempotencyKey, replacementLocation = null } = {}) {
  const operation = RECEIPT_CORRECTION_OPERATION[sourceKind];
  if (!operation || !correctionKindsFor(sourceKind).includes(kind)) return null;
  if (typeof receivingId !== "string" || receivingId === "") return null;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500) return null;
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") return null;
  if (sourceKind === "PURCHASE_ORDER") {
    return { operation, input: { receivingId, reason: reason.trim(), idempotencyKey } };
  }
  const base = { receivingId, correction: kind, reason: reason.trim(), idempotencyKey };
  if (kind === CORRECTION_KIND.VOID) return { operation, input: base };
  if (!replacementLocation || typeof replacementLocation.type !== "string" || typeof replacementLocation.locationId !== "string" || replacementLocation.locationId === "") return null;
  return { operation, input: { ...base, replacement: { receivingLocation: { type: replacementLocation.type, locationId: replacementLocation.locationId } } } };
}

const STATUS_BY_CODE = Object.freeze({
  FORBIDDEN: "denied", UNAUTHENTICATED: "unauthenticated", NOT_SIGNED_IN: "unauthenticated", NOT_FOUND: "not_found",
  INVALID_INPUT: "invalid", PRECONDITION_FAILED: "conflict", CONFLICT: "conflict",
});

/** Send one correction. Never throws. `{ ok: true, result }` or `{ ok: false, status, message }` (the server's own sentence when it gave one). */
export async function correctReceipt(request, { call = callReorderApi } = {}) {
  const built = buildCorrectionCall(request);
  if (built === null) return { ok: false, status: "invalid", message: "This correction cannot be sent as stated." };
  let res;
  try {
    res = await call(built.operation, built.input);
  } catch {
    return { ok: false, status: "unavailable", message: "The correction could not be sent. Nothing was changed." };
  }
  if (res?.ok === true) return { ok: true, result: res.result };
  return {
    ok: false,
    status: STATUS_BY_CODE[res?.code] ?? "unavailable",
    message: typeof res?.message === "string" && res.message !== "" ? res.message : "The correction was not accepted. Nothing was changed.",
  };
}
