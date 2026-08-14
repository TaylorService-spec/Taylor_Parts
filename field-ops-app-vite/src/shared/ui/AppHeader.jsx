import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useReorderRequests, useReorderRequestsByStatus, useReorderRequestsAssignedTo } from "../../hooks/useReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import NotificationPanel from "./NotificationPanel";
import { createPermissionPreviewer } from "../../access/navPermissionPreview";
import { resolveEffectivePermission } from "../../access/resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../../config/capabilityActivationOverrides";

const previewHasPermission = createPermissionPreviewer(
  resolveEffectivePermission,
  COMPATIBILITY_ROLES,
  CAPABILITY_ACTIVATION_OVERRIDE_SET,
);

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Notification
// Panel is admin/dispatcher only (same role scope as Inventory today) --
// `enabled` skips the reorder_requests read entirely for a technician,
// who has no firestore.rules read access to it, rather than fetching and
// getting a permission-denied error.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. There's no new
// Parts Manager auth role yet (per this sprint's approved scope --
// `currentOwner` is a data-level marker, not a permission tier), so
// READY_FOR_PARTS_MANAGER notifications are read under the same
// admin/dispatcher gate as Inventory's own pending-review ones.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Adds a
// third, per-user notification: ASSIGNED_TO_PARTS_ASSOCIATE requests
// assigned to the signed-in user specifically (not everyone with
// admin/dispatcher access), via useReorderRequestsAssignedTo(user.uid).
//
// Sprint 2.1.7 -- Purchase Execution Foundation. Adds a fourth,
// broadcast notification (like "Ready for Parts Manager", not
// per-user like "Assigned to You"): PURCHASING_IN_PROGRESS requests,
// notifying the Parts Manager that purchasing has begun.
// Gate 2 -- this is the workspace column's utility bar. It no longer competes
// with an application header: the Verenward brand + deployment identity now
// live at the head of the navigation rail, so this strip carries only session
// utilities. At drawer widths it also hosts the navigation toggle, because the
// rail is off-canvas there and needs an opener.
export default function AppHeader({ accessVersion, onOpenNav = null, navToggleRef = null, navOpen = false } = {}) {
  const { user, role, logout } = useAuth();
  // Issue #226 Row 16 -- presentation-only permission preview (Spec sec8/
  // sec12: never authoritative, UI visibility stays convenience only).
  // Legacy admin/dispatcher check retained as the `fallback` in case the
  // preview can't resolve (unknown role, resolver throws) -- see
  // navPermissionPreview.js's own doc comment.
  const canSeeReorderRequests = previewHasPermission("reorder.request.read.queue", role, {
    fallback: role === "admin" || role === "dispatcher",
  });
  // OD-3: one canonical part-name read for the whole header, threaded as `resolveName` into
  // NotificationPanel (never an independent read per notification). ENABLED only when the role
  // can see reorder notifications -- a technician/unauthorized role never triggers a canonical
  // `parts` read (no permission-denied read for someone who has no read access and no panel).
  // Fail-closed: a denied/unavailable/incomplete/invalid read (or the disabled state) degrades
  // names to the raw partId (never the static-catalog name). `accessVersion` is threaded from
  // App so a same-UID access change re-runs the read and invalidates the prior name map.
  const { resolveName } = useCanonicalPartNames({
    uid: user?.uid,
    accessVersion,
    enabled: canSeeReorderRequests,
  });
  const { data: pendingReorderRequests, error: pendingReorderRequestsError } = useReorderRequests(
    canSeeReorderRequests
  );
  const { data: partsManagerRequests, error: partsManagerRequestsError } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER,
    canSeeReorderRequests
  );
  const { data: assignedToYouRequests, error: assignedToYouRequestsError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
    canSeeReorderRequests
  );
  const { data: purchasingStartedRequests, error: purchasingStartedRequestsError } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
    canSeeReorderRequests
  );
  // site-work round-2 #4 (appheader-discards-reorder-error) -- each of the four
  // reorder-request subscriptions above already exposes its own onSnapshot `error`
  // (see hooks/useReorderRequests.js's W2 notes); this used to be discarded by
  // destructuring only `data`, so a failed subscription rendered the exact same
  // "no pending reorder requests" / undercounted bell as a genuinely empty queue,
  // with zero indication to the admin/dispatcher that a read actually failed.
  // Any one of the four failing is surfaced -- NotificationPanel can no longer
  // render a confidently-wrong empty/undercounted state when a read failed.
  const reorderRequestsError =
    pendingReorderRequestsError ||
    partsManagerRequestsError ||
    assignedToYouRequestsError ||
    purchasingStartedRequestsError ||
    null;

  return (
    <div className="fo-appheader">
      <div className="fo-appheader-left">
        {onOpenNav && (
          <button
            type="button"
            ref={navToggleRef}
            className="fo-navtoggle"
            onClick={onOpenNav}
            aria-expanded={navOpen}
            aria-label="Open navigation"
          >
            <span className="fo-navtoggle__bars" aria-hidden="true" />
          </button>
        )}
        {/* REMOVED by Gate 2 persona review, all four personas concurring:
              - "Field Ops Platform" was a FIFTH product name on a screen that
                already states Verenward / Enterprise Operations OS / Taylor
                Parts / Arizona Operations in the rail head. The rail
                establishes identity; repeating a different name here only
                contradicted it.
              - "Home" was a genuine SECOND NAVIGATION AXIS (verified: it
                navigated /service -> /dashboard), which is precisely what
                Option B's single-axis mandate exists to eliminate.
              - "Refresh" shipped a browser function as application chrome,
                sitting beside Home looking identical while doing something
                completely different.
            The bar now carries session utilities only. */}
      </div>

      <div className="fo-appheader-right">
        {canSeeReorderRequests && (
          <NotificationPanel
            requests={pendingReorderRequests}
            partsManagerRequests={partsManagerRequests}
            assignedToYouRequests={assignedToYouRequests}
            purchasingStartedRequests={purchasingStartedRequests}
            error={reorderRequestsError}
            resolveName={resolveName}
          />
        )}
        <span className="fo-appheader-email">{user?.email}</span>
        <button onClick={logout}>Logout</button>
      </div>
    </div>
  );
}

// Layout/colour for this strip now lives in index.css under .fo-appheader.
// It was moved out of an inline `styles` object because inline styles outrank
// the stylesheet, so the shell could not express the utility strip as
// subordinate chrome while these were still applied here.
