// EI Truck Registry -- the SINGLE, explicit write-readiness seam for the Truck
// Management UI (Gate: Truck Management UI). The eight trusted callables
// (truckRegistryCommandClient.js) are EXPORTED from functions/src/index.ts but NOT
// deployed. Until a later, separately-authorized activation gate deploys them and
// verifies the deployment, the production/default posture here is FAIL-CLOSED:
//
//   TRUCK_MANAGEMENT_WRITE_READY = false
//
// While readiness is false the UI renders its management controls for review but
// clearly says "Truck management is not yet enabled," and useTruckManagement invokes
// NO callable (zero attempts). This is a compile-time constant, NOT a runtime probe:
// the code never tries to reach Functions to guess whether they are deployed. The
// future activation gate flips this one constant to true ONLY after deployment
// verification, in its own authorized change.
//
// `resolveWriteReadiness` exists so tests and the test-only visual preview can inject
// readiness=true (with a MOCKED callable client) without touching this production
// default -- an explicit override, never an ambient/global mutation.
export const TRUCK_MANAGEMENT_WRITE_READY = false;

// Returns the effective write-readiness. With no override, this is the fail-closed
// production constant above. An explicit boolean override (tests / preview only)
// wins; anything else falls back to the constant.
export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : TRUCK_MANAGEMENT_WRITE_READY;
}
