import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useReorderRequests, useReorderRequestsByStatus, useReorderRequestsAssignedTo } from "../../hooks/useReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import NotificationPanel from "./NotificationPanel";
import { createPermissionPreviewer } from "../../access/navPermissionPreview";
import { resolveEffectivePermission } from "../../access/resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";

const previewHasPermission = createPermissionPreviewer(resolveEffectivePermission, COMPATIBILITY_ROLES);

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
  const { data: pendingReorderRequests } = useReorderRequests(canSeeReorderRequests);
  const { data: partsManagerRequests } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER,
    canSeeReorderRequests
  );
  const { data: assignedToYouRequests } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
    canSeeReorderRequests
  );
  const { data: purchasingStartedRequests } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
    canSeeReorderRequests
  );

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
        <span className="fo-appheader-title">Field Ops Platform</span>

        {/* Sprint 2.0.1, requirement #6: Home used to hard-link to
            "/Taylor_Parts/" -- the legacy root Parts Control Center,
            a different app entirely. Now a client-side route to this
            app's own dashboard, not a page navigation away from it. */}
        <Link to="/dashboard">
          Home
        </Link>

        {/* Full-reload link to the app root. Href is derived from Vite's
            build-time base (import.meta.env.BASE_URL) -- the same authority
            the asset base (I-1F) and router basename (I-1R) use -- so it
            resolves to the app's served root on GitHub Pages and on Firebase
            Hosting, never a hard-coded host path. */}
        <a href={import.meta.env.BASE_URL}>
          Refresh
        </a>
      </div>

      <div className="fo-appheader-right">
        {canSeeReorderRequests && (
          <NotificationPanel
            requests={pendingReorderRequests}
            partsManagerRequests={partsManagerRequests}
            assignedToYouRequests={assignedToYouRequests}
            purchasingStartedRequests={purchasingStartedRequests}
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
