import { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useReorderRequestsAssignedTo, useReorderRequestById } from "../../hooks/useReorderRequests";
import { usePurchaseOrderForReorderRequest } from "../../hooks/useReorderPurchaseOrders";
import { useReorderPurchaseOrderVoid } from "../../hooks/useReorderPurchaseOrderVoids";
import {
  startPurchasing,
  updatePurchasingProgress,
  receiveReorderRequest,
  getDisplayQty,
} from "../../domain/inventoryReorderRequests";
import { recordPurchaseOrder } from "../../domain/reorderPurchaseOrders";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import OperationalCard, { OperationalCardGrid } from "../../shared/ui/OperationalCard.jsx";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";

// Issue #100 PR 3b (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) -- the
// dedicated /inventory-role/mine surface for an ACTIVE, reciprocally
// linked PARTS_ASSOCIATE technician. Route/nav gating (App.jsx,
// navConfig.js's operationalRoleAccess) already keeps this component from
// ever mounting for admin/dispatcher or an ineligible technician, so no
// role check is repeated here -- same convention PR 1b/2b already
// establish.
//
// Reuses, unchanged: useReorderRequestsAssignedTo(uid, status) (personal
// Waiting/In Progress), useReorderRequestById(requestId) (the exact
// assigned-request detail, realtime), usePurchaseOrderForReorderRequest()/
// useReorderPurchaseOrderVoid() (linked PO/void display), and the four
// existing, unmodified domain functions (startPurchasing(),
// updatePurchasingProgress(), recordPurchaseOrder(), receiveReorderRequest()).
//
// Deliberately NOT PartDetail.jsx: this is a new, minimal component that
// mounts none of PartDetail.jsx's admin/dispatcher action set --
// specifically, no Cancel and no Void trigger anywhere below, per the
// Specification's explicit exclusion ("PARTS_ASSOCIATE does not gain
// either"). A request this account no longer has any action on (admin
// cancelled/voided it, or another status this account can't act on)
// renders read-only, same terminal-card shape as PartDetail.jsx's own
// read-only cards, just without any action control.
//
// No useEmployeeDirectory() import, matching the Specification's
// standing "not imported by any new surface" rule: every actor field a
// PARTS_ASSOCIATE can ever see on their OWN assigned request is either
// themselves (every one of the four lifecycle writes is restricted to
// `auth.uid == assignedToUserId` at the Rules layer) or an admin/
// dispatcher acting on it (approved/reviewed/cancelled) -- resolving
// that second case would require the exact unscoped directory read this
// Specification's design avoids, so those fields are shown as "—" here
// rather than a raw uid or a widened read.
const HISTORY_STATUS_LABEL = {
  [REORDER_REQUEST_STATUS.CANCELLED]: "Cancelled",
  [REORDER_REQUEST_STATUS.VOIDED]: "Voided",
  [REORDER_REQUEST_STATUS.RECEIVED]: "Received",
};

function formatTimestamp(ms) {
  return ms ? new Date(ms).toLocaleString() : "—";
}

function RequestSummary({ request, resolveName }) {
  return (
    <table className="fo-table">
      <tbody>
        <tr>
          <td>Part</td>
          <td>{resolveName(request.partId)}</td>
        </tr>
        <tr>
          <td>Requested qty</td>
          <td>{getDisplayQty(request)}</td>
        </tr>
        <tr>
          <td>Urgency</td>
          <td>
            {request.urgency ? (
              <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
            ) : (
              <StatusPill tone="unknown" label="Needs planning" />
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// No onDone/onRecorded-style callback on any card below -- unlike
// PartsManagerHome.jsx's AssignPanel (a one-shot action that closes
// itself), useReorderRequestById(requestId) above is realtime: this
// panel re-renders into the NEXT status's own card automatically the
// instant a write lands, with no imperative "now refresh" signal
// needed. Passing a no-op callback here would be dead code.
function StartPurchasingCard({ request, resolveName }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      await startPurchasing(request.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Assigned to You</h3>
      <RequestSummary request={request} resolveName={resolveName} />
      {error && <p className="fo-muted">{error}</p>}
      <div className="disp-board-toolbar">
        <button type="button" onClick={handleStart} disabled={submitting}>
          {submitting ? "Starting..." : "Start Purchasing"}
        </button>
      </div>
    </div>
  );
}

function PurchasingInProgressCard({ request, resolveName }) {
  const [purchasingNotes, setPurchasingNotes] = useState(request.purchasingNotes ?? "");
  const [vendorContacted, setVendorContacted] = useState(!!request.vendorContacted);
  const [expectedAvailabilityDate, setExpectedAvailabilityDate] = useState(request.expectedAvailabilityDate ?? "");
  const [updateSubmitting, setUpdateSubmitting] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  const [supplierName, setSupplierName] = useState("");
  const [externalPoNumber, setExternalPoNumber] = useState("");
  const [orderedQuantity, setOrderedQuantity] = useState("");
  const [orderedDate, setOrderedDate] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poError, setPoError] = useState(null);

  async function handleUpdate(e) {
    e.preventDefault();
    setUpdateSubmitting(true);
    setUpdateError(null);
    try {
      await updatePurchasingProgress(request.id, { purchasingNotes, vendorContacted, expectedAvailabilityDate });
    } catch (err) {
      setUpdateError(err.message);
    } finally {
      setUpdateSubmitting(false);
    }
  }

  async function handleRecordPo(e) {
    e.preventDefault();
    const quantity = Number(orderedQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPoError("Ordered quantity must be greater than zero.");
      return;
    }
    if (expectedArrivalDate && expectedArrivalDate < orderedDate) {
      setPoError("Expected arrival date cannot be before the ordered date.");
      return;
    }
    setPoSubmitting(true);
    setPoError(null);
    try {
      await recordPurchaseOrder(request.id, {
        partId: request.partId,
        supplierName,
        externalPoNumber,
        orderedQuantity,
        orderedDate,
        expectedArrivalDate,
      });
    } catch (err) {
      setPoError(err.message);
      setPoSubmitting(false);
    }
  }

  return (
    <>
      <div className="fo-card">
        <h3>Reorder Request -- Purchasing In Progress</h3>
        <RequestSummary request={request} resolveName={resolveName} />
        <table className="fo-table">
          <tbody>
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

        {updateError && <p className="fo-muted">{updateError}</p>}
        <form className="fo-form" onSubmit={handleUpdate}>
          <label htmlFor="pa-purchasing-notes">Notes</label>
          <textarea id="pa-purchasing-notes" value={purchasingNotes} onChange={(e) => setPurchasingNotes(e.target.value)} />
          <label>
            <input type="checkbox" checked={vendorContacted} onChange={(e) => setVendorContacted(e.target.checked)} /> Vendor
            contacted
          </label>
          <label htmlFor="pa-expected-availability">Expected availability date</label>
          <input
            id="pa-expected-availability"
            type="date"
            value={expectedAvailabilityDate}
            onChange={(e) => setExpectedAvailabilityDate(e.target.value)}
          />
          <div className="disp-board-toolbar">
            <button type="submit" disabled={updateSubmitting}>
              {updateSubmitting ? "Posting..." : "Post Update"}
            </button>
          </div>
        </form>
      </div>

      <div className="fo-card">
        <h3>Record Purchase Order</h3>
        <form className="fo-form" onSubmit={handleRecordPo}>
          {/* DEFERRED FOLLOW-ON (tracked, intentional): this PARTS_ASSOCIATE PO surface still captures the
              supplier as FREE TEXT, unlike the governed Supplier picker on the admin/dispatcher path
              (PartDetail's ReorderRequestRecordPurchaseOrder). It is NOT converted here because the
              `suppliers` read is Rules-gated to admin/dispatcher and this increment must NOT widen the
              legacy supplier read for PARTS_ASSOCIATE. Governed supplier selection for this role is
              resolved through the future governed catalog-read / purchasing authorization model (R-1), not
              by growing the legacy surface. See docs/architecture/part-supplier-items-procurement-terms-design.md. */}
          <label htmlFor="pa-po-supplier">Supplier name</label>
          <input id="pa-po-supplier" type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required />

          <label htmlFor="pa-po-number">External PO/reference number</label>
          <input id="pa-po-number" type="text" value={externalPoNumber} onChange={(e) => setExternalPoNumber(e.target.value)} required />

          <label htmlFor="pa-po-qty">Ordered quantity</label>
          <input
            id="pa-po-qty"
            type="number"
            min="1"
            step="any"
            value={orderedQuantity}
            onChange={(e) => setOrderedQuantity(e.target.value)}
            required
          />

          <label htmlFor="pa-po-ordered-date">Ordered date</label>
          <input id="pa-po-ordered-date" type="date" value={orderedDate} onChange={(e) => setOrderedDate(e.target.value)} required />

          <label htmlFor="pa-po-expected-arrival">Expected arrival date (optional)</label>
          <input id="pa-po-expected-arrival" type="date" value={expectedArrivalDate} onChange={(e) => setExpectedArrivalDate(e.target.value)} />

          {poError && <p className="fo-muted" role="alert">{poError}</p>}

          <div className="disp-board-toolbar">
            <button type="submit" disabled={poSubmitting}>
              {poSubmitting ? "Recording..." : "Record Purchase Order"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function OrderedCard({ request, resolveName }) {
  const { data: purchaseOrder, loading } = usePurchaseOrderForReorderRequest(request.id);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleReceive() {
    setSubmitting(true);
    setError(null);
    try {
      await receiveReorderRequest(request.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Ordered</h3>
      <RequestSummary request={request} resolveName={resolveName} />
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Ordered</td>
            <td>{formatTimestamp(request.orderedAt)}</td>
          </tr>
        </tbody>
      </table>
      {loading ? (
        <p className="fo-muted">Loading Purchase Order...</p>
      ) : purchaseOrder ? (
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Supplier</td>
              <td>{purchaseOrder.supplierName}</td>
            </tr>
            <tr>
              <td>PO / reference #</td>
              <td>{purchaseOrder.externalPoNumber}</td>
            </tr>
            <tr>
              <td>Ordered quantity</td>
              <td>{purchaseOrder.orderedQuantity}</td>
            </tr>
            <tr>
              <td>Ordered date</td>
              <td>{purchaseOrder.orderedDate}</td>
            </tr>
            {purchaseOrder.expectedArrivalDate && (
              <tr>
                <td>Expected arrival</td>
                <td>{purchaseOrder.expectedArrivalDate}</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <p className="fo-muted">Purchase Order details unavailable.</p>
      )}
      <p className="fo-muted">
        Marking this received records that the parts arrived and closes out this Reorder Request. It does not update
        stock yet -- stock reconciliation against this receipt is a separate, not-yet-built step.
      </p>
      {error && <p className="fo-muted">{error}</p>}
      <div className="disp-board-toolbar">
        <button type="button" onClick={handleReceive} disabled={submitting}>
          {submitting ? "Recording..." : "Mark Received"}
        </button>
      </div>
    </div>
  );
}

function TerminalCard({ request, resolveName }) {
  const { data: voidRecord } = useReorderPurchaseOrderVoid(request.status === REORDER_REQUEST_STATUS.VOIDED ? request.id : null);

  return (
    <div className="fo-card">
      <h3>Reorder Request -- {HISTORY_STATUS_LABEL[request.status] ?? request.status}</h3>
      <RequestSummary request={request} resolveName={resolveName} />
      {request.status === REORDER_REQUEST_STATUS.CANCELLED && (
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Cancelled</td>
              <td>{formatTimestamp(request.cancelledAt)}</td>
            </tr>
            <tr>
              <td>Reason</td>
              <td>{request.cancellationReason ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
      {request.status === REORDER_REQUEST_STATUS.VOIDED && (
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Voided</td>
              <td>{formatTimestamp(request.voidedAt)}</td>
            </tr>
            <tr>
              <td>Reason</td>
              <td>{voidRecord?.reason ?? request.voidReason ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
      {request.status === REORDER_REQUEST_STATUS.RECEIVED && (
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Received</td>
              <td>{formatTimestamp(request.receivedAt)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function AssignedRequestDetail({ requestId, resolveName, onClose }) {
  const { data: request, loading, error } = useReorderRequestById(requestId);

  if (loading) {
    return (
      <div className="fo-card">
        <p className="fo-muted">Loading request...</p>
      </div>
    );
  }
  if (error && error !== "not_found") {
    return (
      <div className="fo-card">
        <p className="fo-muted" role="alert">Unable to load this request right now. Close it and try again.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (!request || error === "not_found") {
    return (
      <div className="fo-card">
        <p className="fo-muted">This request is no longer available.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="fo-workspace-header">
        <h3 className="fo-workspace-header-title">Request Detail</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {request.status === REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE && (
        <StartPurchasingCard request={request} resolveName={resolveName} />
      )}
      {request.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS && (
        <PurchasingInProgressCard request={request} resolveName={resolveName} />
      )}
      {request.status === REORDER_REQUEST_STATUS.ORDERED && <OrderedCard request={request} resolveName={resolveName} />}
      {[REORDER_REQUEST_STATUS.RECEIVED, REORDER_REQUEST_STATUS.CANCELLED, REORDER_REQUEST_STATUS.VOIDED].includes(request.status) && (
        <TerminalCard request={request} resolveName={resolveName} />
      )}
      {![
        REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
        REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
        REORDER_REQUEST_STATUS.ORDERED,
        REORDER_REQUEST_STATUS.RECEIVED,
        REORDER_REQUEST_STATUS.CANCELLED,
        REORDER_REQUEST_STATUS.VOIDED,
      ].includes(request.status) && (
        <div className="fo-card">
          <h3>Request Detail</h3>
          <RequestSummary request={request} resolveName={resolveName} />
          <p className="fo-muted" role="status">
            This request is no longer in a purchasing status available on this screen.
          </p>
        </div>
      )}
    </div>
  );
}

// Each Reorder Request assigned to this account is a bounded peer object (a short,
// browseable "my assigned work" list, not a dense scan-to-compare table) -- rendered as an
// OperationalCard in `actions` mode so the existing "View {name}" button (its exact
// aria-label is a test hook) keeps its own accessible name, outside any interactive
// card wrapper.
function RequestCards({ requests, resolveName, onSelect }) {
  return (
    <OperationalCardGrid aria-label="Reorder requests">
      {requests.map((request) => (
        <li key={request.id}>
          <OperationalCard
            title={resolveName(request.partId)}
            status={
              request.urgency
                ? { tone: inventoryUrgencyTone(request.urgency), label: request.urgency }
                : { tone: "unknown", label: "Needs planning" }
            }
            metadata={[{ key: "qty", label: "Qty", value: getDisplayQty(request) }]}
            actions={
              <button
                type="button"
                aria-label={`View ${resolveName(request.partId)}`}
                onClick={(e) => onSelect(request.id, e.currentTarget)}
              >
                View
              </button>
            }
          />
        </li>
      ))}
    </OperationalCardGrid>
  );
}

export default function PartsAssociateHome({ accessVersion } = {}) {
  const { user } = useAuth();
  // OD-3: canonical part-name resolution (fail-closed; degrades to raw partId, never
  // the static-catalog name). Does not gate any operational table below. `accessVersion`
  // is threaded from App so an access change re-runs the read and invalidates the prior
  // name map before the replacement read settles.
  const { resolveName, namesUnavailable } = useCanonicalPartNames({ uid: user?.uid, accessVersion });
  const { data: waiting, loading: waitingLoading, error: waitingError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE
  );
  const { data: inProgress, loading: inProgressLoading, error: inProgressError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS
  );
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  // Focus restoration: the triggering "View" button that opened the
  // inline Request Detail panel, so closing it returns focus there
  // instead of dropping it to <body> -- same convention
  // WarehouseManagerHome.jsx/PartsManagerHome.jsx already establish.
  const lastTriggerRef = useRef(null);

  function handleSelect(requestId, triggerEl) {
    lastTriggerRef.current = triggerEl;
    setSelectedRequestId(requestId);
  }

  function handleCloseDetail() {
    setSelectedRequestId(null);
    lastTriggerRef.current?.focus();
  }

  const context = (
    <ContextBand
      items={[
        { key: "waiting", label: "Waiting", value: waiting.length },
        { key: "inProgress", label: "In Progress", value: inProgress.length },
      ]}
    />
  );

  return (
    <WorkspaceShell title="My Purchasing" context={context}>
      <p className="fo-muted">Reorder Requests currently assigned to you.</p>

      {namesUnavailable && (
        <p className="fo-muted" role="status">Some part names are unavailable; Part IDs are shown.</p>
      )}

      <h3>Waiting</h3>
      <LoadingEmptyState
        loading={waitingLoading}
        isEmpty={waiting.length === 0}
        loadingText="Loading your assigned requests..."
        emptyText={waitingError ? "Unable to load your assigned requests right now. Try again shortly." : "No requests currently waiting on you."}
      >
        <RequestCards requests={waiting} resolveName={resolveName} onSelect={handleSelect} />
      </LoadingEmptyState>

      <h3>In Progress</h3>
      <LoadingEmptyState
        loading={inProgressLoading}
        isEmpty={inProgress.length === 0}
        loadingText="Loading your in-progress purchasing..."
        emptyText={inProgressError ? "Unable to load your in-progress purchasing right now. Try again shortly." : "No purchasing currently in progress."}
      >
        <RequestCards requests={inProgress} resolveName={resolveName} onSelect={handleSelect} />
      </LoadingEmptyState>

      {selectedRequestId && (
        <AssignedRequestDetail requestId={selectedRequestId} resolveName={resolveName} onClose={handleCloseDetail} />
      )}
    </WorkspaceShell>
  );
}
