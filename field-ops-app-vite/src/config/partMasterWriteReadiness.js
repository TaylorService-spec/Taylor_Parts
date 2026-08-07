// Part Master (ADR-009 G2) -- the SINGLE, explicit write-readiness seam for the Part Master
// administration UI. The three trusted callables (partMasterCommandClient.js) are exported from
// functions/src/index.ts but are NOT deployed and NO catalog capability is granted, so this seam is
// FAIL-CLOSED:
//
//   PART_MASTER_WRITE_READY = false
//
// While readiness is false, the workspace renders its create/edit/status affordances in a
// write-disabled state and usePartMasterWrite makes ZERO callable attempts. This is a compile-time
// constant resolved from the one environment registry (config/environments.json), NOT a runtime probe:
// the code never reaches Functions to guess whether they are deployed. Activation is a protected
// promotion (Functions deploy + capability grant + a Hosting release serving this bundle), not a repo
// edit. Fails closed on an absent flag.
//
// `resolveWriteReadiness` exists so tests and the test-only preview can inject an explicit readiness
// value (with a MOCKED command client) without touching this constant -- an explicit override, never an
// ambient global mutation. An explicit `false` override still fails closed (zero callable attempts).
export const PART_MASTER_WRITE_READY = __APP_READINESS__.PART_MASTER_WRITE_READY === true;

export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : PART_MASTER_WRITE_READY;
}
