// ════════════════════ FIREBASE EXIT B3: WHICH SOURCE ANSWERS, DECIDED ONCE AT BUILD TIME ════════════════════
//
// The four public functions at the bottom of this file are EITHER the Firebase callable transport below (production, and any build that
// declares no EOS API -- unchanged, still behind RECEIVING_TRANSPORT_READY) OR the EOS supplier-PO receiving client
// (services/eosSupplierReceivingClient.js), chosen by the F1 compile-time flag (access/eosSessionSource.js). There is NO runtime fallback in
// either direction: where an EOS API is declared the Firebase callables are never imported, so the build makes no Firebase request.
//
// ════════════════════ REORDER PURCHASE ORDER RECEIPTS DO NOT GO THROUGH THIS FILE ════════════════════
//
// The legacy single-line submit (`submitReceiveInventoryStock`, source REORDER_PURCHASE_ORDER) is GONE from
// this module. A Reorder Purchase Order is received through the governed PostgreSQL authority
// (services/reorderReceivingClient.js -> receiveReorderStock on /operations/inventory). The Firebase
// `receiveInventoryStock` deployed in nonprod pre-dates the Reorder freeze and would write the Firestore
// Reorder Request to RECEIVED while PostgreSQL stays ORDERED, so no client path may send it that source.
// What remains here is the canonical multi-line PURCHASE_ORDER journey (its own authority and cutover,
// unchanged; buildCanonicalReceiveRequest refuses any other source type client-side) and the receiving
// location options read.
//
// EI Receiving -- the ISOLATED, UNWIRED, readiness-false transport client over the two frozen
// E1 callables (receiveInventoryStock, listReceivingLocationOptions). It has NO production
// caller and no UI/route/modal wiring. Structure mirrors services/truckRegistryCommandClient.js
// + services/completionService.js: all shape/validation/mapping lives in the PURE domain
// (domain/receivingTransport.js) and options pass through the merged
// domain/receivingLocationOptionAdapter.js; this file only performs the httpsCallable transport.
//
// GOVERNED ACTIVATION BOUNDARY: this module exports ONLY the two public methods, which take NO
// readiness override and NO injectable invoker and read ONLY the governed RECEIVING_TRANSPORT_READY
// constant. There is NO production-importable un-gated seam (the invocation cores are private,
// non-exported functions). So no caller, preview path, or extra option can invoke the callables
// while readiness is false. Activation REQUIRES flipping the governed readiness constant (a
// separate authorized gate), never a runtime flag. Tests exercise the ready branch via build-time
// module mocking of the readiness + firebase modules -- never a production-importable bypass.
//
// FAIL CLOSED: while readiness is false the callables are never invoked (firebase is never even
// loaded). A malformed request is rejected client-side WITHOUT invoking. A malformed response, an
// unknown/frozen error code, or any raw backend detail collapses to a bounded sanitized
// RECEIVING_OUTCOME status -- never a raw message/path/details. The idempotencyKey is carried
// through the request VERBATIM (never regenerated), so a retry (re-invocation with the same
// request) reuses the same key.
import { RECEIVING_TRANSPORT_READY } from "../config/receivingReadiness.js";
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";
import { supplierReceivingClient } from "./eosSupplierReceivingClient.js";
import { adaptReceivingLocationOptions } from "../domain/receivingLocationOptionAdapter.js";
import {
  CALLABLE_NAMES,
  buildCanonicalReceiveRequest,
  validateCanonicalReceiveResponse,
  validatePurchaseOrderProgress,
  RECEIVING_OUTCOME,
  OPTIONS_REQUEST,
  validateOptionsResponse,
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

// ---- private invocation cores (NO readiness gate, NOT exported) ----
// These perform the actual transport + validation + mapping. They are module-private (never
// exported), so there is no production-importable un-gated seam; the readiness boundary is applied
// only by the public exports below.

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

// ---- production-facing public API ----
// No parameters that could select the invoker or override readiness. Consults ONLY the governed
// constant; while readiness is false, returns a sanitized unavailable outcome and NEVER invokes.

// Fetch + adapt the eligible receiving-location options.
async function firebaseFetchReceivingLocationOptions() {
  if (!RECEIVING_TRANSPORT_READY) return { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
  return fetchOptionsCore(defaultInvoke);
}

// ═══════════════════════ CANONICAL MULTI-LINE RECEIVING (Phase D) ═══════════════════════
//
// Three additional methods, all behind the SAME governed RECEIVING_TRANSPORT_READY constant and the
// same private invoker. No new readiness flag, no new override seam, and no parameter that could
// select the invoker — while readiness is false these make ZERO callable attempts, exactly as the
// legacy pair do.
//
// The two reads exist because remaining quantity cannot be derived in a browser: `purchase_orders` is
// client-readable but `receiving_orders` is deny-all by design.

// List the canonical purchase orders that may currently be received.
async function firebaseFetchReceivablePurchaseOrders() {
  if (!RECEIVING_TRANSPORT_READY) return { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] };
  try {
    const data = await defaultInvoke(CALLABLE_NAMES.listReceivable, {});
    const list = Array.isArray(data?.purchaseOrders) ? data.purchaseOrders : null;
    // A malformed response is UNAVAILABLE, never a partially-trusted list. An empty list is a
    // legitimate answer and is NOT the same thing.
    if (list === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] };
    return { status: RECEIVING_OUTCOME.READY, purchaseOrders: list };
  } catch (err) {
    return { status: mapCallableErrorToStatus(err), purchaseOrders: [] };
  }
}

// One purchase order's ordered lines plus SERVER-DERIVED remaining quantities. This is what the scan
// queue reconciles against; without it the surface could show what was ordered and never what is
// outstanding.
async function firebaseFetchPurchaseOrderProgress(purchaseOrderId) {
  if (!RECEIVING_TRANSPORT_READY) return { status: RECEIVING_OUTCOME.UNAVAILABLE, progress: null };
  try {
    const data = await defaultInvoke(CALLABLE_NAMES.progress, { purchaseOrderId });
    const progress = validatePurchaseOrderProgress(data);
    if (progress === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE, progress: null };
    return { status: RECEIVING_OUTCOME.READY, progress };
  } catch (err) {
    return { status: mapCallableErrorToStatus(err), progress: null };
  }
}

// Submit a canonical multi-line receipt. `request` must already carry a stable idempotencyKey; it is
// preserved verbatim and never regenerated, so a retry of the same intent replays rather than
// applying twice.
async function firebaseSubmitCanonicalReceive(request) {
  if (!RECEIVING_TRANSPORT_READY) return { status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null };
  const built = buildCanonicalReceiveRequest(request);
  // Refused CLIENT-SIDE without invoking: a malformed request never reaches the callable.
  if (built === null) return { status: RECEIVING_OUTCOME.INVALID, receipt: null };
  try {
    const data = await defaultInvoke(CALLABLE_NAMES.receive, built);
    const receipt = validateCanonicalReceiveResponse(data);
    if (receipt === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null };
    return { status: receipt.outcome === "replayed" ? RECEIVING_OUTCOME.REPLAYED : RECEIVING_OUTCOME.APPLIED, receipt };
  } catch (err) {
    return { status: mapCallableErrorToStatus(err), receipt: null };
  }
}

// ═══════════════════════ THE PUBLIC API: ONE SOURCE, CHOSEN AT BUILD TIME (B3) ═══════════════════════
//
// `EOS_SESSION_SOURCE` true: EOS is the SOLE source (the Firebase functions above are dead code in that build and are never called -- not as a
// fallback, not on failure, not on an empty answer). false: Firebase, exactly as before B3. The same names, the same result shapes.
export const fetchReceivingLocationOptions = EOS_SESSION_SOURCE ? supplierReceivingClient.fetchReceivingLocationOptions : firebaseFetchReceivingLocationOptions;
export const fetchReceivablePurchaseOrders = EOS_SESSION_SOURCE ? supplierReceivingClient.fetchReceivablePurchaseOrders : firebaseFetchReceivablePurchaseOrders;
export const fetchPurchaseOrderProgress = EOS_SESSION_SOURCE ? supplierReceivingClient.fetchPurchaseOrderProgress : firebaseFetchPurchaseOrderProgress;
export const submitCanonicalReceive = EOS_SESSION_SOURCE ? supplierReceivingClient.submitCanonicalReceive : firebaseSubmitCanonicalReceive;
