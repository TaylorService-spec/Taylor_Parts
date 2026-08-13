import { useState } from "react";
import { Link } from "react-router-dom";
import FailureState from "./FailureState";
import { loadErrorMessage } from "../../domain/loadErrorMessage";

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
function NotificationItem({ request, resolveName, onNavigate }) {
  return (
    <Link
      to={`/inventory/${request.partId}?requestId=${request.id}`}
      className="fo-notification-panel-item"
      onClick={onNavigate}
    >
      <span>{resolveName(request.partId)}</span>
      {/* Personas read a bare "MEDIUM" here beside the Inventory queue's
          "Critical & High (0)" and took them for one scale -- then reported the two
          screens as contradicting each other. They are different authorities: this is
          a REORDER REQUEST's urgency (a request awaiting review), not a stock-condition
          severity (see the Service<->Inventory material-truth assessment). Same badge
          vocabulary, different meaning, nothing saying which. Name the scale on the
          row. This does not reconcile the two numbers -- they are not the same fact
          and must not be made to agree. */}
      {request.urgency ? (
        <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>
          Request urgency: {request.urgency}
        </span>
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
  // site-work round-2 #4 (appheader-discards-reorder-error) -- any one of AppHeader's
  // four reorder-request subscriptions failing (permission-denied, unavailable, ...).
  // A failed read must NEVER be shown as a confidently-wrong empty/undercounted bell
  // (mirrors WorkOrdersList.jsx/Dispatch.jsx/DispatcherBoard.jsx's "fail visibly"
  // pattern, test/dispatchSurfacesErrorState.test.jsx) -- so this takes priority over
  // `total` below both on the button and inside the dropdown.
  error = null,
  // OD-3: governed canonical partId -> name resolver supplied by AppHeader (one shared read).
  // Defaults to the raw partId so this presentational component NEVER falls back to a static
  // name and never crashes if a caller omits it -- fail-closed by construction.
  resolveName = (partId) => partId,
}) {
  const [open, setOpen] = useState(false);
  const total =
    requests.length + partsManagerRequests.length + assignedToYouRequests.length + purchasingStartedRequests.length;
  const close = () => setOpen(false);

  return (
    <div className="fo-notification-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={error ? "Notifications, couldn't load" : "Notifications"}
      >
        Notifications{error ? " ⚠" : total > 0 ? ` (${total})` : ""}
      </button>
      {open && (
        <div className="fo-notification-panel-dropdown">
          {error ? (
            <FailureState message={loadErrorMessage(error, { entity: "reorder-request notifications" })} />
          ) : total === 0 ? (
            <p className="fo-muted">No pending reorder requests.</p>
          ) : (
            <>
              {/* State the authority once, at the top. Everything in this panel is a
                  REORDER REQUEST moving through review/assignment/purchasing -- not a
                  stock condition. Without this, readers matched these rows against the
                  Inventory queue's severity counts and reported a contradiction between
                  two surfaces that were never describing the same thing. */}
              <p className="fo-muted fo-notification-panel-scope">
                Reorder requests in progress. Stock levels live in Inventory.
              </p>
              {requests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Pending Review</p>
                  {requests.map((request) => (
                    <NotificationItem key={request.id} request={request} resolveName={resolveName} onNavigate={close} />
                  ))}
                </>
              )}
              {partsManagerRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Ready for Parts Manager</p>
                  {partsManagerRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} resolveName={resolveName} onNavigate={close} />
                  ))}
                </>
              )}
              {assignedToYouRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Assigned to You</p>
                  {assignedToYouRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} resolveName={resolveName} onNavigate={close} />
                  ))}
                </>
              )}
              {purchasingStartedRequests.length > 0 && (
                <>
                  <p className="fo-notification-panel-section">Purchasing Started</p>
                  {purchasingStartedRequests.map((request) => (
                    <NotificationItem key={request.id} request={request} resolveName={resolveName} onNavigate={close} />
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
