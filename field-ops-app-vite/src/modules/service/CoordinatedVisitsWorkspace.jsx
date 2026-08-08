import { useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { useCoordinatedOperations } from "../../hooks/useCoordinatedOperations.js";
import { visitReadinessTone, visitReadinessLabel, workOrderStatusTone } from "../../domain/coordinatedVisit.js";
import { normalizeMaterialBlocker, partsReadinessLabel, partsReadinessTone } from "../../domain/coordinatedFieldMission.js";

// Service / Dispatch — COORDINATED VISITS. The user-consumable read of the already-built coordinatedVisit
// projection (functions/src/fulfillment/coordinatedVisit.ts). It exposes the Product truth WITHOUT a new
// authority: the Sales Order is the coordination anchor; each Work Order is individual execution/
// accountability; one coordinated visit = the Work Orders that share a salesOrderId. A dispatcher understands
// in ONE operating context: customer, location, coordinated obligation, related Work Orders / equipment units,
// scheduled context + technician/truck WHERE KNOWN, readiness, blockers, completion progress, and remaining
// obligation. Partial completion is HONEST — 3 of 5 done + 1 blocked is NOT complete.
//
// READ-ONLY + fail-closed: reads a SYNTHETIC source through the injected seam and writes nothing (no Job/Visit/
// WorkOrderGroup, no scheduling authority, no Work Order state write). Missing evidence stays UNKNOWN.

const nameOr = (map, id) => (id && map[id]) || id || "—";

// The related-unit rows for the selected visit: one row per Work Order (per-unit accountability preserved).
// Shows the unit, its status, scheduled context + technician/truck WHERE KNOWN (honest "unscheduled/unassigned"
// otherwise), and any material blocker (routed honestly — see MaterialBlockerNote).
function UnitRow({ wo, opContext, signal }) {
  const op = opContext ?? {};
  const blocker = normalizeMaterialBlocker(signal?.materialBlocker);
  return (
    <li className="fo-covisit-unit">
      <div className="fo-covisit-unit__head">
        <span className="fo-covisit-unit__label">{wo.equipmentLabel || wo.woNumber || wo.id}</span>
        <StatusPill tone={workOrderStatusTone(wo.status)} label={wo.status || "Unknown"} asText />
      </div>
      <div className="fo-covisit-unit__meta">
        <span className="fo-covisit-unit__wo">{wo.woNumber || wo.id}</span>
        <span className="fo-muted">
          {op.scheduledWindow ? op.scheduledWindow : "Unscheduled"}
          {" · "}
          {op.technicianName ? op.technicianName : "Unassigned tech"}
          {op.truckName ? ` · ${op.truckName}` : ""}
        </span>
      </div>
      {signal?.partsReadiness && signal.partsReadiness !== "READY" && (
        <div className="fo-covisit-unit__parts">
          <StatusPill tone={partsReadinessTone(signal.partsReadiness)} label={partsReadinessLabel(signal.partsReadiness)} asText />
        </div>
      )}
      {blocker && <MaterialBlockerNote blocker={blocker} />}
    </li>
  );
}

// Service ↔ Inventory: expose the material-blocker CONNECTION. The blocked part is named; the resolution is
// shown ONLY if the canonical replenishment/Purchasing substrate is connected — otherwise it is honestly
// UNKNOWN and routed there, never a fabricated ETA/availability.
function MaterialBlockerNote({ blocker }) {
  return (
    <p className="fo-covisit-blocker fo-muted">
      Material blocker: <strong>{blocker.partRef}</strong>
      {blocker.shortBy != null ? ` (short ${blocker.shortBy})` : ""} —{" "}
      {blocker.replenishmentConnected
        ? `replenishment: ${blocker.resolution}`
        : "replenishment status not connected (routed to Inventory / Purchasing)"}
    </p>
  );
}

function VisitDetail({ visit, ctx }) {
  if (!visit) return <p className="fo-muted">Select a coordinated visit to see its detail.</p>;
  const facts = [
    { key: "customer", label: "Customer", value: nameOr(ctx.accountNameById, visit.customerId) },
    { key: "location", label: "Location", value: nameOr(ctx.locationNameById, visit.locationId) },
    { key: "obligation", label: "Coordinated obligation", value: `${visit.total} equipment unit${visit.total === 1 ? "" : "s"}` },
    { key: "readiness", label: "Readiness", value: <StatusPill tone={visitReadinessTone(visit.readiness)} label={visitReadinessLabel(visit.readiness)} /> },
  ];
  return (
    <div className="fo-covisit-detail">
      <ContextBand items={facts} />
      <p className="fo-covisit-anchor fo-muted">{ctx.salesOrderLabelById[visit.salesOrderId] || visit.salesOrderId}</p>
      {!visit.contextConsistent && (
        <p className="fo-covisit-warn">
          <StatusPill tone="attention" label="Units disagree on customer/location" asText /> — data to reconcile.
        </p>
      )}
      <section className="fo-covisit-block">
        <h4>Completion progress</h4>
        <p>
          <span className="fo-covisit-count">{`${visit.completed} of ${visit.total} complete`}</span>
          {visit.blocked > 0 ? <> · <StatusPill tone="attention" label={`${visit.blocked} blocked`} asText /></> : null}
          {` · ${visit.remaining} remaining`}
        </p>
        {visit.completed < visit.total && (
          <p className="fo-muted">Not complete — {visit.remaining} unit{visit.remaining === 1 ? "" : "s"} outstanding.</p>
        )}
      </section>
      <section className="fo-covisit-block">
        <h4>Related Work Orders / equipment units</h4>
        <ul className="fo-covisit-units">
          {visit.workOrders.map((wo) => (
            <UnitRow
              key={wo.id}
              wo={wo}
              opContext={ctx.operationalContextByWorkOrderId[wo.id]}
              signal={ctx.fieldSignalsByWorkOrderId[wo.id]}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

// One scannable visit row (the coordination queue). Attention-first sorting is done in the hook.
function VisitRow({ visit, ctx, selected, onSelect }) {
  return (
    <tr
      className={`fo-sales-row ${selected ? "is-selected" : ""} ${visit.readiness === "ATTENTION" ? "is-attention" : ""}`.trim()}
      onClick={() => onSelect(visit.salesOrderId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(visit.salesOrderId); } }}
      aria-selected={selected}
    >
      <td className="fo-sales-row__customer" data-label="Customer">{nameOr(ctx.accountNameById, visit.customerId)}</td>
      <td className="fo-sales-col--secondary" data-label="Location">{nameOr(ctx.locationNameById, visit.locationId)}</td>
      <td data-label="Progress">{visit.completed}/{visit.total}{visit.blocked > 0 ? ` · ${visit.blocked} blocked` : ""}</td>
      <td className="fo-sales-col--secondary" data-label="Remaining">{visit.remaining}</td>
      <td data-label="Readiness"><StatusPill tone={visitReadinessTone(visit.readiness)} label={visitReadinessLabel(visit.readiness)} asText /></td>
    </tr>
  );
}

// Props are optional injection seams for tests: `source` defaults to the synthetic coordinated-operations
// source. Production renders <CoordinatedVisitsWorkspace /> with no props (read-only synthetic).
export default function CoordinatedVisitsWorkspace({ source } = {}) {
  const { status, synthetic, visits, ...ctx } = useCoordinatedOperations(source);
  const [selectedId, setSelectedId] = useState(null);

  const selected = useMemo(
    () => visits.find((v) => v.salesOrderId === selectedId) ?? visits[0] ?? null,
    [visits, selectedId]
  );

  const needsAttention = visits.filter((v) => v.readiness === "ATTENTION").length;
  const ready = visits.filter((v) => v.readiness === "READY").length;
  const contextItems = [
    { key: "open", label: "Coordinated visits", value: visits.length },
    { key: "attention", label: "Needs attention", value: needsAttention },
    { key: "ready", label: "Ready", value: ready },
  ];
  const attention = needsAttention > 0 ? (
    <p className="fo-sales-attention">
      <StatusPill tone="attention" label={`${needsAttention} visit${needsAttention === 1 ? "" : "s"} need attention`} />
      <span className="fo-muted"> — sorted to the top.</span>
    </p>
  ) : null;

  return (
    <WorkspaceShell
      title="Coordinated Visits"
      density="compact"
      context={<ContextBand items={contextItems} />}
      attention={attention}
      supporting={<VisitDetail visit={selected} ctx={ctx} />}
    >
      {synthetic && (
        <p className="fo-sales-banner fo-muted">
          Showing a synthetic sample coordinated visit (C713×5). The live coordinated-operations feed connects in
          a later cycle.
        </p>
      )}
      {status !== "ready" ? (
        <p className="fo-muted">The coordinated-operations source is not connected yet.</p>
      ) : visits.length === 0 ? (
        <p className="fo-muted">No coordinated visits.</p>
      ) : (
        <div className="fo-sales-pipeline-wrap">
          <table className="fo-sales-pipeline">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="fo-sales-col--secondary">Location</th>
                <th>Progress</th>
                <th className="fo-sales-col--secondary">Remaining</th>
                <th>Readiness</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <VisitRow key={v.salesOrderId} visit={v} ctx={ctx} selected={selected?.salesOrderId === v.salesOrderId} onSelect={setSelectedId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceShell>
  );
}
