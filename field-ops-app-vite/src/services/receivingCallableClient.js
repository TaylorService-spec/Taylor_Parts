// EI Receiving -- the ISOLATED, UNWIRED, readiness-false transport client over the two frozen
// E1 callables (receiveInventoryStock, listReceivingLocationOptions). It has NO production
// caller and no UI/route/modal wiring. Structure mirrors services/truckRegistryCommandClient.js
// + services/completionService.js: all shape/validation/mapping lives in the PURE domain
// (domain/receivingTransport.js) and options pass through the merged
// domain/receivingLocationOptionAdapter.js; this file only performs the httpsCallable transport.
//
// GOVERNED ACTIVATION BOUNDARY: the production-facing public methods take NO readiness override
// and NO injectable invoker -- they consult ONLY RECEIVING_TRANSPORT_READY through the production
// resolver (no argument), so no caller, preview path, or extra option can invoke the callables
// while readiness is false. Activation REQUIRES flipping the governed readiness constant (a
// separate authorized gate), never a runtime flag. The invocation logic lives in the *Core
// functions, exposed ONLY via `__test__` so the ready branch can be exercised in tests without a
// production-selectable seam.
//
// FAIL CLOSED: while readiness is false the callables are never invoked (firebase is never even
// loaded). A malformed request is rejected client-side WITHOUT invoking. A malformed response, an
// unknown/frozen error code, or any raw backend detail collapses to a bounded sanitized
// RECEIVING_OUTCOME status -- never a raw message/path/details. The idempotencyKey is carried
// through the request VERBATIM (never regenerated), so a retry (re-invocation with the same
// request) reuses the same key.
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
// test-safe. Never runs while readiness is false.
async function defaultInvoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

// ---- invocation cores (NO readiness gate; test-only seam via __test__) ----
// These perform the actual transport + validation + mapping. They are NOT part of the
// production-facing API; the readiness boundary is applied only by the public exports below.

async function fetchOptionsCore(invoke) {
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

async function submitReceiveCore(request, invoke) {
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

// ---- production-facing public API ----
// No parameters that could select the invoker or override readiness. Consults ONLY the governed
// constant; while readiness is false, returns a sanitized unavailable outcome and NEVER invokes.

// Fetch + adapt the eligible receiving-location options.
export async function fetchReceivingLocationOptions() {
  if (!resolveReceivingTransportReady()) return { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
  return fetchOptionsCore(defaultInvoke);
}

// Submit a receipt. `request` must already carry a stable idempotencyKey; it is preserved
// verbatim and never regenerated (a retry re-invokes with the same request/key).
export async function submitReceiveInventoryStock(request) {
  if (!resolveReceivingTransportReady()) return { status: RECEIVING_OUTCOME.UNAVAILABLE };
  return submitReceiveCore(request, defaultInvoke);
}

// Exposed ONLY for tests -- the un-gated invocation cores. Production callers cannot reach the
// callables through these (they import the public exports above, which are readiness-gated).
export const __test__ = Object.freeze({ fetchOptionsCore, submitReceiveCore });
