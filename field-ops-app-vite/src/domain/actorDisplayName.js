// F-UID-1 remediation -- pure actor-uid -> display-name resolver for
// NON-ADMIN surfaces. Extracted out of hooks/useEmployeeDirectory.js
// (which imports React/Firestore and so can't be unit-tested by the
// node test runner) into this dependency-free module, matching this
// codebase's "pure logic lives in domain/" pattern. useEmployeeDirectory
// re-exports resolveActorDisplayName from here, so every existing
// `import { resolveActorDisplayName } from ".../useEmployeeDirectory"`
// call site is unchanged.
//
// The security invariant (F-UID-1): a raw Firebase UID must NEVER reach
// a non-Admin DOM. The authorized Admin user-management surface displays
// raw UIDs on its own, separately, and does not use this resolver -- so
// nothing here changes Admin behavior.

// Neutral, non-identifying label for any actor uid that cannot be
// resolved to a recognizable Employee name. Loading, a missing/legacy
// Employee link, and a failed directory read all collapse to this --
// none of them is allowed to fall back to the raw uid. A shared constant
// so tests and any future consumer reference one authoritative value.
export const UNKNOWN_ACTOR_DISPLAY_NAME = "Unknown user";

// Resolves a stored actor uid to a recognizable display name.
// - no actor value (null/undefined/empty) -> returned as-is, preserving
//   the existing empty-value convention (renders as nothing). This stays
//   DELIBERATELY distinct from "an actor we couldn't resolve": absence of
//   an actor is not the same as an unresolved actor.
// - resolved Employee record -> its displayName (recognizable identity).
// - loading directory / missing Employee link / failed read / legacy uid
//   -> UNKNOWN_ACTOR_DISPLAY_NAME, NEVER the raw uid (F-UID-1).
export function resolveActorDisplayName(userId, byUserId) {
  if (!userId) return userId;
  return byUserId?.get(userId)?.displayName ?? UNKNOWN_ACTOR_DISPLAY_NAME;
}

// Wave 7 completion (account-scoped Opportunity/Sales Order sections) -- resolves an Employee DOC id
// (Opportunity.ownerEmployeeId / SalesOrder.ownerEmployeeId; NOT a Firebase uid) to a current display
// name via useEmployeeDirectory's byEmployeeId map. State-aware like commercialProfile.js's
// resolveOwnerIdentity/resolveContactIdentity (loading/error/resolved/unknown stay distinct, never
// collapsed to a guessed name), and consistent with that pair's contract shape so callers can share
// rendering logic. Never returns the raw employeeId as a "name" -- an id that doesn't resolve is
// "unknown", not silently displayed as if it were a name.
export function resolveEmployeeIdentity(employeeId, { byEmployeeId, loading = false, error = null } = {}) {
  if (!employeeId) return { state: "unset", name: null };
  if (error) return { state: "error", name: "Owner name unavailable" };
  if (loading) return { state: "loading", name: null };
  const employee = byEmployeeId?.get?.(employeeId);
  if (employee?.displayName) return { state: "resolved", name: employee.displayName };
  return { state: "unknown", name: "Unknown owner" };
}
