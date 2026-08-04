// EI Receiving -- the SINGLE fail-closed write-readiness seam for the Receiving callable
// transport (LF1b). The two E1 callables (receiveInventoryStock, listReceivingLocationOptions)
// are deployed, but the Customer frontend must NOT invoke them until a later, separately
// authorized activation gate. While readiness is false, the transport (services/
// receivingCallableClient.js) makes ZERO callable attempts and fails closed. This is a
// compile-time constant, NOT a runtime probe -- the code never reaches Functions to guess.
// Flipping this constant + a Hosting release is what activates the transport (that gate is not
// authorized here). Mirrors config/truckManagementReadiness.js.
export const RECEIVING_TRANSPORT_READY = false;

// Effective readiness. An explicit boolean override (tests/preview only) wins; anything else
// falls back to the fail-closed production constant above. An explicit `false` still fails
// closed (zero callable attempts).
export function resolveReceivingTransportReady(override) {
  return typeof override === "boolean" ? override : RECEIVING_TRANSPORT_READY;
}
