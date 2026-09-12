// Opportunity WRITE-READINESS seam (Cycle 3b). The single place the workspace asks "may Opportunity writes
// happen from this client right now?" — mirroring the fail-closed write-readiness seams used elsewhere in
// this app (e.g. Truck Management). It exists so the workspace can render the ratified lifecycle ACTIONS as
// HONEST, DISABLED affordances instead of either hiding them or pretending they work.
//
// Today it is fail-closed by construction, and the reason is the TRANSPORT, not the grant. Corrected
// 2026-09-12: this used to call `opportunity.write` "registered active:false (ungranted)". The
// ungranted half is false -- salesperson, salesManager, generalManager and dispatcher hold it
// (access/governedBusinessRoles.ts) and it is activated in platform-sandbox
// (config/environments.json); `active: false` is the production posture. What is still true is that
// the createOpportunity/transitionOpportunity callables are exported but NOT deployed, so there is no
// client write path, and this returns { enabled:false }. When a later, separately-authorized cycle grants the capability and deploys the
// callables, this seam flips to check them (capability present AND callable reachable) — WITHOUT the
// workspace changing: it already reads readiness only through here.
//
// PURE + injectable: no Firestore, no callable import. `deps` lets a future implementation (and tests) supply
// the real signals (granted capability, deployed callable) without coupling the UI to them now.

export const OPPORTUNITY_WRITE_DISABLED_REASON =
  // USER-VISIBLE. Says only what this seam can establish: the client write path is not wired up.
  // It used to add "capability ungranted", which was false and also unknowable from here -- this
  // module has no access to the Role roster and deliberately takes no `deps` today.
  "Creating and advancing opportunities is not enabled yet — the governed write path is built, but the command it calls is not deployed for this app.";

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
