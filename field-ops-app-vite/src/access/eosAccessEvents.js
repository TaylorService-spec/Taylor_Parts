// The one window event that says "a governed authority change just landed -- re-read my capabilities".
// Firebase exit F1 (DECISIONS #244). Dependency-free on purpose: the Administration API client dispatches it and the
// capability feed (access/useEosCapabilityFeed.js) listens, and neither may import the other.
export const EOS_ACCESS_CHANGED_EVENT = "eos:access-changed";

/** Administration operations that change who holds what. A successful one fires the event. */
export const ACCESS_CHANGING_OPERATIONS = Object.freeze([
  "assignRole",
  "revokeRole",
  "createRole",
  "updateRole",
  "setObjectPermission",
  "grantObjectActionToRole",
  "revokeObjectActionFromRole",
  "applyObjectWideRoleAuthority",
  "grantObjectActionToPrincipal",
  "revokeObjectActionFromPrincipal",
  "setGrantCondition",
  "retireGrantCondition",
]);

/** Tell the shell a governed role change just landed, so it re-reads the caller's capabilities now. */
export function notifyEosAccessChanged() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(EOS_ACCESS_CHANGED_EVENT));
  }
}
