// Opportunity WRITE-READINESS seam (Cycle 3b). The single place the workspace asks "may Opportunity writes
// happen from this client right now?" — mirroring the fail-closed write-readiness seams used elsewhere in
// this app (e.g. Truck Management). It exists so the workspace can render the ratified lifecycle ACTIONS as
// HONEST, DISABLED affordances instead of either hiding them or pretending they work.
//
// Today it is fail-closed by construction: the governed write path (Cycle 3) is built but INERT — the
// `opportunity.write` capability is registered active:false (ungranted) and the createOpportunity/
// transitionOpportunity callables are exported but NOT deployed. So there is no client write path, and this
// returns { enabled:false }. When a later, separately-authorized cycle grants the capability and deploys the
// callables, this seam flips to check them (capability present AND callable reachable) — WITHOUT the
// workspace changing: it already reads readiness only through here.
//
// PURE + injectable: no Firestore, no callable import. `deps` lets a future implementation (and tests) supply
// the real signals (granted capability, deployed callable) without coupling the UI to them now.

export const OPPORTUNITY_WRITE_DISABLED_REASON =
  "Creating and advancing opportunities is not enabled yet — the governed write path is built but inactive (capability ungranted, command not deployed).";

// Returns { enabled, reason }. Fail-closed default: writes are disabled until a governed grant + deploy land.
// `deps.capabilityGranted` / `deps.commandDeployed` are the future real signals (both must be true to enable);
// omitted today, so this is unconditionally disabled and honest about why.
export function opportunityWriteReadiness(deps = {}) {
  const capabilityGranted = deps.capabilityGranted === true;
  const commandDeployed = deps.commandDeployed === true;
  const enabled = capabilityGranted && commandDeployed;
  return {
    enabled,
    reason: enabled ? null : OPPORTUNITY_WRITE_DISABLED_REASON,
  };
}
