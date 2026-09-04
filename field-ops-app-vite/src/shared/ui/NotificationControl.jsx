// THE NOTIFICATION CONTROL -- moved, not rebuilt.
//
// This orchestration used to live in AppHeader, because the bell lived in the top strip. The bell
// now sits in the rail footer beside the account block, so the orchestration moved with it. Every
// read, gate, projection and label below is the one AppHeader had: what a notification IS, who may
// see one, how they are grouped and where they link are all unchanged. Only the location changed.
//
// IT OWNS ITS OWN AUTHORITY, and that is the point of the seam. The rail renders this for every
// principal, so if the gate lived at the CALL SITE instead, every signed-in person would start
// loading the reorder queue merely because everyone has a rail. The reads are gated INSIDE, exactly
// as they were, and an unauthorized principal renders nothing and reads nothing.
import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useReorderRequests, useReorderRequestsByStatus, useReorderRequestsAssignedTo } from "../../hooks/useReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { partsAttentionItems, groupPartsAttentionItemsBySection } from "../../domain/partsAttentionProjection.js";
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

export default function NotificationControl({ accessVersion } = {}) {
  // READ DEFENSIVELY, exactly as RailIdentity does and for the same reason. This now renders from
  // AppShell, which is mounted in tests (and could be mounted inside an error boundary) with no
  // AuthContext above it -- there useAuth() returns undefined and a destructure throws, taking the
  // whole navigation shell down to render a notification bell. The bell is the least important
  // thing in the footer; it fails closed to nothing and the shell keeps working.
  const auth = useAuth() ?? {};
  const { user, role } = auth;
  const canSeeReorderRequests = previewHasPermission("reorder.request.read.queue", role, {
    fallback: role === "admin" || role === "dispatcher",
  });
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
  // Any one of the four failing is surfaced: a failed subscription must not render as an empty or
  // undercounted queue, which is indistinguishable from good news.
  const reorderRequestsError =
    pendingReorderRequestsError ||
    partsManagerRequestsError ||
    assignedToYouRequestsError ||
    purchasingStartedRequestsError ||
    null;

  const notificationSections = useMemo(() => {
    const items = partsAttentionItems([
      ...pendingReorderRequests,
      ...partsManagerRequests,
      ...assignedToYouRequests,
      ...purchasingStartedRequests,
    ]);
    return groupPartsAttentionItemsBySection(items);
  }, [pendingReorderRequests, partsManagerRequests, assignedToYouRequests, purchasingStartedRequests]);

  if (!canSeeReorderRequests) return null;

  return (
    <div className="fo-rail__notifications">
      <NotificationPanel
        sections={notificationSections}
        error={reorderRequestsError}
        resolveName={resolveName}
      />
    </div>
  );
}
