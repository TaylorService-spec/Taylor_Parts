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
export const TRUCK_MANAGEMENT_WRITE_READY = true;

// Returns the effective write-readiness. With no override, this is the fail-closed
// production constant above. An explicit boolean override (tests / preview only)
// wins; anything else falls back to the constant.
export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : TRUCK_MANAGEMENT_WRITE_READY;
}
