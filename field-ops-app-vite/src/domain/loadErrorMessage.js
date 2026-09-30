// Issue #214 PR-4 -- safe, categorized copy for a page/collection LOAD or
// subscription failure, rendered by FailureState. Deliberately a dependency-free
// module (no firebase / no other imports) so it is node-importable and
// unit-tested directly (test/sharedStates.test.mjs). It maps a Firebase error to
// safe human copy and NEVER surfaces a raw code, path, document id, or stack --
// the same discipline as the domain *SaveErrorMessage helpers, for the read side.
export function loadErrorMessage(err, { entity = "data" } = {}) {
  const code = err?.code ?? "";
  // The governed EOS Work Order route's readiness state (DQ-S4): said as itself, never as a failure.
  if (code === "NOT_ACTIVATED") {
    return `Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED). No ${entity} are shown until the governed Work Order authority is switched on.`;
  }
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED" || code === "NOT_SIGNED_IN") {
    return `You do not have permission to view these ${entity}.`;
  }
  if (code === "UNREACHABLE" || code === "UNAVAILABLE" || code === "NOT_CONFIGURED") {
    return `Can't reach the server right now. Check your connection and try again.`;
  }
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return `You do not have permission to view these ${entity}.`;
  }
  if (code === "unavailable" || code === "firestore/unavailable") {
    return `Can't reach the server right now. Check your connection and try again.`;
  }
  return `Couldn't load ${entity}. Please try again.`;
}
