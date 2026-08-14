// EI Truck Registry -- the SINGLE, explicit write-readiness seam for the Truck
// Management UI. The eight trusted callables (truckRegistryCommandClient.js) are now
// DEPLOYED and production-verified (Gate D CLOSED, us-central1), so this seam is
// ACTIVATED (Gate E1):
//
//   TRUCK_MANAGEMENT_WRITE_READY = true
//
// While readiness is true, an admin/dispatcher's management controls are enabled and
// useTruckManagement invokes the deployed callables (authorization is re-enforced
// server-side; deactivateTruckCallable stays governed by its fail-closed backend
// outcome until the real inventory predicate ships). This is a compile-time constant,
// NOT a runtime probe: the code never tries to reach Functions to guess whether they
// are deployed. Flipping this single constant is what activates the UI writes; the
// change reaches production only when a Hosting release serves this bundle (Gate E3).
//
// `resolveWriteReadiness` exists so tests and the test-only visual preview can inject
// an explicit readiness value (with a MOCKED callable client) without depending on this
// constant -- an explicit override, never an ambient/global mutation. An explicit
// `false` override still fails closed (zero callable attempts).
// O-3 — resolved from the one environment registry; see receivingReadiness.js
// for the classification rationale. Fails closed on an absent flag.
export const TRUCK_MANAGEMENT_WRITE_READY = __APP_READINESS__.TRUCK_MANAGEMENT_WRITE_READY;

// Round-4 site-work gate (Items 1 & 2, docs/orchestration/site-work/round4-special-track-proposals.md):
// deactivateTruck and deleteTruckCreatedInError are guaranteed to fail on every call in
// production today (no governed inventory-presence probe / no governed 11-authority
// operational-reference persistence exists yet), yet both controls previously shipped
// enabled behind only the broad TRUCK_MANAGEMENT_WRITE_READY flag. These two DEDICATED
// flags gate just those two destructive controls, independent of the broader seam above.
// Default false in every environment until each control's real backend predicate can
// plausibly succeed; an absent flag resolves to false (fail closed), never enabled.
export const TRUCK_DEACTIVATE_READY = __APP_READINESS__.TRUCK_DEACTIVATE_READY === true;
export const TRUCK_DELETE_READY = __APP_READINESS__.TRUCK_DELETE_READY === true;

// Returns the effective write-readiness. With no override, this is the fail-closed
// production constant above. An explicit boolean override (tests / preview only)
// wins; anything else falls back to the constant.
export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : TRUCK_MANAGEMENT_WRITE_READY;
}

// Same override pattern as resolveWriteReadiness, for the two dedicated destructive-
// control flags. Tests may inject an explicit boolean; anything else falls back to the
// fail-closed registry-resolved constant.
export function resolveDeactivateReady(override) {
  return typeof override === "boolean" ? override : TRUCK_DEACTIVATE_READY;
}

export function resolveDeleteReady(override) {
  return typeof override === "boolean" ? override : TRUCK_DELETE_READY;
}
