// EI Receiving -- the SINGLE fail-closed write-readiness seam for the Receiving callable
// transport (LF1b). The two E1 callables (receiveInventoryStock, listReceivingLocationOptions)
// are EXPORTED in the repository, but ungranted and UNDEPLOYED -- the inventory.stock.receive
// capability is not granted and the Functions are not deployed. Readiness must therefore remain
// FALSE until the separate grant gate AND the E2 Rules/migration/callable-verification gates
// have all cleared. While readiness is false, the transport (services/receivingCallableClient.js)
// makes ZERO callable attempts and fails closed. This is a compile-time constant, NOT a runtime
// probe -- the code never reaches Functions to guess.
//
// Flipping this constant ALONE is NOT activation: the authorized Hosting release that serves the
// flipped bundle follows verified E2 completion (grant + Rules/migration/deploy/verify), and is a
// separate Owner-authorized gate not covered here. Mirrors config/truckManagementReadiness.js.
export const RECEIVING_TRANSPORT_READY = false;

// Effective readiness. An explicit boolean override (tests/preview only) wins; anything else
// falls back to the fail-closed production constant above. An explicit `false` still fails
// closed (zero callable attempts).
export function resolveReceivingTransportReady(override) {
  return typeof override === "boolean" ? override : RECEIVING_TRANSPORT_READY;
}
