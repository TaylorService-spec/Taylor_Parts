// Manufacturer -- the SINGLE, explicit write-readiness seam for the Manufacturer administration UI. The
// three trusted callables (manufacturerCommandClient.js) are exported from functions/src/index.ts but are
// NOT deployed and NO catalog capability is granted, so this seam is FAIL-CLOSED:
//
//   MANUFACTURER_WRITE_READY = false
//
// While false, the workspace renders its create/edit/status affordances write-disabled and
// useManufacturerWrite makes ZERO callable attempts. Compile-time constant resolved from the one
// environment registry (config/environments.json), NOT a runtime probe. Activation is a protected
// promotion (Functions deploy + capability grant + Rules deploy for the read + a Hosting release), not a
// repo edit. Fails closed on an absent flag. `resolveWriteReadiness` lets tests/preview inject an explicit
// readiness with a MOCKED client; an explicit false still fails closed.
export const MANUFACTURER_WRITE_READY = __APP_READINESS__.MANUFACTURER_WRITE_READY === true;

export function resolveWriteReadiness(override) {
  return typeof override === "boolean" ? override : MANUFACTURER_WRITE_READY;
}
