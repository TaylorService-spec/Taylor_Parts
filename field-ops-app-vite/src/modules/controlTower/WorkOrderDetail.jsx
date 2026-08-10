import { computeWorkOrderSignalFromDoc } from "../../domain/workOrderScoring";
import { buildTimeline } from "../../domain/timelineBuilder";
import { describeEvent } from "../../domain/eventModel";
import { EVENT_ICON } from "../../domain/eventTypes";
import { formatClockTime } from "../../domain/displayTimestamp";
import { snapshotPartName, snapshotPartSku, snapshotPartCategory, snapshotPartUnit } from "../../domain/workOrderInventorySnapshot";
import WorkOrderActions from "./WorkOrderActions";
import { workOrderPriorityText } from "../../domain/workOrderPriority";

// Work Order Engine v1.2 (Epic 1, see docs/architecture/ADR-002):
// renders a real, persisted fieldops_wos doc -- NOT an aggregate
// derived from jobs the way this component worked before this
// migration. Still pure rendering: consumes
// computeWorkOrderSignalFromDoc() (domain/workOrderScoring.js), which
// wraps domain/workOrderLifecycle.js's explainWorkOrder() (a pure MAP
// from workOrder.status, never inference from a jobs array -- see that
// file's header comment for why the two paths are kept separate).
//
//   fieldops_wos.status (real, persisted)
//         -> explainWorkOrder() (workOrderLifecycle.js, map-only)
//         -> computeWorkOrderSignalFromDoc() (workOrderScoring.js)
//         -> WorkOrderDetail (here)
//         -> React UI
//
// `jobs` is still accepted as a prop, but now purely for "Operational
// History" display -- Jobs soft-link to this Work Order via
// job.workOrderId === workOrder.id (unenforced, no referential
// integrity -- see ControlTower.jsx). Jobs remain the timeline source,
// unchanged from before this migration.
//
// Epic 2 Phase 2B: dispatcher-side action buttons (MarkReady/Schedule/
// Dispatch/Close/Cancel) now render via WorkOrderActions.jsx, gated by
// domain/workOrderWorkflow.js's getAllowedActions() -- see that file's
// header comment. Technician actions (Accept/Travel/Arrive/WorkStart/
// Complete) are out of scope here; FieldMode.jsx (a separate,
// unmigrated fieldops_jobs-based screen) is untouched by this pass.
//
// Sprint 2.0.3: optional customerName/locationLabel props, used by
// the new WorkOrderDetailPage.jsx (Service > Work Orders detail
// route) to show resolved Account/Location names instead of raw IDs.
// Both fall back to the raw customerId/locationId when absent -- this
// keeps every existing caller (ControlTower.jsx, which doesn't pass
// these) rendering exactly as before, and preserves the fallback
// technicians will still see (technician read access to
// accounts/locations is deliberately not granted -- see
// docs/BusinessEntityModel.md).
export default function WorkOrderDetail({ workOrder, jobs, role, technicians, customerName, locationLabel }) {
  const signal = computeWorkOrderSignalFromDoc(workOrder);
  const { state, isCancelled, reasons } = signal.metadata;
  const history = buildTimeline(jobs);

  const timestampRows = [
    ["Scheduled", workOrder.scheduledStart],
    ["Dispatched", workOrder.dispatchedAt],
    ["Accepted", workOrder.acceptedAt],
    ["En Route", workOrder.enRouteAt],
    ["Arrived", workOrder.arrivedAt],
    ["Work Started", workOrder.workStartedAt],
    ["Completed", workOrder.completedAt],
    ["Closed", workOrder.closedAt],
  ].filter(([, value]) => value != null);

  return (
    <div className="work-order-card">
      <h3>
        {workOrder.woNumber}
        <span className={`wo-status wo-${state.toLowerCase()}`}>{workOrder.status}</span>
        {isCancelled && <span className="wo-status wo-cancelled">CANCELLED</span>}
      </h3>

      <div className="fo-muted">{reasons.join(" · ")}</div>

      <div>
        Priority: {workOrderPriorityText(workOrder.priority) ?? "Priority not set"}
        {workOrder.severity && <> | Severity: {workOrder.severity}</>}
        {" "}| Type: {workOrder.type}
      </div>

      <div>
        Customer: {customerName ?? workOrder.customerId} | Location: {locationLabel ?? workOrder.locationId}
      </div>

      {timestampRows.length > 0 && (
        <div>
          {timestampRows.map(([label, value]) => (
            <span key={label} className="fo-muted">
              {label}: {value.toDate().toLocaleString()}{" "}
            </span>
          ))}
        </div>
      )}

      {(workOrder.complaint || workOrder.diagnosis || workOrder.resolution) && (
        <div>
          {workOrder.complaint && <div>Complaint: {workOrder.complaint}</div>}
          {workOrder.diagnosis && <div>Diagnosis: {workOrder.diagnosis}</div>}
          {workOrder.resolution && <div>Resolution: {workOrder.resolution}</div>}
        </div>
      )}

      {workOrder.inventorySnapshot?.length > 0 && (
        <div className="wo-inventory">
          <h4>Inventory</h4>
          <div className="fo-muted">Visual only -- no inventory engine connected yet.</div>

          <div>
            <strong>Planned Parts:</strong>
            {workOrder.inventorySnapshot
              .filter((item) => item.qtyPlanned)
              .map((item, idx) => {
                // Snapshot-authoritative: name/category/unit come from the Work Order's own
                // recorded inventorySnapshot -- NO catalog lookup. Missing/empty/whitespace/
                // malformed -> raw SKU (name) / "—" (category) / "unit(s)" (unit). All values
                // placed into output go through the safe string projections so a malformed
                // legacy sku (object/array) can never crash the view.
                const sku = snapshotPartSku(item);
                return (
                  <div key={sku || idx}>
                    - {snapshotPartName(item)} ({sku}, {snapshotPartCategory(item)}) &rarr; {item.qtyPlanned} {snapshotPartUnit(item)}
                    {item.notes && <span className="fo-muted"> -- {item.notes}</span>}
                  </div>
                );
              })}
          </div>

          <div>
            <strong>Used Parts:</strong>
            {workOrder.inventorySnapshot.some((item) => item.qtyUsed) ? (
              workOrder.inventorySnapshot
                .filter((item) => item.qtyUsed)
                .map((item, idx) => (
                  <div key={snapshotPartSku(item) || idx}>
                    - {snapshotPartName(item)} &rarr; {item.qtyUsed}
                  </div>
                ))
            ) : (
              <div className="fo-muted">(future: populated during execution phase)</div>
            )}
          </div>
        </div>
      )}

      <WorkOrderActions workOrder={workOrder} role={role} technicians={technicians} />

      {history.length > 0 && (
        <div className="wo-history">
          <h4>Operational History</h4>
          {/* The approximation was conceded only in the source comment below, where no
             user can read it. "History" implies a durable, authoritative record; this is
             DERIVED from job.createdAt, so milestone times are reconstructed rather than
             recorded. Say so on the surface -- a reader quoting a time to a customer
             needs to know which kind of thing they are quoting. */}
          <p className="fo-muted wo-history__basis">
            Reconstructed from Work Order milestones — times are approximate, not a recorded audit trail.
          </p>
          {/* Timestamps are approximated from job.createdAt (see
              timelineBuilder.js) -- displayed as a time-of-day for
              readability, not as a claim of precise event timing. */}
          {history.map((event, index) => (
            <div key={`${event.type}-${event.entity.id}-${index}`} className="wo-history-row">
              <span className="fo-muted">
                {formatClockTime(event.timestamp, { unknown: "—" })}
              </span>{" "}
              <span aria-hidden="true">{EVENT_ICON[event.type] ?? "•"}</span>{" "}
              {describeEvent(event)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
