import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCatalogItem } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useReorderRequestForPart } from "../../hooks/useReorderRequests";
import { reviewReorderRequest, assignReorderRequest } from "../../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";

// Sprint 2.1.1 -- Inventory Domain Foundation. Part detail screen,
// reached from PartsList.jsx or Global Search. Read-only: catalog
// metadata comes from data/partsCatalog.ts (static), stock position/
// usage/recommendation and transaction history come from
// useInventoryLedger() -- the same one-shot read + pure analytics
// functions PartsList.jsx and Operations.jsx both use. No new
// Firestore query, no new computed math.
//
// Sprint 2.1.4 -- Reorder Review & Decision. This is also where the
// Notification Panel routes an approver to (Header -> Notification
// Panel -> Open Notification -> Inventory Request, Sprint 2.1.3) --
// adds a Reorder Request review card: pending requests get Approve/
// Reject actions, already-decided ones show the outcome. Writes go
// exclusively through domain/inventoryReorderRequests.js's
// reviewReorderRequest() -- this component never calls Firestore
// directly.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. An approved
// request's status is now READY_FOR_PARTS_MANAGER (not APPROVED).
// Decision badge/notes still read `reviewDecision` (the permanent
// APPROVED/REJECTED fact), not `status`. Adds a "Current owner" row so
// a reviewer can see the hand-off took effect.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. The
// status branch below is now three-way, not binary: PENDING_REVIEW
// (review card) -> READY_FOR_PARTS_MANAGER (new ReorderRequestAssignment
// card, below) -> anything else (REJECTED or ASSIGNED_TO_PARTS_ASSOCIATE,
// ReorderRequestDecision, extended with assignedToUserId/assignedAt
// rows). Writes go exclusively through
// domain/inventoryReorderRequests.js's assignReorderRequest().
function formatTimestamp(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function ReorderRequestReview({ request, onReviewed }) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await reviewReorderRequest(request.id, { decision: REORDER_REQUEST_STATUS.APPROVED });
      onReviewed();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  async function handleReject(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await reviewReorderRequest(request.id, { decision: REORDER_REQUEST_STATUS.REJECTED, notes: rejectNotes });
      onReviewed();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Pending Review</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Requested</td>
            <td>{formatTimestamp(request.createdAt)}</td>
          </tr>
          <tr>
            <td>Recommended qty</td>
            <td>{request.recommendedQty}</td>
          </tr>
          <tr>
            <td>Risk at request time</td>
            <td>
              <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {error && <p className="fo-muted">{error}</p>}

      {!showRejectForm ? (
        <div className="disp-board-toolbar">
          <button type="button" onClick={handleApprove} disabled={submitting}>
            Approve
          </button>
          <button type="button" onClick={() => setShowRejectForm(true)} disabled={submitting}>
            Reject
          </button>
        </div>
      ) : (
        <form className="fo-form" onSubmit={handleReject}>
          <label htmlFor="reject-notes">Review notes (required to reject)</label>
          <textarea
            id="reject-notes"
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            required
          />
          <div className="disp-board-toolbar">
            <button type="submit" disabled={submitting || !rejectNotes.trim()}>
              Confirm Rejection
            </button>
            <button type="button" onClick={() => setShowRejectForm(false)} disabled={submitting}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Shown
// when a request is READY_FOR_PARTS_MANAGER -- the Parts Manager
// assigns it to a specific person by uid. There is no client-side way
// to list users (firestore.rules' users/{userId} read is self-only),
// so this is a manually-entered uid, same as PT-001's
// assignTechnicianToUser.js. Writes go exclusively through
// domain/inventoryReorderRequests.js's assignReorderRequest().
function ReorderRequestAssignment({ request, onAssigned }) {
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleAssign(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await assignReorderRequest(request.id, { assignedToUserId });
      onAssigned();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Ready for Parts Manager</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Approved</td>
            <td>{formatTimestamp(request.reviewedAt)}</td>
          </tr>
          <tr>
            <td>Recommended qty</td>
            <td>{request.recommendedQty}</td>
          </tr>
          <tr>
            <td>Urgency</td>
            <td>
              <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {error && <p className="fo-muted">{error}</p>}

      <form className="fo-form" onSubmit={handleAssign}>
        <label htmlFor="assigned-to-user-id">Assign to Parts Associate (User ID)</label>
        <input
          id="assigned-to-user-id"
          type="text"
          value={assignedToUserId}
          onChange={(e) => setAssignedToUserId(e.target.value)}
          required
        />
        <div className="disp-board-toolbar">
          <button type="submit" disabled={submitting || !assignedToUserId.trim()}>
            Assign
          </button>
        </div>
      </form>
    </div>
  );
}

function ReorderRequestDecision({ request }) {
  return (
    <div className="fo-card">
      <h3>Reorder Request</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Decision</td>
            <td>
              <span className={`fo-badge fo-badge-${request.reviewDecision === REORDER_REQUEST_STATUS.APPROVED ? "low" : "critical"}`}>
                {request.reviewDecision}
              </span>
            </td>
          </tr>
          <tr>
            <td>Reviewed</td>
            <td>{formatTimestamp(request.reviewedAt)}</td>
          </tr>
          {request.currentOwner && (
            <tr>
              <td>Current owner</td>
              <td>{request.currentOwner}</td>
            </tr>
          )}
          {request.assignedToUserId && (
            <tr>
              <td>Assigned to</td>
              <td>{request.assignedToUserId}</td>
            </tr>
          )}
          {request.assignedAt && (
            <tr>
              <td>Assigned</td>
              <td>{formatTimestamp(request.assignedAt)}</td>
            </tr>
          )}
          {request.reviewNotes && (
            <tr>
              <td>Notes</td>
              <td>{request.reviewNotes}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PartDetail() {
  const { partId } = useParams();
  const part = getCatalogItem(partId);
  const { transactions, healthEntries, loading } = useInventoryLedger();
  const { data: reorderRequest, loading: reorderRequestLoading, refresh: refreshReorderRequest } =
    useReorderRequestForPart(partId);

  const health = useMemo(() => healthEntries.find((entry) => entry.partId === partId), [healthEntries, partId]);

  const partTransactions = useMemo(
    () =>
      transactions
        .filter((t) => t.partId === partId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20),
    [transactions, partId]
  );

  if (!part) {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Unknown part "{partId}".</p>
        <Link to="/inventory">← Back to Parts</Link>
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <Link to="/inventory">← Back to Parts</Link>
      <h2>{part.name}</h2>
      <p className="fo-muted">
        {part.sku} -- {part.category} -- {part.unit}
      </p>

      {!reorderRequestLoading && reorderRequest && (
        reorderRequest.status === REORDER_REQUEST_STATUS.PENDING_REVIEW ? (
          <ReorderRequestReview request={reorderRequest} onReviewed={refreshReorderRequest} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER ? (
          <ReorderRequestAssignment request={reorderRequest} onAssigned={refreshReorderRequest} />
        ) : (
          <ReorderRequestDecision request={reorderRequest} />
        )
      )}

      <div className="fo-card">
        <h3>Catalog</h3>
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Cost</td>
              <td>${part.cost.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Price</td>
              <td>${part.price.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Warehouse baseline</td>
              <td>{part.warehouseQty}</td>
            </tr>
            <tr>
              <td>Reorder threshold (catalog)</td>
              <td>{part.reorderThreshold}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {loading ? (
        <p className="fo-muted">Loading stock position...</p>
      ) : health ? (
        <div className="fo-card">
          <h3>Stock Position &amp; Reorder Status</h3>
          <table className="fo-table">
            <tbody>
              <tr>
                <td>Available (ledger-derived)</td>
                <td>{health.stock.availableStock}</td>
              </tr>
              <tr>
                <td>Avg daily usage</td>
                <td>{health.usage.avgDailyUsage.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Days remaining</td>
                <td>
                  {Number.isFinite(health.recommendation.daysRemaining)
                    ? health.recommendation.daysRemaining.toFixed(1)
                    : "—"}
                </td>
              </tr>
              <tr>
                <td>Reorder point</td>
                <td>{Math.ceil(health.recommendation.reorderPoint)}</td>
              </tr>
              <tr>
                <td>Recommended reorder qty</td>
                <td>{Math.ceil(health.recommendation.recommendedOrderQty)}</td>
              </tr>
              <tr>
                <td>Risk</td>
                <td>
                  <span className={`fo-badge fo-badge-${health.recommendation.urgency.toLowerCase()}`}>
                    {health.recommendation.urgency}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fo-muted">No ledger activity yet for this part -- stock position not yet forecastable.</p>
      )}

      <div className="fo-card">
        <h3>Recent Transactions</h3>
        {partTransactions.length === 0 ? (
          <p className="fo-muted">No ledger transactions for this part yet.</p>
        ) : (
          <table className="fo-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Work Order</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {partTransactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.type}</td>
                  <td>{t.quantity}</td>
                  <td className="fo-muted">{t.workOrderId}</td>
                  <td className="fo-muted">{formatTimestamp(t.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
