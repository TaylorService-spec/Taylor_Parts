// EI Receiving -- the ISOLATED, UNWIRED, readiness-false transport client over the two frozen
// E1 callables (receiveInventoryStock, listReceivingLocationOptions). It has NO production
// caller and no UI/route/modal wiring. Structure mirrors services/truckRegistryCommandClient.js
// + services/completionService.js: all shape/validation/mapping lives in the PURE domain
// (domain/receivingTransport.js) and options pass through the merged
// domain/receivingLocationOptionAdapter.js; this file only performs the httpsCallable transport.
//
// FAIL CLOSED: while readiness is false (config/receivingReadiness.js), BOTH methods make ZERO
// callable attempts and return a sanitized unavailable outcome. A malformed request is rejected
// client-side WITHOUT invoking. A malformed response, an unknown/frozen error code, or any raw
// backend detail collapses to a bounded sanitized RECEIVING_OUTCOME status -- never a raw
// message/path/details. The idempotencyKey is carried through the request VERBATIM (never
// regenerated), so a retry (re-invocation with the same request) reuses the same key.
import { resolveReceivingTransportReady } from "../config/receivingReadiness.js";
import { adaptReceivingLocationOptions } from "../domain/receivingLocationOptionAdapter.js";
import {
  CALLABLE_NAMES,
  RECEIVING_OUTCOME,
  OPTIONS_REQUEST,
  buildReceiveRequest,
  validateOptionsResponse,
  validateReceiveResponse,
  mapCallableErrorToStatus,
} from "../domain/receivingTransport.js";

// The default transport invoker. Firebase is imported LAZILY (dynamic import) so this module has
// NO import-time side effect (firebase/firebase.js runs initializeApp on import) and stays
// test-safe; tests inject `invoke` and never reach this. Never runs while readiness is false.
async function defaultInvoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

// Fetch + adapt the eligible receiving-location options.
//   -> { status: READY, options: [...] } on success
//   -> { status: UNAVAILABLE, options: [] } when not ready / malformed envelope / adapter failure
//   -> { status: <mapped> , options: [] } on a frozen callable error
export async function fetchReceivingLocationOptions({ readyOverride, invoke = defaultInvoke } = {}) {
  if (!resolveReceivingTransportReady(readyOverride)) return { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
  let data;
  try {
    data = await invoke(CALLABLE_NAMES.listOptions, OPTIONS_REQUEST); // exact {} request
  } catch (err) {
    return { status: mapCallableErrorToStatus(err), options: [] };
  }
  const rawOptions = validateOptionsResponse(data); // exact { options: [...] } envelope
  if (rawOptions === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
  const adapted = adaptReceivingLocationOptions(rawOptions); // merged shape validator
  if (!adapted.ok) return { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
  return { status: RECEIVING_OUTCOME.READY, options: adapted.options };
}

// Submit a receipt. `request` must already carry a stable idempotencyKey; it is preserved
// verbatim and never regenerated (a retry re-invokes with the same request/key).
//   -> { status: APPLIED|REPLAYED, receipt: { outcome, receivingId, ledgerEventId } } on success
//   -> { status: UNAVAILABLE } when not ready / malformed response
//   -> { status: INVALID } when the client request is malformed (no callable attempt)
//   -> { status: <mapped> } on a frozen callable error
export async function submitReceiveInventoryStock(request, { readyOverride, invoke = defaultInvoke } = {}) {
  if (!resolveReceivingTransportReady(readyOverride)) return { status: RECEIVING_OUTCOME.UNAVAILABLE };
  const payload = buildReceiveRequest(request); // validate + sanitize exact frozen fields
  if (payload === null) return { status: RECEIVING_OUTCOME.INVALID }; // malformed request -> fail closed, no invoke
  let data;
  try {
    data = await invoke(CALLABLE_NAMES.receive, payload);
  } catch (err) {
    return { status: mapCallableErrorToStatus(err) };
  }
  const outcome = validateReceiveResponse(data); // exact envelope, rejects unknown fields
  if (outcome === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE };
  return {
    status: outcome.outcome === "replayed" ? RECEIVING_OUTCOME.REPLAYED : RECEIVING_OUTCOME.APPLIED,
    receipt: outcome,
  };
}
