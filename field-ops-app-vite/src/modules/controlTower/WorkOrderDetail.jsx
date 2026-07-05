import { computeWorkOrderSignalFromDoc } from "../../domain/workOrderScoring";
import { buildTimeline } from "../../domain/timelineBuilder";
import { describeEvent } from "../../domain/eventModel";
import { EVENT_ICON } from "../../domain/eventTypes";
import { getCatalogItem } from "../../data/partsCatalog";

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
// No action buttons yet (Accept/Travel/Arrive/Complete/Dispatch/Cancel)
// -- Phase 2, deliberately deferred. See the TODO block below for where
// they'll go, gated by domain/workOrderWorkflow.js's getAllowedActions().
export default function WorkOrderDetail({ workOrder, jobs }) {
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
        Priority: {workOrder.priority}
        {workOrder.severity && <> | Severity: {workOrder.severity}</>}
        {" "}| Type: {workOrder.type}
      </div>

      <div>
        Customer: {workOrder.customerId} | Location: {workOrder.locationId}
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
              .map((item) => {
                const catalogEntry = getCatalogItem(item.sku);
                const displayName = item.name || catalogEntry?.name || item.sku;
                return (
                  <div key={item.sku}>
                    - {displayName} ({item.sku}
                    {catalogEntry?.category ? `, ${catalogEntry.category}` : item.category ? `, ${item.category}` : ""}
                    ) &rarr; {item.qtyPlanned} {catalogEntry?.unit ?? "unit(s)"}
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
                .map((item) => (
                  <div key={item.sku}>
                    - {item.name || getCatalogItem(item.sku)?.name || item.sku} &rarr; {item.qtyUsed}
                  </div>
                ))
            ) : (
              <div className="fo-muted">(future: populated during execution phase)</div>
            )}
          </div>
        </div>
      )}

      {/* Phase 2 TODO: Accept/Travel/Arrive/Complete (technician) and
          Schedule/Dispatch/Close/Cancel (dispatcher) action buttons go
          here, each gated by
          domain/workOrderWorkflow.js's getAllowedActions(workOrder.status,
          role, isOwnAssignment) so only currently-valid, currently-
          permitted actions render. Not implemented this pass -- see
          docs/architecture/ADR-002-work-order-engine.md. */}

      {history.length > 0 && (
        <div className="wo-history">
          <h4>Operational History</h4>
          {/* Timestamps are approximated from job.createdAt (see
              timelineBuilder.js) -- displayed as a time-of-day for
              readability, not as a claim of precise event timing. */}
          {history.map((event, index) => (
            <div key={`${event.type}-${event.entity.id}-${index}`} className="wo-history-row">
              <span className="fo-muted">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
