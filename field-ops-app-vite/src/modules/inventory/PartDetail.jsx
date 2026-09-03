import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import UsedInEquipmentSection from "./UsedInEquipmentSection";
import PartsInfoDisclosure from "./PartsInfoDisclosure.jsx";
import { canViewCompatibility } from "../../domain/equipmentCompatibilitySection.js";
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
import ReorderWarehouseSelect from "../../shared/inventory/ReorderWarehouseSelect.jsx";
import { useReorderWarehouseOptions } from "../../hooks/useReorderWarehouseOptions";
import EmployeeAssignmentPicker from "../../shared/assignment/EmployeeAssignmentPicker";
import RecordIdentity from "../../shared/ui/RecordIdentity.jsx";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import PartWriteModal from "../../shared/partMaster/PartWriteModal.jsx";
import { useManufacturerCatalog } from "../../hooks/useManufacturerCatalog";
import { MANUFACTURER_CATALOG_VIEW_STATE, manufacturerCatalogViewState, manufacturerNameById } from "../../domain/manufacturerCatalogView";
import { inventoryUrgencyTone, inventoryUrgencyLabel } from "../../domain/inventoryUrgencyTone.js";
import { Button } from "../../shared/ui/primitives/index.js";
import {
  partRecordIdentity,
  partRecordKicker,
  partRecordFacts,
  partInformationRows,
  partLocationSection,
  partUnitSection,
  partPurchasingSection,
  partActivityRows,
  partReorderPointDisplay,
  PART_SECTION_STATE,
  PART_ACTIVITY_SCOPE_NOTE,
} from "../../domain/partsNorthStar.js";

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
// branch. It USED to let an admin/dispatcher log a Receive Stock /
// Adjust Stock / Correct Mistake note against this Part.
//
// THAT WRITE IS RETIRED (Owner ruling, 2026-08-30). inventory_actions is
// not stock authority and was never reconciled with the governed ledger,
// so each note was a parallel assertion that stock had moved with no way
// to converge -- and Receiving, Transfers and the Cycle Count / governed
// adjustment paths own those movements now.
//
// The READ is untouched: existing history stays visible and attributable
// via hooks/useInventoryActions.js. Nothing was deleted or migrated.
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
                <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={inventoryUrgencyLabel(request.urgency)} />
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
                <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={inventoryUrgencyLabel(request.urgency)} />
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
                <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={inventoryUrgencyLabel(request.urgency)} />
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
  // FIN-BLOCK-003A activation: the committed unit price, entered as the amount the purchasing person
  // agreed with the vendor. Held as the TYPED STRING, not a number -- the exact conversion to minor
  // units happens once, in domain/reorderPurchaseOrders.js, where the currency is known.
  //
  // NO PREFILL TODAY, and the field says so rather than pretending. The supplier quote
  // (part_supplier_items.cost) is the governed prefill source the ruling permits, but it has NO
  // client read: the repo exposes only write callables for supplier items, and the cost projection is
  // gated behind inventory.catalog.cost.read with no surface that serves it here. Building that read
  // would be a new gated visibility surface, which is a separate authority decision. So the honest
  // state is manual entry with the source named -- never a blank field the reader might assume was
  // filled from a quote.
  const [unitPriceMajor, setUnitPriceMajor] = useState("");
  const [currency, setCurrency] = useState("USD");
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
        unitPriceMajor,
        currency,
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

        {/* THE COMMITTED PRICE. Placed directly after quantity because that is the pair a purchasing
            person reads together -- how many, at what each -- and separating them would invite the
            price to be checked against the wrong line. */}
        <label htmlFor="po-unit-price">Unit purchase price</label>
        <input
          id="po-unit-price"
          type="text"
          inputMode="decimal"
          value={unitPriceMajor}
          onChange={(e) => setUnitPriceMajor(e.target.value)}
          placeholder="0.00"
          aria-describedby="po-unit-price-note"
          required
        />
        <p id="po-unit-price-note" className="fo-muted">
          The amount committed to the supplier, per unit. Entered manually — no supplier quote is
          available on this screen. Enter 0 for a no-charge line.
        </p>

        <label htmlFor="po-currency">Currency</label>
        <input
          id="po-currency"
          type="text"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          size={4}
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
// NOT change any real stock count, and does not touch
// inventory_transactions. The Inventory Action Log it used to point at
// for company no longer accepts writes at all (Owner ruling,
// 2026-08-30) -- so this note is now the only thing of its kind on the
// page, and it is still not a stock movement. Reconciling it against
// real stock remains a separate backlog item.
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

// Sprint 2.1.9 -- Inventory Actions Foundation, RETIRED 2026-08-30.
//
// It let an admin/dispatcher log a Receive Stock / Adjust Stock / Correct
// Mistake note in a single step. The Owner retired new writes: the
// collection is not stock authority, was never reconciled with the
// governed ledger, and its vocabulary had been overtaken by Receiving,
// Transfers and the governed adjustment paths.
//
// What remains below is the HISTORY, read-only.
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

// INVENTORY ACTION HISTORY — read-only. Owner ruling, 2026-08-30: RETIRE NEW WRITES, KEEP
// EXISTING HISTORY READABLE.
//
// WHY THE FORM WENT. `inventory_actions` is not stock authority and is never reconciled with the
// governed ledger -- the entity register states it outright: "the two collections are never joined
// or reconciled by any code in this repository". Every new entry was therefore a second, parallel
// assertion that stock had moved, with no mechanism that could ever make the two agree.
//
// Its vocabulary had also been overtaken. "Receive Stock" and "Adjust Stock" now name governed
// things that live elsewhere: Receiving owns receiving, Transfers own transfers, and the Cycle
// Count / governed adjustment paths own their movement. A note here could only ever shadow them.
//
// WHAT IS PRESERVED, deliberately and completely: every existing document, its append-only
// visibility, its actor and its timestamp. Nothing is deleted, nothing is migrated into the
// ledger, and nothing here reinterprets a note as authoritative movement.
//
// NOT FIXED HERE, and worth naming rather than leaving to be rediscovered: firestore.rules still
// carries `allow create: if isAdminOrDispatcher()` on this collection, with no field validation
// and a client-supplied `createdBy` that Rules never bind to request.auth.uid. Removing the form
// closes the only path the product offered; closing the RULE is a Tier-2 change this presentation
// ruling does not authorize.
function InventoryActionsPanel({ partId }) {
  // W2 (hooks/useInventoryActions.js): the read preserves a failed read
  // (permission-denied/unavailable/etc.) distinctly from a genuinely-empty log --
  // `actionsError` is threaded to LoadingEmptyState below so a read failure no
  // longer renders as "No inventory actions logged yet."
  const { data: recentActions, loading, error: actionsError } = useInventoryActionsForPart(partId);
  const { byUserId: employeeDirectory } = useEmployeeDirectory();

  return (
    <RuledSection
      title="Inventory action history"
      meta="Historical notes only — never applied to stock, and no longer added to."
    >
      <p className="ns-gap-note">
        These are legacy audit notes from before Receiving, Transfers and Cycle Counts owned their
        movements. They were never reconciled with the inventory ledger and are kept as evidence of
        what was recorded, not as a record of what moved. New notes are no longer accepted here.
      </p>
        {/* A GENUINELY EMPTY HISTORY IS NOT A FAILURE, and says so in its own sentence. */}
      <LoadingEmptyState
        loading={loading}
        failed={!!actionsError}
        isEmpty={recentActions.length === 0}
        loadingText="Loading inventory action history..."
        failedText="Unable to load the inventory action history right now. Try again shortly."
        emptyText="No inventory notes were ever recorded for this part."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Qty (logged, never applied)</th>
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
    </RuledSection>
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
  // WORKSTREAM 2B -- the governed Warehouse this request is FOR. A part is not a place: this
  // page knows which part is short, and nothing on it knows where. So it is asked, and it
  // starts empty; the control below stays disabled until it is answered.
  const [reorderWarehouseId, setReorderWarehouseId] = useState("");
  // R-17. The trusted projection, not a warehouses collection LIST -- see the hook's header.
  const reorderWarehouses = useReorderWarehouseOptions(true);

  // Wave 6 -- master-data-in-Parts. null | "edit" | "status" -- which governed
  // Part Master action panel (if any) is open. Uses the SAME PartWriteModal +
  // usePartMasterWrite governed hook PartMasterList.jsx's own dedicated admin
  // screen uses -- no second write path.
  const [masterDataPanel, setMasterDataPanel] = useState(null);

  // WORKSTREAM 2B: `warehouseId` is handed back by the control that was gated on it, so the
  // warehouse that enabled the button is the one written. The trusted command re-reads it and
  // derives the operating company; nothing here interprets or defaults it.
  async function handleRequestReorder(manualQty, warehouseId) {
    setReorderSubmitting(true);
    setReorderError(null);
    try {
      // C2: write keyed on the resolved governed identity (only reachable when
      // READY, where resolvedPartId === the route partId). Workflow unchanged.
      await requestReorderForRecommendation({
        partId: resolvedPartId,
        warehouseId,
        recommendation: health.recommendation,
        manualQty,
      });
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
      <div className="ns-page">
        <HonestState state={HONEST_STATE.LOADING} subject="this part" />
      </div>
    );
  }

  // FOUR SENTENCES, NOT ONE. A blocked read, an unverified record and a genuinely unknown id are
  // three different problems with three different owners, and the domain already writes each of
  // them. The page states the domain's own sentence rather than a generic failure.
  if (isPartDetailBlocked(detail.status)) {
    return (
      <div className="ns-page">
        <div className="ns-page__utility">
          <span className="ns-page__context">
            <Link to="/inventory">Inventory → Parts</Link>
          </span>
        </div>
        <div className="ns-rulepair" />
        <HonestState
          state={detail.status === "BLOCKED_PERMISSION" ? HONEST_STATE.DENIED : HONEST_STATE.UNAVAILABLE}
          subject="this part"
          detail={partDetailBlockedMessage(detail.status)}
        />
      </div>
    );
  }

  if (!part) {
    return (
      <div className="ns-page">
        <div className="ns-page__utility">
          <span className="ns-page__context">
            <Link to="/inventory">Inventory → Parts</Link>
          </span>
        </div>
        <div className="ns-rulepair" />
        {/* NOT FOUND is a legitimate answer, and deliberately worded so it can never be mistaken
            for a blocked read above: the catalogue WAS readable, and it holds no such part. */}
        <HonestState
          state={HONEST_STATE.UNKNOWN}
          subject="this part"
          detail={`No part is recorded under “${partId}”. The catalogue was read successfully — this id is not in it.`}
        />
      </div>
    );
  }

  // Wave 6 -- master-data-in-Parts. The RAW canonical Part record (with `version`, needed by the
  // governed update/status-change commands) -- the SAME canonical read this page already performs
  // (canonicalRead.rows), never a second query. `detail.part` above is the governed display
  // projection buildPartDetailView produces.
  const canonicalPart = canonicalRead?.rows?.find((r) => r.partId === resolvedPartId) ?? null;
  // Wave 6 Owner Decision (2026-08-15): resolve the Manufacturer NAME via the trusted
  // inventory.catalog.read projection where it's available -- honest fallback to the raw
  // manufacturerId (never a fabricated name) when the catalog read isn't READY.
  //
  // That decision could not run until 2026-08-30: the row it fed was gated on a key the projection
  // never carried, under a name no document uses. See domain/partMasterView.js.
  const manufacturerCatalogState = manufacturerCatalogViewState(manufacturerCatalog);
  const manufacturerNamesById =
    manufacturerCatalogState === MANUFACTURER_CATALOG_VIEW_STATE.READY
      ? manufacturerNameById(manufacturerCatalog.result.manufacturers)
      : new Map();
  const manufacturerName = part.manufacturerId ? (manufacturerNamesById.get(part.manufacturerId) ?? null) : null;

  // ── The governed North Star derivation. No business fact is derived in this file. ────────────
  const identity = partRecordIdentity(part);
  const kicker = partRecordKicker(part);
  const facts = partRecordFacts(part, manufacturerName);
  const informationRows = partInformationRows(part, manufacturerName);
  const locationSection = partLocationSection();
  const unitSection = partUnitSection(part);
  const purchasing = partPurchasingSection();
  const activityRows = partActivityRows(partTransactions);
  const reorderPointDisplay = partReorderPointDisplay(health);

  const reorderWorkflowCard =
    !reorderRequestLoading && !reorderRequestError && reorderRequest ? (
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
    ) : null;

  return (
    <div className="ns-page fo-part-detail">
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

      <div className="ns-page__utility">
        <span className="ns-page__context">
          <Link to="/inventory">Inventory → Parts</Link>
          {identity.titleIsAbsent ? null : ` → ${identity.title}`}
        </span>
        {/* NO LIVE INDICATOR. The canonical Parts read is a one-shot getDocs, not a subscription —
            this record does not update on its own, and claiming otherwise is the kind of small
            false promise a dispatcher plans around. */}
      </div>
      <div className="ns-rulepair" />

      <RecordIdentity
        kicker={kicker}
        // ND-26 (Owner, 2026-08-30): the title is the human-facing Part Number, never the document
        // id. When a row carries no Part Number the identity says so rather than substituting the
        // key, which is the substitution the ruling forbids.
        reference={identity.titleIsAbsent ? null : identity.title}
        fallbackName={identity.title}
        subtitle={identity.subtitle}
        statusWords={facts.find((f) => f.isStatus)?.value ?? null}
        statusVariant="sentence"
        facts={facts.filter((f) => !f.isStatus).map((f) => ({ key: f.key, label: f.label, value: f.value }))}
        actions={
          canonicalPart && (
            <>
              {/* PRIMARY FIRST, AT BOTH WIDTHS (Owner ruling 7). The two P1v2 frames disagreed with
                  each other -- 1b draws "Change status" then "Edit part", 1b-mobile draws "Edit
                  part" then "Change status" -- and the Owner settled it on the mobile order. Both
                  frames agree that Edit part is the filled one, so it takes the primary variant it
                  never had; responsive layout may restack these, it may not reverse them. */}
              <Button type="button" variant="primary" onClick={() => setMasterDataPanel("edit")}>
                Edit part
              </Button>{" "}
              <Button type="button" variant="secondary" onClick={() => setMasterDataPanel("status")}>
                Change status
              </Button>
            </>
          )
        }
      />

      {reorderRequestError && (
        <LoadingEmptyState
          loading={false}
          // M25 -- "not_found"/"mismatch" are genuine "this document does not exist for this part"
          // facts (isEmpty is honest here); anything else is a real Firestore SDK read-error code
          // preserved by useReorderRequestForPart() -- an access/read failure is a distinct fact
          // from a genuinely-missing document and must render through the `failed` branch
          // (role="alert"), never be reported as "not found".
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

      {/* ══════════════ FRAME 1b: FIVE BANDS, NOT SEVEN SECTIONS AND A RAIL ══════════════
          Owner-approved composition, 2026-08-31 (Parts P1v2, with the seven authority rulings).

          The audit's finding was not that this record said the wrong things -- it was that absence
          occupied more of the page than fact: three of seven sections each spent a heading, a meta
          line and an explanatory paragraph saying there was nothing, roughly 700px for three
          absences, while what the page actually KNOWS fits in four lines.

          So the sections are re-paired rather than rewritten. Each band asks one question and
          answers it in two columns -- what we know on the left, what we cannot yet know on the
          right -- which prices an absence at a line beside a fact instead of a section beneath it.

          THE SENTENCES SURVIVE. ND-25's "location describes where units sit -- it never implies
          custody or availability" and the identifier "unread, not empty" are the POINT of this
          page, and they are still here, in full. What changed is what they cost. */}
      <div className="ns-record-bands">
        {/* ── BAND 1 · AVAILABILITY / INVENTORY ─────────────────────────────────────────────
            Named "Stock forecast" until P1v2. The band header carries the derivation sentence on
            its right, which is where Frame 1b puts it and where it belongs: it qualifies every
            figure below it rather than one of them. */}
        <RuledSection
          id="part-availability"
          title="Availability / Inventory"
          meta={
            health && !loading
              ? "Derived from this part’s movements in the work-order and receiving ledger — not a governed stock position."
              : null
          }
        >
          <div className="ns-band__cols">
            <div className="ns-band__col">
              {/* THESE FIGURES ARE DERIVED CLIENT-SIDE from inventory_transactions by
                  inventoryAnalyticsEngine. ND-25 forbids presenting such a figure as On hand or
                  Available and forbids substituting it into the record's identity layer -- so it is
                  absent from the header and named by its derivation above, here, where the reorder
                  request it gates can still be raised. */}
              {loading ? (
                <HonestState state={HONEST_STATE.LOADING} subject="the stock forecast" />
              ) : health ? (
                <>
                  <table className="fo-table ns-band__facts">
                    <tbody>
                      <tr>
                        <td>Ledger-derived stock</td>
                        <td>{health.stock.availableStock}</td>
                      </tr>
                      <tr>
                        <td>Avg daily usage</td>
                        <td>
                          {hasUsageHistory(health.usage) ? (
                            health.usage.avgDailyUsage.toFixed(2)
                          ) : (
                            <span className="ns-state--na">Insufficient usage history</span>
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
                        {/* Owner ruling 2026-08-30. This cell rendered a bare 0 beside
                            "Insufficient usage history" on the same card. The reorder point is
                            avgDailyUsage times a constant, so a zero is ALWAYS the consequence of no
                            usage and never a governed value -- partReorderPointDisplay carries the
                            proof. Truthful absence over a numerically precise false comfort. */}
                        <td>
                          {reorderPointDisplay.established ? (
                            reorderPointDisplay.value
                          ) : (
                            <span className="ns-state--na">{reorderPointDisplay.absence}</span>
                          )}
                        </td>
                      </tr>
                      {/* RECOMMENDED REORDER QTY AND RISK ARE GONE -- Owner ruling 4, 2026-08-31, an
                          INTENTIONAL presentation removal and not accidental loss.

                          The Owner's reason: the record should present the governed and derived
                          facts needed to understand the part and to initiate the governed reorder
                          workflow, and should not grow back into the forecasting dashboard it had
                          become. These four rows answer "what is the stock position"; the two
                          removed answered "what should we do about it", which is the command's job
                          -- and the command is immediately below them.

                          NOTHING UNDERNEATH CHANGED. `health.recommendation` still carries both
                          figures, generateReplenishmentRecommendation still derives them, and
                          RequestReorderControl below still reads the recommendation it always did,
                          recommendedOrderQty included -- which is why removing the row does not
                          remove the quantity from the request. The Inventory Operational Queue on
                          /inventory still ranks by the same urgency. Presentation only; the domain
                          behaviour and the authority are untouched. */}
                    </tbody>
                  </table>

                  {/* Site-work r4 C, Fix 1: requestable when there is no request at all, OR the
                      most-recent one has reached a terminal status. Withheld (fail-closed) while the
                      read is loading or has failed, same as every other gate on this page.

                      THE GATE IS UNCHANGED BY THE MOVE INTO A BAND. Frame 1b draws this control
                      unconditionally enabled; a frame cannot loosen a gate, and ND-28 is explicit
                      that sharing a card does not make the informational number above it the
                      authority for the command. */}
                  {!reorderRequestLoading &&
                    !reorderRequestError &&
                    (!reorderRequest || TERMINAL_REORDER_REQUEST_STATUSES.has(reorderRequest.status)) && (
                      <>
                        {reorderError && <p className="ns-state--na">{reorderError}</p>}
                        {/* WORKSTREAM 2B. The request names a governed Warehouse, and the trusted
                            command derives its operating company from that. A part is not a place:
                            nothing on this page knows where the shortage is, so it is asked, and it
                            is asked ABOVE the button rather than beside it -- the band's row is the
                            command and its disclosure, and a governed input is neither. Empty until
                            answered, which leaves the button off. */}
                        <ReorderWarehouseSelect
                          id="part-detail-reorder-warehouse"
                          options={reorderWarehouses.options}
                          loading={reorderWarehouses.loading}
                          error={reorderWarehouses.error}
                          value={reorderWarehouseId}
                          onChange={setReorderWarehouseId}
                        />
                        <span className="ns-reorder-row">
                          <RequestReorderControl
                            recommendation={health.recommendation}
                            onSubmit={handleRequestReorder}
                            submitting={reorderSubmitting}
                            alreadyRequested={false}
                            warehouseId={reorderWarehouseId}
                          />
                          {/* ND-28, WHERE THE FRAME PUTS IT. The figures above are derived from this
                              part's own ledger movements; the reorder request is a governed command.
                              The Owner's ruling is that the informational number does not become the
                              authority for the command merely because they share a card -- and the
                              one place a reader is most likely to assume otherwise is the moment
                              they reach for the button directly beneath the numbers. */}
                          <PartsInfoDisclosure label="Request reorder — what these figures do and do not decide">
                            The figures above are derived from this part&rsquo;s movements in the
                            work-order and receiving ledger. They are informational: they do not
                            authorise the reorder, and they do not set its quantity. Raising a
                            request starts the governed reorder workflow, which is reviewed and
                            assigned by the people who hold that authority.
                          </PartsInfoDisclosure>
                        </span>
                      </>
                    )}
                </>
              ) : (
                /* A part with no ledger activity is a VALID part. Saying "no forecast" is a
                   different statement from saying "no stock", and only the first is known. */
                <HonestState
                  state={HONEST_STATE.EMPTY}
                  subject="this part"
                  detail="No ledger movements have been recorded for this part, so no stock forecast can be made. That is not a statement about how many exist."
                />
              )}

              {/* SERIALIZED / LOT UNITS — gated on the Part's own tracking mode through the governed
                  boundary translator, so SERIALIZED_LOT fails closed rather than being collapsed
                  into SERIAL. An untracked part gets no block at all: it has no unit identity, and
                  an empty "Serialized units" heading is a question a bulk part cannot be asked. */}
              {unitSection.state === PART_SECTION_STATE.NOT_APPLICABLE ? null : (
                <div className="ns-band__block">
                  <h3 className="ns-band__sub">{unitSection.heading}</h3>
                  {/* THE NOTE IS NOT DECORATION. It carries "serialized units are assets, never
                      loose quantity" -- the sentence that keeps a serialized part from being read
                      as a countable pile, which is the whole reason this section is gated on the
                      Part's tracking mode. It rode in RuledSection's `meta` slot before the band
                      restructure and was briefly lost with it. */}
                  {unitSection.note ? <p className="ns-band__note">{unitSection.note}</p> : null}
                  <HonestState
                    state={
                      unitSection.state === PART_SECTION_STATE.BLOCKED_UNSUPPORTED
                        ? HONEST_STATE.UNAVAILABLE
                        : HONEST_STATE.NOT_ENABLED
                    }
                    subject="Unit detail"
                    detail={unitSection.detail}
                  />
                </div>
              )}
            </div>

            {/* WHERE IT IS — the block that must not draw an empty table.
                ND-25: per-location quantities reach this page only through the governed balance and
                location reads, both of which are built and switched off. An empty table would imply
                rows are coming; a missing block would read as "this part is nowhere".

                data-where-it-is IS A CONTRACT, not decoration. The live gate used to find this by
                matching an h2 reading "Where it is" -- a heading the design was free to change, and
                did, when the block became a column inside a band. Anchoring a gate on a heading the
                composition may rename is exactly what `data-parts-catalog` was introduced to stop
                on the workspace. */}
            <div className="ns-band__col" data-where-it-is>
              <h3 className="ns-band__sub">{locationSection.heading}</h3>
              {/* THE CUSTODY SENTENCE IS NOT ABBREVIATED AND NOT MOVED. ND-25 is the reason this
                  block exists: location describes where units sit, and it never implies custody or
                  availability. Both confusions are cheap to make and expensive to act on, so it
                  stays on the page at full length. */}
              <p className="ns-band__note">{locationSection.note}</p>
              <HonestState state={HONEST_STATE.NOT_ENABLED} subject="Location detail" detail={locationSection.detail} />
              <PartsInfoDisclosure label="Where it is — why locations cannot be listed">
                {locationSection.detailLong}
              </PartsInfoDisclosure>
            </div>
          </div>
        </RuledSection>

        {/* ── BAND 2 · DEMAND & PURCHASING ──────────────────────────────────────────────────
            What is asking for this part, and what is being done about getting it. */}
        <RuledSection id="part-demand-purchasing" title="Demand &amp; purchasing">
          <div className="ns-band__cols">
            <div className="ns-band__col">
              {/* PLANNED DEMAND, NEVER A RESERVATION -- the section's own header says so. Existing
                  governed read over fieldops_wos; unchanged. */}
              <PartWorkOrderDemandSection partId={resolvedPartId} />
            </div>
            {/* PURCHASING CONTEXT.
                ND-27 (Owner, 2026-08-30): no cost row. The metadata register blocks unitCost from
                display, report AND export together -- deliberately, so the field cannot reach the
                same person by a longer route -- and sellPrice is blocked by the same clause. Neither
                is rendered, and the static catalogue's baseline figures are not substituted for
                them. On order is a governed fact behind an inactive capability, which is a different
                sentence from a missing one. */}
            {/* THE CONCISE SENTENCE STAYS; THE LONG ONE MOVES BEHIND THE (i).
                Owner ruling B §3. `purchasing.detail` is 259 characters of governed explanation --
                the balance-read authority and the cost/price refusal -- and it was rendering as
                three permanent lines under a one-line fact. Not a word of it is deleted: it is the
                disclosure's entire content, verbatim from the same domain function. */}
            <div className="ns-band__col">
              <h3 className="ns-band__sub">{purchasing.heading}</h3>
              <dl className="ns-rail__dl">
                {purchasing.rows.map((row) => (
                  <div key={row.key}>
                    <dt>{row.label}</dt>
                    <dd className="ns-state--na">
                      {row.absence}
                      <PartsInfoDisclosure label={`${row.label} — why this is not available`} align="end">
                        {purchasing.detail}
                      </PartsInfoDisclosure>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* THE REORDER WORKFLOW. Governed, live, and deliberately left whole: it is a working
              command surface, not a mockup element, and a presentation migration does not delete
              one. It keeps its own cards, and it sits full-width beneath the two columns because it
              is the band's ACTION rather than one of its two readings. */}
          {reorderWorkflowCard}
        </RuledSection>

        {/* ── BAND 3 · PART INFORMATION ─────────────────────────────────────────────────────
            What this part IS, as distinct from what is happening to it. */}
        <RuledSection id="part-information" title="Part information">
          <div className="ns-band__cols">
            <div className="ns-band__col">
              {/* THE STRUCTURED MASTER-DATA SUMMARY — Frame 1b's five rows (Owner ruling, 2026-08-31).
                  This rendered `partRecordRailSubset`, which withholds every fact the header already
                  states. On the deployed page the header stated all of them, so the subset returned
                  nothing and this band shipped as a two-column layout with an EMPTY left half.

                  The repetition is deliberate and is part of the approved grammar: the identity line
                  gives fast recognition, this band gives the structured summary. Two readings of the
                  same part, and the frame draws both.

                  Every row keeps its label even when the value is missing — a master-data summary
                  that silently drops a field tells the reader the field does not exist, rather than
                  that it is unrecorded. */}
              <dl className="ns-rail__dl">
                {informationRows.map((row) => (
                  <div key={row.key}>
                    <dt>{row.label}</dt>
                    <dd>
                      {row.value ?? <span className="ns-state--na">{row.absence}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* USED ON — Owner ruling 3, 2026-08-31: TRUTHFUL ABSENCE.
                Frame 1b draws this column POPULATED ("Taylor C712 · Soft Serve Freezer", with the
                reassurance line naming the compatibility catalogue as its source). It cannot be: the read is
                gated on `equipment.compatibility.view`, which is registered active:false and granted
                to nobody, so the section renders nothing at all today. The reassurance line is true
                of the CATALOGUE and false of the READ, which is precisely the distinction ND-27 drew
                for locations.

                So it says what it is -- built, governed, switched off -- in one line, on the same
                footing as the other three switched-off reads on this page. Activation is a separate
                governed decision and is not something a presentation migration may carry.

                UsedInEquipmentSection itself is unchanged and still capability-gated + inert; this
                only supplies the sentence for the case where it hides itself. */}
            <div className="ns-band__col">
              <h3 className="ns-band__sub">Used on</h3>
              {canViewCompatibility(hasCapability) ? (
                <UsedInEquipmentSection
                  hasCapability={hasCapability}
                  accessVersion={accessVersion}
                  partId={resolvedPartId}
                />
              ) : (
                <>
                  {/* CONCISE VISIBLE, LONG FORM BEHIND THE (i) — ruling B §6. The visible line keeps
                      both contracts: the read is BUILT AND GOVERNED and SWITCHED OFF, and this is an
                      UNREAD list rather than an empty one. No compatibility fact is fabricated
                      either way; the catalogue's existence is not a claim about what is in it. */}
                  <HonestState
                    state={HONEST_STATE.NOT_ENABLED}
                    subject="Equipment compatibility"
                    detail="Not an empty list — an unread one: the compatibility read is built and governed, switched off in this environment."
                  />
                  <PartsInfoDisclosure label="Used on — why compatibility cannot be shown">
                    The equipment this part is used on is recorded in the compatibility catalog.
                    Reading it here needs the equipment compatibility capability, which is registered
                    and governed and is not active in this environment. That the catalog exists is
                    not a claim about what it holds for this part — nothing has been read.
                  </PartsInfoDisclosure>
                </>
              )}
            </div>
          </div>
        </RuledSection>

        {/* ── IDENTIFIERS · reference tier ──────────────────────────────────────────────────
            Demoted from a full section to a reference band. It was three explanatory paragraphs and
            an unavailable notice in a column that wanted scannable facts; what it has to say is
            important and short. The "unread, not empty" sentence is the point of it and survives
            inside the component.

            ND-26: labelled with the Part Number. The prop was `canonicalPart?.partNumber` -- a key
            the projection has never carried under that name -- so it was always undefined and the
            section silently labelled itself with the document id. */}
        <section className="ns-band ns-band--reference">
          <PartIdentifiersSection partId={resolvedPartId} partNumber={part.internalPartNumber} />
        </section>

        {/* ── ACTIVITY ──────────────────────────────────────────────────────────────────────
            The ledger that EXISTS. The seven-type operational movement contract in
            domain/inventoryLedgerEvent.js is a pure shape contract with no persistence, so it is not
            named here as though it could be read.

            ONE LINE PER MOVEMENT, NOT A FOUR-COLUMN TABLE -- and NO ACTOR AND NO DESCRIPTION.
            Owner ruling 2, 2026-08-31. Frame 1b draws each movement as
            "Adjusted · Opening adjustment · D. Reyes · +6". The ledger carries neither of the middle
            two facts: LedgerTransaction is id, workOrderId, partId, type, quantity, timestamp, and
            that is all partActivityRows can carry. An actor and a note DO exist -- on
            `inventory_actions`, a collection the entity register says is "never joined or reconciled
            by any code in this repository", and whose write side was retired on 2026-08-30 precisely
            because it was a second, parallel assertion about stock. Sourcing this band's actor from
            there would rebuild the join that retirement removed, and would attribute a governed
            ledger movement to a person who was recording something else.

            Design had already drawn the buildable version: frame 1b-MOBILE renders the same movement
            with no actor and no description. That grammar is now used at BOTH widths, which is the
            ruling. The composition survives; the unsupported facts do not. */}
        <RuledSection id="part-activity" title="Activity" meta={PART_ACTIVITY_SCOPE_NOTE}>
          {activityRows.length === 0 ? (
            <HonestState
              state={HONEST_STATE.EMPTY}
              subject="this part"
              detail="No movements have been recorded against this part."
            />
          ) : (
            <ul className="ns-activity">
              {activityRows.map((row) => (
                <li key={row.id} className="ns-activity__row">
                  <span className="ns-activity__what">
                    {/* A WORD, not the stored token. This cell rendered the raw enum. */}
                    <strong>{row.type}</strong>
                    {row.workOrderId ? <span className="fo-muted"> · {row.workOrderId}</span> : null}
                  </span>
                  <span className="ns-activity__when fo-muted">{formatTimestamp(row.timestamp)}</span>
                  <span className="ns-activity__qty">
                    {row.quantity ?? <span className="ns-state--na">—</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RuledSection>

        {/* INVENTORY ACTION HISTORY stays on the RECORD, and the reason is a fact about scope rather
            than a preference. Frame 1a moves "Inventory action history" into the workspace's Flow
            rail; this panel is PART-SCOPED (keyed on this part's id), and a rail link is naturally
            the global history. Moving a part-scoped panel to a global slot would relabel what it
            opens. The workspace's Flow rail carries the global history; this stays here.

            C2: keyed on the resolved governed identity. The write surface is retired (#1625); the
            read is untouched and every existing document keeps its actor and its timestamp. */}
        {/* AT REST IT IS ONE LINE, and that is already more than Frame 1b asks for -- the frame
            removes this block from the record altogether. A disclosure keeps the history reachable
            where it is scoped, without spending 260px of a 1,050px budget on a panel that is
            consulted rather than scanned. Same treatment, same reasoning, as the workspace rail's
            queues. */}
        <section className="ns-band ns-band--reference">
          <details className="ns-parts-rail__item">
            <summary>Inventory action history</summary>
            <InventoryActionsPanel partId={resolvedPartId} />
          </details>
        </section>
      </div>
    </div>
  );
}
