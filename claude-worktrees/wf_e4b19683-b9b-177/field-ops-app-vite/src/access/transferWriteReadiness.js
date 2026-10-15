// Transfer WRITE-READINESS seam. The single place Transfers.jsx asks "may Transfer writes
// (create/dispatch/receive/cancel) happen from this client right now?" — mirroring the
// fail-closed write-readiness seam used for Opportunities (access/opportunityWriteReadiness.js).
// It exists so the workspace can render the New Transfer / Dispatch / Receive / Cancel
// affordances as HONEST, DISABLED controls with a visible reason instead of live-but-doomed
// buttons that always resolve permission-denied server-side.
//
// Today it is fail-closed by construction: every inventory.transfer.* capability
// (create/dispatch/receive/cancel) is registered active:false in permissionCatalog.ts and
// granted to NO Role today, so there is no client write path and this returns
// { enabled:false }. When a later, separately-authorized cycle activates the capability and
// grants it to a Role, this seam flips to check the real signal — WITHOUT Transfers.jsx
// changing: it already reads readiness only through here.
//
// PURE + injectable: no Firestore, no callable import. `deps` lets a future implementation
// (and tests) supply the real signal (granted capability) without coupling the UI to it now.

export const TRANSFER_WRITE_DISABLED_REASON =
  "Transfer actions are not enabled yet — inventory.transfer.create/dispatch/receive/cancel are registered but inactive and granted to no role.";

// Returns { enabled, reason }. Fail-closed default: writes are disabled until a governed
// activation + grant land. `deps.capabilityGranted` is the future real signal; omitted today,
// so this is unconditionally disabled and honest about why.
export function transferWriteReadiness(deps = {}) {
  const enabled = deps.capabilityGranted === true;
  return {
    enabled,
    reason: enabled ? null : TRANSFER_WRITE_DISABLED_REASON,
  };
}
