import { useState } from "react";
import { Link } from "react-router-dom";
import { getCatalogItem } from "../../data/partsCatalog";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Minimal
// (Version 0.1) notification experience: Header -> Notification Panel
// -> Open Notification -> Inventory Request (no separate "My Work" view,
// no new route -- each entry links to the existing /inventory/:partId
// route). Purely presentational: AppHeader.jsx supplies `requests` via
// useReorderRequests(), this component only renders them.
export default function NotificationPanel({ requests }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fo-notification-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        Notifications{requests.length > 0 ? ` (${requests.length})` : ""}
      </button>
      {open && (
        <div className="fo-notification-panel-dropdown">
          {requests.length === 0 ? (
            <p className="fo-muted">No pending reorder requests.</p>
          ) : (
            requests.map((request) => (
              <Link
                key={request.id}
                to={`/inventory/${request.partId}`}
                className="fo-notification-panel-item"
                onClick={() => setOpen(false)}
              >
                <span>{getCatalogItem(request.partId)?.name ?? request.partId}</span>
                <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
