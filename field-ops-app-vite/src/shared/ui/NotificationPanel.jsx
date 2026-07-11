import { useState } from "react";
import { Link } from "react-router-dom";
import { getCatalogItem } from "../../data/partsCatalog";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Minimal
// (Version 0.1) notification experience: Header -> Notification Panel
// -> Open Notification -> Inventory Request (no separate "My Work" view,
// no new route -- each entry links to the existing /inventory/:partId
// route). Purely presentational: AppHeader.jsx supplies `requests` via
// useReorderRequests(), this component only renders them.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. Reused, not
// replaced, for the new READY_FOR_PARTS_MANAGER notifications --
// `partsManagerRequests` is a second, optional list rendered under its
// own section heading in the same dropdown, same item template. No new
// notification component, no new route.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Reused
// again for the platform's first per-user notification --
// `assignedToYouRequests` is a third, optional list: only the
// signed-in user's own ASSIGNED_TO_PARTS_ASSOCIATE requests
// (AppHeader.jsx filters by uid via useReorderRequestsAssignedTo()),
// so this satisfies "notify only the assigned Parts Associate"
// without a per-user notification system -- it's the same broadcast
// read as the other two sections, filtered client-side to one user.
//
// Sprint 2.1.7 -- Purchase Execution Foundation. `purchasingStartedRequests`
// is a fourth, optional list: PURCHASING_IN_PROGRESS requests, notifying
// "the Parts Manager" -- role-level/broadcast (there's still no distinct
// Parts Manager auth role), same as "Ready for Parts Manager" above, not
// per-user like "Assigned to You".
//
// Zero-history reorder behavior sprint, PR 3 -- `request.urgency` is
// null for a NEEDS_PLANNING request; shows a "Needs planning" badge
// instead of crashing on `.toLowerCase()`.
// Notification identity fix (docs/specifications/notification-identity.md,
// Issue #145) -- `request.id` (the request's own Firestore document id,
// already present on every notification object via toDocs(), already
// used above as this list's React key) is now also passed as a
// requestId query param, so PartDetail resolves the EXACT request that
// produced this notification instead of "whichever request for this
// part happens to be newest" -- which could silently be a different,
// terminal request for the same part.
function NotificationItem({ request, onNavigate }) {
  return (
    <Link
      to={`/inventory/${request.partId}?requestId=${request.id}`}
      className="fo-notification-panel-item"
      onClick={onNavigate}
    >
      <span>{getCatalogItem(request.partId)?.name ?? request.partId}</span>
      {request.urgency ? (
        <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
      ) : (
        <span className="fo-badge">Needs planning</span>
      )}
    </Link>
  );
}

export default function NotificationPanel({
  requests,
  partsManagerRequests = [],
  assignedToYouRequests = [],
  purchasingStartedRequests = [],
}) {
  const [open, setOpen] = useState(false);
  const total =
    requests.length + partsManagerRequests.length + assignedToYouRequests.length + purchasingStartedRequests.length;
  const close = () => setOpen(false);

  return (
    <div className="fo-notification-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        Notifications{total > 0 ? ` (${total})` : ""}
      </button>
      {open && (
        <div className="fo-notification-panel-dropdown">
          {total === 0 ? (
            <p className="fo-muted">No pending reorder requests.</p>
          ) : (
            <>
              {requests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Pending Review</p>
                  {requests.map((request) => (
                    <NotificationItem key={request.id} request={request} onNavigate={close} />
                  ))}
                </>
              )}
              {partsManagerRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Ready for Parts Manager</p>
                  {partsManagerRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} onNavigate={close} />
                  ))}
                </>
              )}
              {assignedToYouRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Assigned to You</p>
                  {assignedToYouRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} onNavigate={close} />
                  ))}
                </>
              )}
              {purchasingStartedRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Purchasing Started</p>
                  {purchasingStartedRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} onNavigate={close} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
