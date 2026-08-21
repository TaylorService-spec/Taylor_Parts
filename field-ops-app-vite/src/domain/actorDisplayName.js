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

// Certification Wave E -- resolves a Technician DOC id (WorkOrder.assignedTechId /
// scheduledTechId; a `fieldops_technicians` doc id, NOT a Firebase uid) to a display name.
//
// WHY THIS EXISTS AS ONE FUNCTION. Ten surfaces had each written their own copy inline, and
// they had drifted into three different behaviours for the same question:
//
//   ControlTower.jsx / DispatchQueuePanel.jsx   `?.name || id`      -> renders the RAW ID
//   Dispatch.jsx                                `?.name` + `?? id`  -> renders the RAW ID
//   WorkOrderAttentionPanel.jsx                 `?.name || "..."`   -> never renders an id
//
// The last one is correct and even documented its reasoning; the other four quietly fell back to
// showing an opaque `fieldops_technicians` key where a person's name belongs. Job Assignments
// (Jobs.jsx) rendered `assignedTechId` bare with no resolver at all, which is what the
// certification sweep reported. Extracting the good version is what stops the drift from
// re-accumulating -- a sixth inline copy would have been the actual defect.
//
// This is NOT the F-UID-1 security invariant: these are Technician documents with a plain `name`
// field, not auth uids, so nothing here is a uid-leak fix. It is the same UX rule that invariant
// established -- an id is not a name, and showing one where a name belongs tells the user nothing.
//
// State-aware, mirroring resolveEmployeeIdentity above so callers can share rendering logic:
// loading, error, resolved and unknown stay DISTINCT and are never collapsed into a guessed name.
// In particular "no technician assigned" and "assigned to someone we could not name" are different
// facts about the work order, and the UI is allowed to say so.
export const UNKNOWN_TECHNICIAN_DISPLAY_NAME = "Unknown technician";

export function resolveTechnicianIdentity(
  technicianId,
  { technicians = [], loading = false, error = null } = {},
) {
  if (!technicianId) return { state: "unset", name: null };
  if (error) return { state: "error", name: "Technician name unavailable" };
  if (loading) return { state: "loading", name: null };
  const match = technicians.find?.((t) => t?.id === technicianId);
  if (match?.name) return { state: "resolved", name: match.name };
  return { state: "unknown", name: UNKNOWN_TECHNICIAN_DISPLAY_NAME };
}
