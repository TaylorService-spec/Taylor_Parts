// EI Truck Registry -- the SINGLE, explicit write-readiness seam for the Truck
// Management UI. Readiness is declared PER ENVIRONMENT in config/environments.json,
// not by one global constant.
//
// PRODUCTION READINESS IS UNVERIFIED, SO IT FAILS CLOSED (Owner ruling 2026-08-17).
// This header previously asserted the eight trusted callables were "DEPLOYED and
// production-verified (Gate D CLOSED, us-central1)". That claim cannot be
// substantiated from this repository: no production-scoped deployment record exists
// under docs/releases, the only Functions closeout is explicitly scoped to
// eos-platform-sandbox and states production was never targeted, and "Gate D" appears
// nowhere else in the repository. Meanwhile functions/src/index.ts -- the newer of the
// two sources -- states these callables are not deployed to the live project.
//
// Read the distinction precisely, because it matters for what happens next: this does
// NOT establish that the callables are absent from production. It establishes that
// their presence is UNVERIFIED. A production write-readiness flag must not assert
// readiness it cannot evidence, so the repository declaration now fails closed until an
// authorized operator verifies the live environment.
//
// THIS REPOSITORY CHANGE DOES NOT FIX A LIVE RISK. Readiness is a compile-time
// constant baked into a Hosting bundle. If a previously released production bundle
// carries the old `true`, production users may still see enabled truck-management
// write controls right now, and only a Hosting release of a bundle built from this
// change would alter that. The live exposure is tracked as a protected verification
// item, not closed by this commit.
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
