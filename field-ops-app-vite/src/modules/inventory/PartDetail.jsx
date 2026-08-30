import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import UsedInEquipmentSection from "./UsedInEquipmentSection";
import PartIdentifiersSection from "../../shared/partMaster/PartIdentifiersSection.jsx";
import PartWorkOrderDemandSection from "./PartWorkOrderDemandSection";
import {
  buildPartDetailView,
  selectPartLedger,
  isPartDetailBlocked,
  partDetailBlockedMessage,
} from "../../domain/partDetailView";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { hasUsageHistory } from "../../domain/inventoryAnalyticsEngine";
import { useReorderRequestForPart } from "../../hooks/useReorderRequests";
import { useInventoryActionsForPart } from "../../hooks/useInventoryActions";
import { usePurchaseOrderForReorderRequest } from "../../hooks/useReorderPurchaseOrders";
import { useReorderPurchaseOrderVoid } from "../../hooks/useReorderPurchaseOrderVoids";
import { useEmployeeDirectory, resolveActorDisplayName } from "../../hooks/useEmployeeDirectory";
import {
  reviewReorderRequest,
  assignReorderRequest,
  startPurchasing,
  updatePurchasingProgress,
  requestReorderForRecommendation,
  receiveReorderRequest,
  cancelReorderRequest,
  getDisplayQty,
} from "../../domain/inventoryReorderRequests";
import { recordInventoryAction } from "../../domain/inventoryActions";
import { recordPurchaseOrder, voidPurchaseOrder } from "../../domain/reorderPurchaseOrders";
import { useSuppliers } from "../../hooks/useSuppliers";
import SupplierPicker from "../../shared/supplier/SupplierPicker";
import { isSelectableSupplier } from "../../domain/supplierPicker";
import { REORDER_REQUEST_STATUS, INVENTORY_ACTION_TYPE, OPERATIONAL_ROLE } from "../../domain/constants";
import { useAuth } from "../../auth/AuthContext";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import FailureState from "../../shared/ui/FailureState";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";
import { FormError } from "../../shared/ui/form";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import RequestReorderControl from "../../shared/inventory/RequestReorderControl";
import EmployeeAssignmentPicker from "../../shared/assignment/EmployeeAssignmentPicker";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import PartWriteModal from "../../shared/partMaster/PartWriteModal.jsx";
import { useManufacturerCatalog } from "../../hooks/useManufacturerCatalog";
import { MANUFACTURER_CATALOG_VIEW_STATE, manufacturerCatalogViewState, manufacturerNameById } from "../../domain/manufacturerCatalogView";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";
import { Button } from "../../shared/ui/primitives/index.js";

// Sprint 2.1.1 -- Inventory Domain Foundation. Part detail screen,
// reached from PartsList.jsx or Global Search.
//
// INV-CONVERGENCE-E C2 -- catalog metadata NO LONGER comes from the static
// per-sku catalog lookup. It is the GOVERNED compatibility-adapter output: the live
// canonical `parts` read (fetchPartMasterList, PR 1.9 -- the same authorized
// one-shot read C1 uses, no new query surface) composed with the static catalog
// through buildPartsWorkspace(), via the pure domain/partDetailView.js. The static
// PARTS_CATALOG remains the compatibility INPUT to that composition, not a parallel
// source of truth. Canonical is authoritative; a denied / unavailable / malformed /
// incomplete canonical read renders an explicit BLOCKED state with NO page body and
// NO write surface (never a silent static fallback, never a partial page).
//
// C2 re-points metadata and the ledger key TOGETHER: stock position/usage/
// recommendation and transaction history still come from useInventoryLedger() --
// the same one-shot read + pure analytics functions PartsList.jsx and
// Operations.jsx both use -- but are now selected by the RESOLVED governed
// identity (selectPartLedger), so metadata and ledger cannot diverge. Same
// equality test, same sort, same 20-row cap. No new Firestore query, no new
// computed math, and every reorder / PO / receive / cancel / void / inventory-
// action write surface below is unchanged.
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
// Action Log" card (InventoryActionsPanel, below) -- entirely separate
// from the Reorder Request cards above and unrelated to their status
// branch. Lets an admin/dispatcher log a Receive Stock/Adjust
// Stock/Correct Mistake note against this Part directly (no approval
// workflow, no status machine -- a single-step create, same posture as
// a ledger entry). Writes go exclusively through
// domain/inventoryActions.js's recordInventoryAction(), into a NEW
// collection (inventory_actions) deliberately separate from
// inventory_transactions (Epic 2D/3, the Work Order-driven ledger,
// untouched by this sprint). Shows recent actions for this Part,
// realtime, via hooks/useInventoryActions.js.
//
// **Logged-only, not applied to stock**: per ChatGPT's PR #76 review,
// this card and its UI copy are deliberately explicit that these are
// audit notes, not live inventory adjustments -- applying them to the
// real ledger needs a trusted, Cloud-Function-mediated write path,
// blocked on enabling Firebase Blaze (a standing platform decision,
// not something this sprint should build around). See
// InventoryActionsPanel's own comment below for the full reasoning.
//
// Sprint 2.1.10 -- Purchase Order Foundation. Status branch is now
// six-way: adds PURCHASING_IN_PROGRESS -> renders BOTH
// ReorderRequestPurchasingUpdate (unchanged) AND a new
// ReorderRequestRecordPurchaseOrder card (assignee-only form) side by
// side -- posting a progress update and recording the Purchase Order
// are independent actions available at the same status, not
// alternatives. Adds ORDERED -> new ReorderRequestOrdered card,
// showing the linked Reorder Purchase Order's details (realtime via
// hooks/useReorderPurchaseOrders.js). Writes go exclusively through
// domain/reorderPurchaseOrders.js's recordPurchaseOrder(), which
// atomically creates the Reorder Purchase Order record AND transitions
// this Reorder Request to ORDERED in one Firestore transaction -- see
// that file's own comment for the full atomicity design. This is
// deliberately a NEW, separate collection (reorder_purchase_orders),
// not the existing purchase_orders collection (Epic 5, Procurement +
// Supplier Management) -- see domain/constants.js's comment for why.
function formatTimestamp(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

// INV-CONVERGENCE-E C2 -- null-safe money render. The composed Catalog card values
// (cost/price) remain the unchanged STATIC_FALLBACK numbers; this only avoids a
// hard crash if a value is ever absent, rather than rendering a partial/broken page.
function money(n) {
  return typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Mandated verbatim by the
// Specification's UI impact section -- a future copy edit must change
// this one constant, not any of the call sites below.
const CANCEL_VOID_CONFIRMATION_COPY =
  "This action does not delete history. The record will remain visible for audit purposes.";

// Site-work r4 C, Fix 1: mirrors PartsList.jsx's pendingRequests-style scoping --
// a Reorder Request only blocks a NEW request while it is still active. Previously
// this page gated "Request Reorder" on plain !reorderRequest, and
// useReorderRequestForPart() returns the most-recent request for the part
// REGARDLESS of status, so once that most-recent request reached a terminal status
// (RECEIVED/CANCELLED/REJECTED/VOIDED) the button never came back -- a dead end.
// A part whose only request(s) are terminal is requestable again.
const TERMINAL_REORDER_REQUEST_STATUSES = new Set([
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.CANCELLED,
  REORDER_REQUEST_STATUS.REJECTED,
  REORDER_REQUEST_STATUS.VOIDED,
]);

// Cancel is available from all three pre-order active statuses, for
// any isAdminOrDispatcher() reader -- unrestricted to a specific
// individual (matches every other hand-off-type action on this
// object). No client-side role check beyond what already gates
// reaching this screen (ROLE_NAV_ACCESS restricts Inventory nav to
// admin/dispatcher already -- see the run-field-ops-app-vite skill's
// Gotchas) -- firestore.rules is the actual enforcement, same posture
// as every other write on this object.
function CancelReorderRequestAction({ request, onCancelled }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="disp-board-toolbar">
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Cancel Reorder Request</Button>
      {open && (
        <ConfirmDialog
          title="Cancel Reorder Request"
          consequence={CANCEL_VOID_CONFIRMATION_COPY}
          confirmLabel="Cancel Reorder Request"
          requireReason
          reasonLabel="Reason"
          onConfirm={async (reason) => {
            // Same payload + callback as before; the required nonblank reason is
            // guaranteed by ConfirmDialog. firestore.rules still authorizes the write.
            await cancelReorderRequest(request.id, { reason });
            setOpen(false);
            onCancelled();
          }}
          onClose={() => setOpen(false)}
          mapError={workflowActionErrorMessage}
        />
      )}
    </div>
  );
}

// Void is available only at ORDERED, only to the current assignee
// (isAdminOrDispatcher() AND request.auth.uid == assignedToUserId --
// BOTH required, per the Specification's corrected Authorization
// section). Client-side checks assignee identity only, same posture
// as every assignee-restricted action on this object
// (ReorderRequestStartPurchasing, ReorderRequestMarkReceived) --
// firestore.rules enforces both conditions server-side.
function VoidPurchaseOrderAction({ request, onVoided }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const isAssignee = user?.uid === request.assignedToUserId;
  if (!isAssignee) return null; // assignee-only UI restriction preserved (Rules enforce it too)

  return (
    <div className="disp-board-toolbar">
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Void Purchase Order</Button>
      {open && (
        <ConfirmDialog
          title="Void Purchase Order"
          consequence={CANCEL_VOID_CONFIRMATION_COPY}
          confirmLabel="Void Purchase Order"
          requireReason
          reasonLabel="Reason"
          onConfirm={async (reason) => {
            await voidPurchaseOrder(request.id, { reason });
            setOpen(false);
            onVoided();
          }}
          onClose={() => setOpen(false)}
          mapError={workflowActionErrorMessage}
        />
      )}
    </div>
  );
}

// Zero-history reorder behavior sprint, PR 3 -- request.recommendedQty
// is now strictly the analytics engine's historical snapshot (null for
// a NEEDS_PLANNING request). request.requestedQty is the actionable
// quantity on every NEW document, but is undefined on any document
// written before this PR's writer change (including the still-live
// transitional legacy branch, PR #91) -- getDisplayQty(request)
// (domain/inventoryReorderRequests.js) falls back to recommendedQty
// for those, so a legacy/transitional request never displays blank.
// request.urgency is null for NEEDS_PLANNING -- shown as a distinct
// badge, not a crash.
function ReorderRequestReview({ request, onReviewed }) {
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Approve stays IMMEDIATE and unchanged -- no confirmation.
  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await reviewReorderRequest(request.id, { decision: REORDER_REQUEST_STATUS.APPROVED });
      onReviewed();
    } catch (err) {
      setError(workflowActionErrorMessage(err));
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
            <td>Requested qty</td>
            <td>{getDisplayQty(request)}</td>
          </tr>
          <tr>
            <td>Recommendation status</td>
            <td>{request.recommendationStatus ?? "—"}</td>
          </tr>
          <tr>
            <td>Quantity source</td>
            <td>{request.quantitySource ?? "—"}</td>
          </tr>
          <tr>
            <td>Recommended qty (historical snapshot)</td>
            <td>{request.recommendedQty ?? "—"}</td>
          </tr>
          <tr>
            <td>Risk at request time</td>
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

      <FormError role="alert">{error}</FormError>

      <div className="disp-board-toolbar">
        <Button type="button" variant="primary" onClick={handleApprove} disabled={submitting}>
          Approve
        </Button>
        <Button type="button" variant="destructive" onClick={() => { setError(null); setConfirmingReject(true); }} disabled={submitting}>
          Reject
        </Button>
      </div>

      {confirmingReject && (
        <ConfirmDialog
          title="Reject Reorder Request"
          consequence="This rejects the reorder request. The record remains visible for audit purposes."
          confirmLabel="Confirm Rejection"
          requireReason
          reasonLabel="Review notes (required to reject)"
          reasonRequiredMessage="Enter review notes to reject."
          onConfirm={async (notes) => {
            // Exact Reject payload + transition preserved.
            await reviewReorderRequest(request.id, { decision: REORDER_REQUEST_STATUS.REJECTED, notes });
            setConfirmingReject(false);
            onReviewed();
          }}
          onClose={() => setConfirmingReject(false)}
          mapError={workflowActionErrorMessage}
        />
      )}
    </div>
  );
}

// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Shown
// when a request is READY_FOR_PARTS_MANAGER. Uses the shared
// EmployeeAssignmentPicker so managers select an active, linked
// Employee by display name; the canonical User ID remains internal and
// is passed to the existing assignment domain function.
//
// requiredOperationalRole: OPERATIONAL_ROLE.PARTS_ASSOCIATE (added
// after PR #105 -- governance correction) restricts selectable
// employees to those actually meant to receive assignments. Before
// this, the picker had no eligibility filter at all: any ACTIVE
// Employee with a linked userId appeared as selectable, including an
// Owner, a Driver, or anyone else with no Parts Associate
// responsibility. This is a UX-level restriction only, same "nicety,
// not the enforcement boundary" posture as
// shared/inventory/RequestReorderControl.jsx's client-side
// eligibility mirror -- firestore.rules' READY_FOR_PARTS_MANAGER ->
// ASSIGNED_TO_PARTS_ASSOCIATE transition validates only that
// assignedToUserId is a non-empty string, not the target's
// operationalRoles. A rules-level enforcement equivalent to
// canSubmitManualZeroHistoryQuantity() does not exist for this
// transition and is not added here -- flagged as a known,
// intentional gap, not fixed in this correction.
function ReorderRequestAssignment({ request, onAssigned }) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function handleEmployeeSelect(employee) {
    setSelectedEmployeeId(employee.employeeId);
    setAssignedToUserId(employee.userId);
  }

  async function handleAssign(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await assignReorderRequest(request.id, { assignedToUserId });
      onAssigned();
    } catch (err) {
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
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

      {error && <p className="fo-muted">{error}</p>}

      <form className="fo-form" onSubmit={handleAssign}>
        <EmployeeAssignmentPicker
          requiredOperationalRole={OPERATIONAL_ROLE.PARTS_ASSOCIATE}
          selectedEmployeeId={selectedEmployeeId}
          onSelect={handleEmployeeSelect}
          disabled={submitting}
          label="Assign to Parts Associate"
          placeholder="Search employees by name..."
        />
        <div className="disp-board-toolbar">
          <Button type="submit" variant="primary" disabled={submitting || !assignedToUserId}>
            Assign
          </Button>
        </div>
      </form>

      <CancelReorderRequestAction request={request} onCancelled={onAssigned} />
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
function ReorderRequestStartPurchasing({ request, onStarted, employeeDirectory }) {
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
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
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
            <td>{resolveActorDisplayName(request.assignedToUserId, employeeDirectory)}</td>
          </tr>
          <tr>
            <td>Assigned</td>
            <td>{formatTimestamp(request.assignedAt)}</td>
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

      {error && <p className="fo-muted">{error}</p>}

      {isAssignee ? (
        <div className="disp-board-toolbar">
          <Button type="button" variant="primary" onClick={handleStart} disabled={submitting}>
            Start Purchasing
          </Button>
        </div>
      ) : (
        <p className="fo-muted">Waiting for the assigned Parts Associate to start purchasing.</p>
      )}

      <CancelReorderRequestAction request={request} onCancelled={onStarted} />
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
function ReorderRequestPurchasingUpdate({ request, onUpdated, employeeDirectory }) {
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
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
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
            <td>{resolveActorDisplayName(request.assignedToUserId, employeeDirectory)}</td>
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
                <td>{resolveActorDisplayName(request.lastPurchasingUpdateBy, employeeDirectory)}</td>
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
            <Button type="submit" variant="primary" disabled={submitting}>
              Post Update
            </Button>
          </div>
        </form>
      ) : (
        <p className="fo-muted">Waiting for the assigned Parts Associate to post a purchasing update.</p>
      )}

      <CancelReorderRequestAction request={request} onCancelled={onUpdated} />
    </div>
  );
}

// Sprint 2.1.10 -- Purchase Order Foundation. Shown alongside
// ReorderRequestPurchasingUpdate (above) whenever a request is
// PURCHASING_IN_PROGRESS -- an independent action, not an alternative
// to posting a progress update. Only the assigned person can actually
// record a Purchase Order (firestore.rules enforces
// request.auth.uid == assignedToUserId, same restriction as every
// other action since Sprint 2.1.7); non-assignees see nothing extra
// here (ReorderRequestPurchasingUpdate's own passive message already
// covers "waiting on the assignee" for this status). Writes go
// exclusively through domain/reorderPurchaseOrders.js's
// recordPurchaseOrder(), which atomically creates the Reorder Purchase
// Order record and transitions the Reorder Request to ORDERED in one
// Firestore transaction.
function ReorderRequestRecordPurchaseOrder({ request, onRecorded, accessVersion }) {
  const { user } = useAuth();
  const isAssignee = user?.uid === request.assignedToUserId;
  // Governed supplier SELECTION (admin/dispatcher PO path): the supplier comes from the ONE governed
  // Supplier read model, not free text. `selectedSupplier` holds the chosen governed ENTITY; only its
  // NAME is persisted for now (existing supplierName schema), and the entity-based state keeps the future
  // supplierId + supplierNameSnapshot evolution from needing an interaction redesign. FAIL-CLOSED: if the
  // supplier read is denied/unavailable, the picker says so and there is no free-text fallback -- submit
  // stays disabled. NOTE: `suppliers` read is Rules-gated to admin/dispatcher; a PARTS_ASSOCIATE assignee
  // gets a denied state here (the separately-governed PARTS_ASSOCIATE PO surface is a future follow-on --
  // it must NOT widen the legacy supplier read; it awaits the governed catalog-read/purchasing model).
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const suppliersRead = useSuppliers(accessVersion);
  const [externalPoNumber, setExternalPoNumber] = useState("");
  const [orderedQuantity, setOrderedQuantity] = useState("");
  const [orderedDate, setOrderedDate] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isAssignee) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    // Never trust a bare name: the persisted supplierName MUST come from the selected ACTIVE governed
    // entity, not an editable text value.
    if (!isSelectableSupplier(selectedSupplier)) {
      setError("Select an active supplier before recording the purchase order.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recordPurchaseOrder(request.id, {
        partId: request.partId,
        supplierName: selectedSupplier.name,
        externalPoNumber,
        orderedQuantity,
        orderedDate,
        expectedArrivalDate,
      });
      onRecorded();
    } catch (err) {
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Record Purchase Order</h3>
      <form className="fo-form" onSubmit={handleSubmit}>
        <label htmlFor="po-supplier-name">Supplier</label>
        <SupplierPicker
          inputId="po-supplier-name"
          loading={suppliersRead.loading}
          error={suppliersRead.error}
          suppliers={suppliersRead.suppliers}
          selected={selectedSupplier}
          onSelect={setSelectedSupplier}
        />

        <label htmlFor="po-external-number">External PO/reference number</label>
        <input
          id="po-external-number"
          type="text"
          value={externalPoNumber}
          onChange={(e) => setExternalPoNumber(e.target.value)}
          required
        />

        <label htmlFor="po-ordered-qty">Ordered quantity</label>
        <input
          id="po-ordered-qty"
          type="number"
          value={orderedQuantity}
          onChange={(e) => setOrderedQuantity(e.target.value)}
          required
        />

        <label htmlFor="po-ordered-date">Ordered date</label>
        <input
          id="po-ordered-date"
          type="date"
          value={orderedDate}
          onChange={(e) => setOrderedDate(e.target.value)}
          required
        />

        <label htmlFor="po-expected-arrival">Expected arrival date (optional)</label>
        <input
          id="po-expected-arrival"
          type="date"
          value={expectedArrivalDate}
          onChange={(e) => setExpectedArrivalDate(e.target.value)}
        />

        {error && <p className="fo-muted">{error}</p>}

        <div className="disp-board-toolbar">
          {/* Submit is disabled until an ACTIVE governed supplier is selected -- no free-text bypass. */}
          <Button type="submit" variant="primary" disabled={submitting || !isSelectableSupplier(selectedSupplier)}>
            Record Purchase Order
          </Button>
        </div>
      </form>
    </div>
  );
}

// Sprint 2.1.10 -- Purchase Order Foundation. Shown once a request is
// ORDERED -- displays the linked Reorder Purchase Order's details,
// realtime, via hooks/useReorderPurchaseOrders.js. Read-only: no
// further action on the Purchase Order exists this sprint
// (reassignment/receiving/etc. are all explicitly out of scope).
function ReorderRequestOrdered({ request, employeeDirectory, onVoided }) {
  const { data: purchaseOrder, loading, error: purchaseOrderError } = usePurchaseOrderForReorderRequest(request.id);

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Ordered</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Ordered by</td>
            <td>{resolveActorDisplayName(request.orderedBy, employeeDirectory)}</td>
          </tr>
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
      ) : purchaseOrderError && purchaseOrderError !== "not_found" ? (
        // H14 (reorder pair) -- a denied/failed read used to render the SAME
        // "details unavailable" copy as a genuine not-yet-recorded PO. Fail
        // visibly instead: "you cannot see it" is not "there is nothing to see".
        <FailureState message="You don't have permission to view this Purchase Order." />
      ) : (
        <p className="fo-muted">Purchase Order details unavailable.</p>
      )}

      <VoidPurchaseOrderAction request={request} onVoided={onVoided} />
    </div>
  );
}

// Sprint 2.1.11 -- Receiving (Reorder Request closeout). Shown
// alongside ReorderRequestOrdered whenever a request is ORDERED --
// same assignee-only restriction as every write on this object since
// Sprint 2.1.7 (firestore.rules enforces request.auth.uid ==
// assignedToUserId). This is a status-closeout note only -- it does
// NOT change any real stock count (does not call
// recordInventoryAction() or touch inventory_transactions), same
// posture Sprint 2.1.9's Inventory Action Log card states explicitly
// below. Reconciling this against real stock is a separate,
// Blaze-blocked backlog item, not this sprint's concern.
function ReorderRequestMarkReceived({ request, onReceived }) {
  const { user } = useAuth();
  const isAssignee = user?.uid === request.assignedToUserId;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isAssignee) return null;

  async function handleReceive() {
    setSubmitting(true);
    setError(null);
    try {
      await receiveReorderRequest(request.id);
      onReceived();
    } catch (err) {
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Mark Received</h3>
      <p className="fo-muted">
        This records that the parts arrived and closes out this Reorder Request. It does not update stock yet --
        stock reconciliation against this receipt is a separate, not-yet-built step.
      </p>
      {error && <p className="fo-muted">{error}</p>}
      <div className="disp-board-toolbar">
        <Button type="button" variant="primary" onClick={handleReceive} disabled={submitting}>
          Mark Received
        </Button>
      </div>
    </div>
  );
}

// Sprint 2.1.11 -- Receiving (Reorder Request closeout). Terminal,
// read-only card once RECEIVED -- no further action on this Reorder
// Request exists.
function ReorderRequestReceived({ request, employeeDirectory }) {
  return (
    <div className="fo-card">
      <h3>Reorder Request -- Received</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Received by</td>
            <td>{resolveActorDisplayName(request.receivedBy, employeeDirectory)}</td>
          </tr>
          <tr>
            <td>Received</td>
            <td>{formatTimestamp(request.receivedAt)}</td>
          </tr>
        </tbody>
      </table>
      <p className="fo-muted">This records that the parts arrived. It does not update stock yet.</p>
    </div>
  );
}

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Terminal, read-only card once
// CANCELLED -- no further action on this Reorder Request exists.
function ReorderRequestCancelled({ request, employeeDirectory }) {
  return (
    <div className="fo-card">
      <h3>Reorder Request -- Cancelled</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Cancelled by</td>
            <td>{resolveActorDisplayName(request.cancelledBy, employeeDirectory)}</td>
          </tr>
          <tr>
            <td>Cancelled</td>
            <td>{formatTimestamp(request.cancelledAt)}</td>
          </tr>
          <tr>
            <td>Reason</td>
            <td>{request.cancellationReason}</td>
          </tr>
        </tbody>
      </table>
      <p className="fo-muted">{CANCEL_VOID_CONFIRMATION_COPY}</p>
    </div>
  );
}

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Terminal, read-only card once
// VOIDED -- no further action on this Reorder Request exists. Reads
// TWO separate realtime sources, neither of which this card (or
// anything else in this sprint) ever writes to:
//   - hooks/useReorderPurchaseOrders.js's usePurchaseOrderForReorderRequest()
//     -- the SAME hook/read ReorderRequestOrdered used above, before
//     the transition. The Specification requires the original,
//     immutable Purchase Order's own details (supplier, PO number,
//     quantity, ordered date) remain visible as read-only audit
//     information after Void, not just a linked-record pointer --
//     `reorder_purchase_orders` itself is never mutated by Void (see
//     domain/reorderPurchaseOrders.js's voidPurchaseOrder() -- it
//     reads this document to validate, never writes it), so re-using
//     the same hook here proves the read, not a stale snapshot.
//   - hooks/useReorderPurchaseOrderVoids.js's useReorderPurchaseOrderVoid()
//     -- the separate, append-only void record itself.
function ReorderRequestVoided({ request, employeeDirectory }) {
  const {
    data: purchaseOrder,
    loading: purchaseOrderLoading,
    error: purchaseOrderError,
  } = usePurchaseOrderForReorderRequest(request.id);
  const {
    data: voidRecord,
    loading: voidRecordLoading,
    error: voidRecordError,
  } = useReorderPurchaseOrderVoid(request.id);

  return (
    <div className="fo-card">
      <h3>Reorder Request -- Voided</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Voided by</td>
            <td>{resolveActorDisplayName(request.voidedBy, employeeDirectory)}</td>
          </tr>
          <tr>
            <td>Voided</td>
            <td>{formatTimestamp(request.voidedAt)}</td>
          </tr>
          <tr>
            <td>Reason</td>
            <td>{request.voidReason}</td>
          </tr>
        </tbody>
      </table>

      <h4>Original Purchase Order (unchanged, read-only)</h4>
      {purchaseOrderLoading ? (
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
      ) : purchaseOrderError && purchaseOrderError !== "not_found" ? (
        // H14 (reorder pair) -- see ReorderRequestOrdered above: a denied/failed
        // read must not render the same copy as a genuinely absent record.
        <FailureState message="You don't have permission to view this Purchase Order." />
      ) : (
        <p className="fo-muted">Purchase Order details unavailable.</p>
      )}

      {voidRecordLoading ? (
        <p className="fo-muted">Loading void record...</p>
      ) : voidRecord ? (
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Linked Purchase Order</td>
              <td>{voidRecord.reorderPurchaseOrderId}</td>
            </tr>
            <tr>
              <td>Void record created</td>
              <td>{formatTimestamp(voidRecord.createdAt)}</td>
            </tr>
          </tbody>
        </table>
      ) : voidRecordError && voidRecordError !== "not_found" ? (
        <FailureState message="You don't have permission to view the void record." />
      ) : (
        <p className="fo-muted">Void record unavailable.</p>
      )}

      <p className="fo-muted">{CANCEL_VOID_CONFIRMATION_COPY}</p>
    </div>
  );
}

function ReorderRequestDecision({ request, employeeDirectory }) {
  return (
    <div className="fo-card">
      <h3>Reorder Request</h3>
      <table className="fo-table">
        <tbody>
          <tr>
            <td>Decision</td>
            <td>
              <StatusPill
                tone={request.reviewDecision === REORDER_REQUEST_STATUS.APPROVED ? "positive" : "critical"}
                label={request.reviewDecision}
              />
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
              <td>{resolveActorDisplayName(request.assignedToUserId, employeeDirectory)}</td>
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
              <td>{resolveActorDisplayName(request.purchasingStartedBy, employeeDirectory)}</td>
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
// log a Receive Stock/Adjust Stock/Correct Mistake note against this
// Part -- a single-step create, no approval workflow, entirely
// separate from the Reorder Request cards above. Writes go exclusively
// through domain/inventoryActions.js's recordInventoryAction(), which
// enforces (server-side validation, not just this form): Receive Stock
// requires a positive quantity, Adjust Stock allows positive or
// negative, Correct Mistake requires both a reason and notes.
//
// ChatGPT review (PR #76, REQUEST CHANGES) caught a real gap: the
// first version of this card implied these actions change stock --
// they don't. inventory_actions is a NEW, separate, audit-only
// collection (see docs/BusinessEntityModel.md Section 4a); applying an
// action to the real inventory ledger (inventory_transactions, Epic
// 2D/3/ADR-003) requires a trusted, Cloud-Function-mediated write path
// (mirroring reserveParts/releaseParts/consumeParts), which is blocked
// on enabling the Firebase Blaze plan -- a standing, deliberate
// platform decision (see CLAUDE_CONTEXT.md), not something this sprint
// can or should build around. Building that Cloud Function now would
// only add more undeployed, unverifiable code (same limbo
// createWorkOrder/transitionWorkOrder already sit in). So this card is
// now honestly framed as logged-only: no wording implies a live
// quantity change, and a persistent warning says so explicitly.
const INVENTORY_ACTION_LABEL = {
  [INVENTORY_ACTION_TYPE.RECEIVE_STOCK]: "Stock Received (log only)",
  [INVENTORY_ACTION_TYPE.ADJUST_STOCK]: "Stock Adjustment (log only)",
  [INVENTORY_ACTION_TYPE.CORRECT_MISTAKE]: "Correction Note (log only)",
};

function InventoryActionsPanel({ partId }) {
  const [actionType, setActionType] = useState(INVENTORY_ACTION_TYPE.RECEIVE_STOCK);
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // W2 (hooks/useInventoryActions.js): the read preserves a failed read
  // (permission-denied/unavailable/etc.) distinctly from a genuinely-empty log --
  // `actionsError` is threaded to LoadingEmptyState below so a read failure no
  // longer renders as "No inventory actions logged yet."
  const { data: recentActions, loading, error: actionsError } = useInventoryActionsForPart(partId);
  const { byUserId: employeeDirectory } = useEmployeeDirectory();

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
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setError(workflowActionErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <h3>Inventory Action Log</h3>
      <p className="fo-muted">
        This records an audit note only. It does not update stock yet.
      </p>

      <form className="fo-form" onSubmit={handleSubmit}>
        <label htmlFor="inventory-action-type">Action type</label>
        <select id="inventory-action-type" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          <option value={INVENTORY_ACTION_TYPE.RECEIVE_STOCK}>
            {INVENTORY_ACTION_LABEL[INVENTORY_ACTION_TYPE.RECEIVE_STOCK]}
          </option>
          <option value={INVENTORY_ACTION_TYPE.ADJUST_STOCK}>
            {INVENTORY_ACTION_LABEL[INVENTORY_ACTION_TYPE.ADJUST_STOCK]}
          </option>
          <option value={INVENTORY_ACTION_TYPE.CORRECT_MISTAKE}>
            {INVENTORY_ACTION_LABEL[INVENTORY_ACTION_TYPE.CORRECT_MISTAKE]}
          </option>
        </select>

        <label htmlFor="inventory-action-qty">Quantity for this note (not applied to stock)</label>
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
          <Button type="submit" variant="primary" disabled={submitting}>
            Log Action
          </Button>
        </div>
      </form>

      <h4>Recent Logged Actions</h4>
      <p className="fo-muted">Audit notes only -- none of these have been applied to stock.</p>
      <LoadingEmptyState
        loading={loading}
        failed={!!actionsError}
        isEmpty={recentActions.length === 0}
        loadingText="Loading inventory action log..."
        failedText="Unable to load the inventory action log right now. Try again shortly."
        emptyText="No inventory actions logged yet."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Qty (logged, not applied)</th>
              <th>Reason</th>
              <th>By</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {recentActions.slice(0, 10).map((action) => (
              <tr key={action.id}>
                <td>{INVENTORY_ACTION_LABEL[action.transactionType] ?? action.transactionType}</td>
                <td>{action.quantityDelta > 0 ? `+${action.quantityDelta}` : action.quantityDelta}</td>
                <td className="fo-muted">{action.reason ?? "—"}</td>
                <td className="fo-muted">{resolveActorDisplayName(action.createdBy, employeeDirectory)}</td>
                <td className="fo-muted">{formatTimestamp(action.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>
    </div>
  );
}

export default function PartDetail({ hasCapability, accessVersion, writeDeps } = {}) {
  const { partId } = useParams();
  // Notification identity fix (docs/specifications/notification-identity.md,
  // Issue #145) -- every Notification Panel/PartsList.jsx queue link now
  // supplies ?requestId=, letting this page resolve the exact request
  // that produced the click instead of "whichever request for this part
  // happens to be newest." Absent (a bookmark, a typed URL, the
  // unrelated catalog-row link), behavior is unchanged -- same
  // most-recent-by-createdAt fallback as before this fix.
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("requestId") || undefined;
  // INV-CONVERGENCE-E C2 -- live canonical `parts` read (one-shot, PR 1.9's
  // fetchPartMasterList; the SAME authorized read C1 uses -- no new query surface).
  // null until the first read resolves. Mapped to the canonicalRead status contract
  // the pure buildPartDetailView() consumes (OK / PERMISSION_DENIED / UNAVAILABLE).
  const [canonicalRead, setCanonicalRead] = useState(null);
  // Wave 6 -- master-data-in-Parts. Bumped after a governed Edit/Status save so the
  // SAME canonical read this page already performs re-fetches -- no second read
  // surface, no cache bypass, just the existing effect re-running.
  const [canonicalRefreshToken, setCanonicalRefreshToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // The FULL catalogue, and this page is one of the reasons the shared reader stayed that way: it
    // composes one part plus its relationships through a composer that expects the whole set, so a
    // first page would truncate a detail screen and look like missing data rather than like paging.
    // Recorded in PART_CATALOGUE_WHOLE_COLLECTION_READ alongside the other five.
    fetchPartMasterList().then((result) => {
      if (cancelled) return;
      // Pass `invalid` through so the shared composer fails closed on any malformed canonical document
      // (never silently dropped) -- see domain/partsCatalogView composeGovernedPartsWorkspace step 1b.
      if (result.ok) setCanonicalRead({ status: "OK", rows: result.parts, invalid: result.invalid });
      else setCanonicalRead({ status: result.code === "permission-denied" ? "PERMISSION_DENIED" : "UNAVAILABLE" });
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalRefreshToken]);
  const canonicalLoading = canonicalRead === null;

  // Governed detail composition (pure). While the read is in flight we pass a
  // LOADING sentinel (composes to BLOCKED with part:null) but render the loading
  // state, not the blocked banner (canonicalLoading gate below).
  const detail = useMemo(
    () =>
      buildPartDetailView({
        canonicalRead: canonicalRead ?? { status: "LOADING" },
        staticCatalog: PARTS_CATALOG,
        partId,
      }),
    [canonicalRead, partId]
  );
  const part = detail.part;
  // The resolved governed identity -- every ledger/health key below uses THIS, not
  // the raw route param. null while loading / BLOCKED / NOT_FOUND (fail-closed).
  const resolvedPartId = part ? part.partId : null;

  const { transactions, healthEntries, loading } = useInventoryLedger();
  // Wave 6 Owner Decision (2026-08-15) -- must be called unconditionally, before any early
  // return below, per the Rules of Hooks; the derived name-lookup map itself is computed
  // further down, after `canonicalPart` resolves.
  const manufacturerCatalog = useManufacturerCatalog();
  const {
    data: reorderRequest,
    loading: reorderRequestLoading,
    error: reorderRequestError,
    // refreshReorderRequest is an intentional NO-OP retained only for call-site
    // compatibility -- useReorderRequestForPart() is realtime (onSnapshot), so
    // its `refresh` is an empty callback (verified useReorderRequests.js:204,
    // 2026-08-05, W0). The onReviewed/onAssigned/etc. handlers below pass it so
    // child components have a callback to call; the live subscription, not this
    // call, is what actually re-renders the request.
    refresh: refreshReorderRequest,
  } = useReorderRequestForPart(partId, requestId);
  const { byUserId: employeeDirectory } = useEmployeeDirectory();

  // INV-CONVERGENCE-E C2 -- the ledger half of the paired re-point. Same equality
  // test, same sort, same 20-row cap as pre-C2; the only change is that the key is
  // the RESOLVED governed identity (resolvedPartId) instead of the raw route param,
  // so metadata and stock position can never be keyed differently. No ledger,
  // usage-history, reorder, or purchasing behavior changes.
  const { transactions: partTransactions, health } = useMemo(
    () => selectPartLedger({ transactions, healthEntries, resolvedPartId }),
    [transactions, healthEntries, resolvedPartId]
  );

  // Zero-history reorder behavior sprint, PR 3 -- the per-part
  // "Request Reorder" action on the Stock Position card, mirroring
  // InventoryHealthPanel.jsx's queue action via the same shared
  // RequestReorderControl/requestReorderForRecommendation. Only shown
  // when there's no reorderRequest already in flight for this part --
  // once one exists, the status cards above (ReorderRequestReview,
  // etc.) already cover the active workflow. useReorderRequestForPart()
  // is realtime, so no manual refresh is needed after a successful
  // create -- reorderRequest updates on its own.
  const [reorderSubmitting, setReorderSubmitting] = useState(false);
  const [reorderError, setReorderError] = useState(null);

  // Wave 6 -- master-data-in-Parts. null | "edit" | "status" -- which governed
  // Part Master action panel (if any) is open. Uses the SAME PartWriteModal +
  // usePartMasterWrite governed hook PartMasterList.jsx's own dedicated admin
  // screen uses -- no second write path.
  const [masterDataPanel, setMasterDataPanel] = useState(null);

  async function handleRequestReorder(manualQty) {
    setReorderSubmitting(true);
    setReorderError(null);
    try {
      // C2: write keyed on the resolved governed identity (only reachable when
      // READY, where resolvedPartId === the route partId). Workflow unchanged.
      await requestReorderForRecommendation({ partId: resolvedPartId, recommendation: health.recommendation, manualQty });
    } catch (err) {
      // Site-work r4 C, Fix 3: safe categorized copy, never a raw error string.
      setReorderError(workflowActionErrorMessage(err));
    } finally {
      setReorderSubmitting(false);
    }
  }

  // INV-CONVERGENCE-E C2 -- explicit, mutually exclusive pre-render states. No
  // partial page is ever rendered: under LOADING / BLOCKED_* / NOT_FOUND the entire
  // detail body -- including the reorder / PO / receive / cancel / void / inventory-
  // action write surface -- is withheld. A BLOCKED_* is reported as a verification
  // failure, NOT as the pre-existing "Unknown part" copy, which is now reserved for
  // a genuinely unknown id under a fully-verified canonical catalog.
  if (canonicalLoading) {
    return (
      <div className="fo-panel">
        <Link to="/inventory">← Back to Parts</Link>
        <p className="fo-muted">Loading part…</p>
      </div>
    );
  }

  if (isPartDetailBlocked(detail.status)) {
    return (
      <div className="fo-panel">
        <Link to="/inventory">← Back to Parts</Link>
        <p className="fo-muted">{partDetailBlockedMessage(detail.status)}</p>
      </div>
    );
  }

  if (!part) {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Unknown part "{partId}".</p>
        <Link to="/inventory">← Back to Parts</Link>
      </div>
    );
  }

  // Wave 6 -- master-data-in-Parts. The RAW canonical Part record (with `version`/
  // `status`, needed by the governed update/status-change commands) -- the SAME
  // canonical read this page already performs (canonicalRead.rows), never a second
  // query. `detail.part` above is the leaner display projection buildPartDetailView
  // produces and doesn't carry those fields.
  const canonicalPart = canonicalRead?.rows?.find((r) => r.partId === resolvedPartId) ?? null;
  // DEFECT FIXED 2026-08-30 (Parts North Star P1). This row was gated on
  // `canonicalPart?.manufacturerId` and could therefore never render: toPartView projected no
  // manufacturer field at all, and the stored key is primaryManufacturerId, not manufacturerId --
  // so the expression was wrong twice over and the Wave 6 decision below has never actually run.
  // The projection now carries the value (domain/partMasterView.js), and the row reads it from the
  // governed detail projection rather than re-deriving it from the raw read.
  //
  // Wave 6 Owner Decision (2026-08-15): resolve the Manufacturer NAME via the trusted
  // inventory.catalog.read projection where it's available -- honest fallback to the raw
  // manufacturerId (never a fabricated name) when the catalog read isn't READY.
  const manufacturerCatalogState = manufacturerCatalogViewState(manufacturerCatalog);
  const manufacturerNamesById =
    manufacturerCatalogState === MANUFACTURER_CATALOG_VIEW_STATE.READY
      ? manufacturerNameById(manufacturerCatalog.result.manufacturers)
      : new Map();
  const actions = (
    <ActionRail
      start={<Link to="/inventory" className="fo-back-link">&larr; Back to Parts</Link>}
      secondary={
        canonicalPart && (
          <>
            <Button type="button" variant="secondary" onClick={() => setMasterDataPanel("edit")}>
              Edit Part Details
            </Button>{" "}
            <Button type="button" variant="secondary" onClick={() => setMasterDataPanel("status")}>
              Change Status
            </Button>
          </>
        )
      }
    />
  );
  const context = (
    <ContextBand
      items={[
        { key: "sku", label: "SKU", value: part.sku },
        { key: "category", label: "Category", value: part.category },
        { key: "unit", label: "Unit", value: part.unit },
      ]}
    />
  );

  return (
    <WorkspaceShell title={part.name} actions={actions} context={context} className="fo-part-detail">
      {masterDataPanel && canonicalPart && (
        <PartWriteModal
          mode={masterDataPanel}
          part={canonicalPart}
          writeDeps={writeDeps}
          onClose={() => setMasterDataPanel(null)}
          onSaved={() => {
            setMasterDataPanel(null);
            setCanonicalRefreshToken((t) => t + 1);
          }}
        />
      )}
      {reorderRequestError && (
        <LoadingEmptyState
          loading={false}
          // M25 -- "not_found"/"mismatch" are genuine "this document does not exist
          // for this part" facts (isEmpty is honest here); anything else is a real
          // Firestore SDK read-error code (e.g. "permission-denied", "unavailable")
          // preserved by useReorderRequestForPart() -- an access/read failure is a
          // distinct fact from a genuinely-missing document and must render through
          // the `failed` branch (role="alert"), never be reported as "not found".
          isEmpty={reorderRequestError === "not_found" || reorderRequestError === "mismatch"}
          failed={reorderRequestError !== "not_found" && reorderRequestError !== "mismatch"}
          emptyText={
            reorderRequestError === "not_found"
              ? "This reorder request could not be found."
              : "This reorder request does not belong to this part."
          }
          failedText="This reorder request could not be loaded (access denied or a read error). Try again."
        />
      )}

      {!reorderRequestLoading && !reorderRequestError && reorderRequest && (
        reorderRequest.status === REORDER_REQUEST_STATUS.PENDING_REVIEW ? (
          <ReorderRequestReview request={reorderRequest} onReviewed={refreshReorderRequest} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER ? (
          <ReorderRequestAssignment request={reorderRequest} onAssigned={refreshReorderRequest} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE ? (
          <ReorderRequestStartPurchasing request={reorderRequest} onStarted={refreshReorderRequest} employeeDirectory={employeeDirectory} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? (
          <>
            <ReorderRequestPurchasingUpdate request={reorderRequest} onUpdated={refreshReorderRequest} employeeDirectory={employeeDirectory} />
            <ReorderRequestRecordPurchaseOrder request={reorderRequest} onRecorded={refreshReorderRequest} accessVersion={accessVersion} />
          </>
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.ORDERED ? (
          <>
            <ReorderRequestOrdered request={reorderRequest} employeeDirectory={employeeDirectory} onVoided={refreshReorderRequest} />
            <ReorderRequestMarkReceived request={reorderRequest} onReceived={refreshReorderRequest} />
          </>
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.RECEIVED ? (
          <ReorderRequestReceived request={reorderRequest} employeeDirectory={employeeDirectory} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.CANCELLED ? (
          <ReorderRequestCancelled request={reorderRequest} employeeDirectory={employeeDirectory} />
        ) : reorderRequest.status === REORDER_REQUEST_STATUS.VOIDED ? (
          <ReorderRequestVoided request={reorderRequest} employeeDirectory={employeeDirectory} />
        ) : (
          <ReorderRequestDecision request={reorderRequest} employeeDirectory={employeeDirectory} />
        )
      )}

      <div className="fo-card">
        <h3>Catalog</h3>
        <table className="fo-table">
          <tbody>
            {part.manufacturerId && (
              <tr>
                <td>Manufacturer</td>
                <td>
                  {manufacturerNamesById.get(part.manufacturerId) ?? part.manufacturerId}
                </td>
              </tr>
            )}
            <tr>
              <td>Cost</td>
              <td>{money(part.cost)}</td>
            </tr>
            <tr>
              <td>Price</td>
              <td>{money(part.price)}</td>
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

      {/* D6 -- "Used In Equipment" compatibility section. Capability-gated + INERT: it hides itself and
          reads nothing unless equipment.compatibility.view is exactly granted (active:false today, so
          hidden for everyone). A compatibility failure is scoped to this card and never affects the
          Part identity / stock / reorder behavior above or below it. */}
      <UsedInEquipmentSection hasCapability={hasCapability} accessVersion={accessVersion} partId={resolvedPartId} />

      {/* Barcode & Identifiers -- the missing front end for the governed part_aliases
          authority. Every control is protected/disabled and names the exact missing
          deployment, because the commands exist while no endpoint reaches them. */}
      {/* ND-26 (Owner, 2026-08-30): the human-facing Part Number is internalPartNumber. This
          prop was `canonicalPart?.partNumber` -- a key the projection has never carried under that
          name -- so it was always undefined and the section silently labelled itself with the
          document id instead. */}
      <PartIdentifiersSection partId={resolvedPartId} partNumber={part.internalPartNumber} />

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
                <td>
                  {hasUsageHistory(health.usage) ? (
                    health.usage.avgDailyUsage.toFixed(2)
                  ) : (
                    <span className="fo-muted">Insufficient usage history</span>
                  )}
                </td>
              </tr>
              <tr>
                <td>Days remaining</td>
                <td>
                  {hasUsageHistory(health.usage) && Number.isFinite(health.recommendation.daysRemaining)
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
                <td>
                  {hasUsageHistory(health.usage) ? (
                    Math.ceil(health.recommendation.recommendedOrderQty)
                  ) : (
                    <span className="fo-muted">Insufficient usage history</span>
                  )}
                </td>
              </tr>
              <tr>
                <td>Risk</td>
                <td>
                  {hasUsageHistory(health.usage) ? (
                    <StatusPill tone={inventoryUrgencyTone(health.recommendation.urgency)} label={health.recommendation.urgency} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs planning" />
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Site-work r4 C, Fix 1: mirrors PartsList.jsx's pendingRequests-style
              scoping -- requestable when there is no request at all, OR the
              most-recent one has reached a terminal status. Withheld (fail-closed)
              while the read is loading or has failed, same as every other gate on
              this page. */}
          {!reorderRequestLoading &&
            !reorderRequestError &&
            (!reorderRequest || TERMINAL_REORDER_REQUEST_STATUSES.has(reorderRequest.status)) && (
              <>
                {reorderError && <p className="fo-muted">{reorderError}</p>}
                <RequestReorderControl
                  recommendation={health.recommendation}
                  onSubmit={handleRequestReorder}
                  submitting={reorderSubmitting}
                  alreadyRequested={false}
                />
              </>
            )}
        </div>
      ) : (
        <p className="fo-muted">No ledger activity yet for this part -- stock position not yet forecastable.</p>
      )}

      {/* Wave 7 Item 3 -- Part -> Work Order Demand. Keyed on the resolved governed identity, same as
          every other section below the Stock Position card. A pure read/projection over the existing
          fieldops_wos authority -- see modules/inventory/PartWorkOrderDemandSection.jsx's header. */}
      <PartWorkOrderDemandSection partId={resolvedPartId} />

      {/* C2: keyed on the resolved governed identity (=== route partId when READY,
          the only state in which this renders). Write surface itself unchanged. */}
      <InventoryActionsPanel partId={resolvedPartId} />

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
    </WorkspaceShell>
  );
}
