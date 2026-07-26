// INV-CONVERGENCE-E Stage A completion -- opaque, unique run-ID provider for the
// diagnostics orchestrator wiring (NOT the pure core). Each returned provider yields a
// distinct opaque ID per call: a per-provider random prefix (stable for the provider's
// lifetime) plus a monotonically increasing sequence. Contains NO user identity (no
// UID/email). This lives in the orchestrator layer, so randomness is permitted here.
function opaquePrefix() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID().slice(0, 8);
    }
  } catch {
    // fall through to the counter-only form
  }
  return "p";
}

/** Create a run-ID provider: `() => "run-<prefix>-<n>"`, distinct on every call. */
export function createRunIdProvider() {
  const prefix = opaquePrefix();
  let seq = 0;
  return () => `run-${prefix}-${(seq += 1)}`;
}
