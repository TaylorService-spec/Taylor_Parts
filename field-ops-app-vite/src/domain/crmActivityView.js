// CRM Activity / Notes — PURE view-model for the trusted `getCrmActivities` read
// (functions/src/crmActivity/crmActivityReadService.ts). No Firebase import, unit-testable in Node.
// Mirrors domain/accountArView.js's own honest-states contract exactly:
//   loading | denied (thrown permission-denied) | unavailable (read failed, or the account's real
//   activity set exceeds the page bound) | empty (ready, zero activities) | ready (ready, at least one
//   activity). Never collapses denied to empty, never fabricates an activity.
import { crmActivityTypeLabel } from "./crmActivityTypes.js";

export const CRM_ACTIVITY_VIEW_STATE = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  EMPTY: "empty",
  READY: "ready",
});

// Maps a callable-transport error code to a distinct client status. Mirrors
// domain/accountArView.js's mapAccountArErrorToStatus shape.
export function mapCrmActivityErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? CRM_ACTIVITY_VIEW_STATE.DENIED : CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE;
}

function formatTimestamp(millis) {
  if (typeof millis !== "number" || !Number.isFinite(millis)) return null;
  try {
    return new Date(millis).toLocaleString();
  } catch {
    return null;
  }
}

// One activity row -> its render-ready shape. `resolveActorName` is injected (never imported directly)
// so this module stays Firebase-free -- the caller supplies domain/actorDisplayName.js's
// resolveActorDisplayName bound to its own employee directory (F-UID-1: never render a raw uid here).
function rowView(activity, resolveActorName) {
  return {
    key: activity.id,
    type: activity.type,
    typeLabel: crmActivityTypeLabel(activity.type),
    body: activity.body,
    occurredAtMillis: activity.occurredAtMillis,
    occurredAtText: formatTimestamp(activity.occurredAtMillis) ?? "Unknown time",
    createdAtMillis: activity.createdAtMillis,
    createdAtText: formatTimestamp(activity.createdAtMillis),
    // A backdated log entry (occurredAt !== createdAt) is worth surfacing distinctly in the UI -- an
    // honest "logged later" signal, never silently collapsed into a single timestamp.
    backdated: typeof activity.createdAtMillis === "number" && activity.createdAtMillis !== activity.occurredAtMillis,
    actorName: resolveActorName ? resolveActorName(activity.createdByUid) : activity.createdByUid,
    contactId: activity.contactId,
    opportunityId: activity.opportunityId,
    salesOrderId: activity.salesOrderId,
    hasLinkedContext: Boolean(activity.contactId || activity.opportunityId || activity.salesOrderId),
  };
}

// Build the render-ready view from the callable's raw result ({status, activities}) or a
// transport-level error status. `result` is null while still loading.
export function crmActivityView({ loading = false, errorStatus = null, result = null, resolveActorName = null } = {}) {
  if (loading) return { kind: CRM_ACTIVITY_VIEW_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result || result.status !== "ready") return { kind: CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE };

  const activities = Array.isArray(result.activities) ? result.activities : [];
  if (activities.length === 0) return { kind: CRM_ACTIVITY_VIEW_STATE.EMPTY };

  return {
    kind: CRM_ACTIVITY_VIEW_STATE.READY,
    rows: activities.map((a) => rowView(a, resolveActorName)),
  };
}
