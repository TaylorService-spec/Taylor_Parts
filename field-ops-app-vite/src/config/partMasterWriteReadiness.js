// Part Master (ADR-009 G2) -- the SINGLE, explicit write-readiness seam for the Part Master
// administration UI. The three trusted callables (partMasterCommandClient.js) are exported from
// functions/src/index.ts.
//
// Readiness is now per-environment, resolved from config/environments.json:
//
//   platform-sandbox        PART_MASTER_WRITE_READY = true   (Wave 7 activation)
//   taylor-parts-production PART_MASTER_WRITE_READY = false
//   platform-integration    PART_MASTER_WRITE_READY = false
//   local-emulator          PART_MASTER_WRITE_READY = false
//
// READINESS IS NOT AUTHORIZATION, and readiness true does not mean "activated". It only permits the
// UI to ATTEMPT the callable. A sandbox principal still gets `permission-denied` until (a) the three
// callables are deployed to that project and (b) a governed, audited roleAssignment grants a
// capability-bearing Role -- `inventoryCatalogAdministrator` (access/governedBusinessRoles.ts) is the
// durable least-privilege Role for that grant. Neither of those is a repo edit; both are recorded in
// docs/releases/wave7-sandbox-manifest.md as pending sandbox-deploy work.
//
// While readiness is false, the workspace renders its create/edit/status affordances in a
// write-disabled state and usePartMasterWrite makes ZERO callable attempts. This is a compile-time
// constant resolved from the one environment registry (config/environments.json), NOT a runtime probe:
// the code never reaches Functions to guess whether they are deployed. Fails closed on an absent flag.
//
// `resolveWriteReadiness` exists so tests and the test-only preview can inject an explicit readiness
// value (with a MOCKED command client) without touching this constant -- an explicit override, never an
// ambient global mutation. An explicit `false` override still fails closed (zero callable attempts).
export const PART_MASTER_WRITE_READY = __APP_READINESS__.PART_MASTER_WRITE_READY === true;

export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : PART_MASTER_WRITE_READY;
}
