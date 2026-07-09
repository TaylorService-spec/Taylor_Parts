import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCatalogItem } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useReorderRequestForPart } from "../../hooks/useReorderRequests";
import { useInventoryActionsForPart } from "../../hooks/useInventoryActions";
import {
  reviewReorderRequest,
  assignReorderRequest,
  startPurchasing,
  updatePurchasingProgress,
} from "../../domain/inventoryReorderRequests";
import { recordInventoryAction } from "../../domain/inventoryActions";
import { REORDER_REQUEST_STATUS, INVENTORY_ACTION_TYPE } from "../../domain/constants";
import { useAuth } from "../../auth/AuthContext";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";

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
//
// Sprint 2.1.7 -- Purchase Execution Foundation. Status branch is now
// four-way: adds ASSIGNED_TO_PARTS_ASSOCIATE -> new
// ReorderRequestStartPurchasing card, restricted to the assigned
// person only (everyone else sees a passive waiting message --
// firestore.rules is what actually enforces this isn't bypassable).
// Writes go exclusively through domain/inventoryReorderRequests.js's
// startPurchasing().
//
// Sprint 2.1.8 -- Purchasing Progress Update. Status branch is now
// five-way: adds PURCHASING_IN_PROGRESS -> new
// ReorderRequestPurchasingUpdate card (below), also assignee-only for
// the actual submit action, showing the latest update to everyone.
// ReorderRequestDecision is now only reached by REJECTED (the one
// remaining status that isn't its own branch) -- its
// purchasingStartedBy/purchasingStartedAt rows never actually render
// there in practice (a rejected request never reaches
// PURCHASING_IN_PROGRESS) but are left as harmless dead conditionals
// rather than removed, to minimize diff. Writes go exclusively through
// domain/inventoryReorderRequests.js's updatePurchasingProgress(),
// which does NOT transition status -- a request can receive any
// number of updates while PURCHASING_IN_PROGRESS.
//
// Sprint 2.1.9 -- Inventory Actions Foundation. Adds an "Inventory
// Actions" card (InventoryActionsPanel, below) -- entirely separate
// from the Reorder Request cards above and unrelated to their status
// branch. Lets an admin/dispatcher record a Receive Stock/Adjust
// Stock/Correct Mistake action against this Part directly (no
// approval workflow, no status machine -- a single-step create, same
// posture as a ledger entry). Writes go exclusively through
// domain/inventoryActions.js's recordInventoryAction(), into a NEW
// collection (inventory_actions) deliberately separate from
// inventory_transactions (Epic 2D/3, the Work Order-driven ledger,
// untouched by this sprint). Shows recent actions for this Part,
// realtime, via hooks/useInventoryActions.js.
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

// Sprint 2.1.7 -- Purchase Execution Foundation. Shown when a request
// is ASSIGNED_TO_PARTS_ASSOCIATE -- only the assigned person can
// actually start purchasing (firestore.rules enforces
// request.auth.uid == assignedToUserId), so anyone else viewing this
// screen (any admin/dispatcher can read it) sees a passive waiting
// message instead of the button. Writes go exclusively through
// domain/inventoryReorderRequests.js's startPurchasing().
function ReorderRequestStartPurchasing({ request, onStarted }) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const isAssignee = user?.uid === request.assignedToUserId;

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      await startPurchasing(request.id);
      onStarted();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Assigned to Parts Associate</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Assigned to</td>
            <td>{request.assignedToUserId}</td>
          </tr>
          <tr>
            <td>Assigned</td>
            <td>{formatTimestamp(request.assignedAt)}</td>
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

      {isAssignee ? (
        <div className="disp-board-toolbar">
          <button type="button" onClick={handleStart} disabled={submitting}>
            Start Purchasing
          </button>
        </div>
      ) : (
        <p className="fo-muted">Waiting for the assigned Parts Associate to start purchasing.</p>
      )}
    </div>
  );
}

// Sprint 2.1.8 -- Purchasing Progress Update. Shown when a request is
// PURCHASING_IN_PROGRESS -- only the assigned person can actually post
// an update (firestore.rules enforces request.auth.uid ==
// assignedToUserId, same restriction as ReorderRequestStartPurchasing
// above), so anyone else viewing this screen sees the latest update
// (if any) with no form. Does not transition status -- a request can
// receive any number of updates while purchasing is in progress. Form
// fields are pre-filled from the request's current values so a second
// update doesn't require re-entering everything. Writes go exclusively
// through domain/inventoryReorderRequests.js's
// updatePurchasingProgress().
function ReorderRequestPurchasingUpdate({ request, onUpdated }) {
  const { user } = useAuth();
  const isAssignee = user?.uid === request.assignedToUserId;
  const [purchasingNotes, setPurchasingNotes] = useState(request.purchasingNotes ?? "");
  const [vendorContacted, setVendorContacted] = useState(!!request.vendorContacted);
  const [expectedAvailabilityDate, setExpectedAvailabilityDate] = useState(request.expectedAvailabilityDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updatePurchasingProgress(request.id, { purchasingNotes, vendorContacted, expectedAvailabilityDate });
      onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Purchasing In Progress</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Assigned to</td>
            <td>{request.assignedToUserId}</td>
          </tr>
          <tr>
            <td>Purchasing started</td>
            <td>{formatTimestamp(request.purchasingStartedAt)}</td>
          </tr>
          {request.lastPurchasingUpdateAt && (
            <>
              <tr>
                <td>Last update</td>
                <td>{formatTimestamp(request.lastPurchasingUpdateAt)}</td>
              </tr>
              <tr>
                <td>Updated by</td>
                <td>{request.lastPurchasingUpdateBy}</td>
              </tr>
              <tr>
                <td>Vendor contacted</td>
                <td>{request.vendorContacted ? "Yes" : "No"}</td>
              </tr>
              {request.expectedAvailabilityDate && (
                <tr>
                  <td>Expected availability</td>
                  <td>{request.expectedAvailabilityDate}</td>
                </tr>
              )}
              {request.purchasingNotes && (
                <tr>
                  <td>Notes</td>
                  <td>{request.purchasingNotes}</td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>

      {error && <p className="fo-muted">{error}</p>}

      {isAssignee ? (
        <form className="fo-form" onSubmit={handleSubmit}>
          <label htmlFor="purchasing-notes">Notes</label>
          <textarea
            id="purchasing-notes"
            value={purchasingNotes}
            onChange={(e) => setPurchasingNotes(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={vendorContacted}
              onChange={(e) => setVendorContacted(e.target.checked)}
            />
            {" "}Vendor contacted
          </label>
          <label htmlFor="expected-availability-date">Expected availability date</label>
          <input
            id="expected-availability-date"
            type="date"
            value={expectedAvailabilityDate}
            onChange={(e) => setExpectedAvailabilityDate(e.target.value)}
          />
          <div className="disp-board-toolbar">
            <button type="submit" disabled={submitting}>
              Post Update
            </button>
          </div>
        </form>
      ) : (
        <p className="fo-muted">Waiting for the assigned Parts Associate to post a purchasing update.</p>
      )}
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
          {request.purchasingStartedBy && (
            <tr>
              <td>Purchasing started by</td>
              <td>{request.purchasingStartedBy}</td>
            </tr>
          )}
          {request.purchasingStartedAt && (
            <tr>
              <td>Purchasing started</td>
              <td>{formatTimestamp(request.purchasingStartedAt)}</td>
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

// Sprint 2.1.9 -- Inventory Actions Foundation. Lets an admin/dispatcher
// record a Receive Stock/Adjust Stock/Correct Mistake action against
// this Part -- a single-step create, no approval workflow, entirely
// separate from the Reorder Request cards above. Writes go exclusively
// through domain/inventoryActions.js's recordInventoryAction(), which
// enforces (server-side validation, not just this form): Receive Stock
// requires a positive quantity, Adjust Stock allows positive or
// negative, Correct Mistake requires both a reason and notes.
function InventoryActionsPanel({ partId }) {
  const [actionType, setActionType] = useState(INVENTORY_ACTION_TYPE.RECEIVE_STOCK);
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const { data: recentActions, loading } = useInventoryActionsForPart(partId);

  const isCorrectMistake = actionType === INVENTORY_ACTION_TYPE.CORRECT_MISTAKE;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await recordInventoryAction({ partId, transactionType: actionType, quantityDelta, reason, notes });
      setQuantityDelta("");
      setReason("");
      setNotes("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Inventory Actions</h3>

      <form className="fo-form" onSubmit={handleSubmit}>
        <label htmlFor="inventory-action-type">Action</label>
        <select id="inventory-action-type" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          <option value={INVENTORY_ACTION_TYPE.RECEIVE_STOCK}>Receive Stock</option>
          <option value={INVENTORY_ACTION_TYPE.ADJUST_STOCK}>Adjust Stock</option>
          <option value={INVENTORY_ACTION_TYPE.CORRECT_MISTAKE}>Correct Mistake</option>
        </select>

        <label htmlFor="inventory-action-qty">
          {actionType === INVENTORY_ACTION_TYPE.RECEIVE_STOCK ? "Quantity received" : "Quantity change (+/-)"}
        </label>
        <input
          id="inventory-action-qty"
          type="number"
          value={quantityDelta}
          onChange={(e) => setQuantityDelta(e.target.value)}
          required
        />

        <label htmlFor="inventory-action-reason">Reason{isCorrectMistake ? " (required)" : " (optional)"}</label>
        <input
          id="inventory-action-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required={isCorrectMistake}
        />

        <label htmlFor="inventory-action-notes">Notes{isCorrectMistake ? " (required)" : " (optional)"}</label>
        <textarea
          id="inventory-action-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          required={isCorrectMistake}
        />

        {error && <p className="fo-muted">{error}</p>}

        <div className="disp-board-toolbar">
          <button type="submit" disabled={submitting}>
            Record Action
          </button>
        </div>
      </form>

      <h4>Recent Inventory Actions</h4>
      <LoadingEmptyState
        loading={loading}
        isEmpty={recentActions.length === 0}
        loadingText="Loading inventory actions..."
        emptyText="No inventory actions recorded yet."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Qty</th>
              <th>Reason</th>
              <th>By</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {recentActions.slice(0, 10).map((action) => (
              <tr key={action.id}>
                <td>{action.transactionType}</td>
                <td>{action.quantityDelta > 0 ? `+${action.quantityDelta}` : action.quantityDelta}</td>
                <td className="fo-muted">{action.reason ?? "—"}</td>
                <td className="fo-muted">{action.createdBy}</td>
                <td className="fo-muted">{formatTimestamp(action.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>
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
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE ? (
          <ReorderRequestStartPurchasing request={reorderRequest} onStarted={refreshReorderRequest} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? (
          <ReorderRequestPurchasingUpdate request={reorderRequest} onUpdated={refreshReorderRequest} />
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

      <InventoryActionsPanel partId={partId} />

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
