// Shared inventory-balance read — the readiness-gated transport over the one governed callable.
// Structure mirrors services/partAliasCallableClient.js.
//
// GOVERNED ACTIVATION BOUNDARY. This module exports one public method. It takes NO readiness
// override and NO injectable invoker, and reads ONLY the governed INVENTORY_BALANCE_READ_READY
// constant. There is no production-importable un-gated seam.
//
// FAIL CLOSED. While readiness is false the callable is never invoked and firebase is never even
// loaded. The method returns the same shaped result either way, so callers have one code path.
//
// Never throws. Returns { result } on success or { errorStatus, errorDetail } on failure.
import { INVENTORY_BALANCE_READ_READY } from "../config/inventoryBalanceReadiness.js";

export const BALANCE_CALLABLE_NAME = "getPartBalance";

/** The status returned when the transport is switched off — its OWN status, never a denial. */
export const BALANCE_NOT_READY_STATUS = "transport-not-ready";

function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code || "internal";
}

/**
 * Read the governed balance for one Part.
 *
 * `serialTracked` is passed from the Part record the caller already read under its own authority —
 * the service uses it to decide whether a summed quantity is even the right question, and asking
 * the caller avoids a second Part read on the server for a fact the client already holds.
 */
export async function fetchPartBalance({ partId, serialTracked = false }) {
  if (!INVENTORY_BALANCE_READ_READY) {
    return { errorStatus: BALANCE_NOT_READY_STATUS, errorDetail: null };
  }
  try {
    const [{ httpsCallable }, { functions }] = await Promise.all([
      import("firebase/functions"),
      import("../firebase/firebase.js"),
    ]);
    const res = await httpsCallable(functions, BALANCE_CALLABLE_NAME)({ partId, serialTracked });
    return { result: res?.data };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err), errorDetail: null };
  }
}
