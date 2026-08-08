import { useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { useCoordinatedOperations } from "../../hooks/useCoordinatedOperations.js";
import {
  buildCoordinatedFieldMission,
  missionReadinessTone, missionReadinessLabel,
  unitReadinessTone, unitReadinessLabel,
  partsReadinessLabel, partsReadinessTone,
  loadVerifiedLabel, loadVerifiedTone,
} from "../../domain/coordinatedFieldMission.js";
import { visitReadinessLabel } from "../../domain/coordinatedVisit.js";

// Technician — COORDINATED FIELD MISSION. The user-consumable read of the already-built coordinatedFieldMission
// projection (functions/src/fulfillment/coordinatedFieldMission.ts). The technician understands ONE customer
// mission with N equipment-specific executions: the Work Orders keep INDEPENDENT execution + per-equipment
// completion (they are NOT merged into one record); what is SHARED is surfaced once — customer/location,
// mission context, related units, coordinated load/readiness, blockers, and overall progress.
//
// HONEST readiness (F1/F2): missing evidence ⇒ UNKNOWN, never a fake READY. Parts/load signals are injected
// from governed sources; a material blocker whose replenishment substrate is not connected stays UNKNOWN and
// routed. Read-only + fail-closed — the surface writes nothing (no completion, no load write, no WO state).

const nameOr = (map, id) => (id && map[id]) || id || "—";

// One equipment unit's execution card. Independent Work Order; per-equipment completion + readiness preserved.
function UnitCard({ unit }) {
  const mb = unit.materialBlocker;
  return (
    <li className="fo-mission-unit">
      <div className="fo-mission-unit__head">
        <span className="fo-mission-unit__label">{unit.equipmentLabel || unit.woNumber || unit.workOrderId}</span>
        <StatusPill tone={unitReadinessTone(unit.unitReadiness)} label={unitReadinessLabel(unit.unitReadiness)} />
      </div>
      <div className="fo-mission-unit__meta fo-muted">
        {unit.woNumber || unit.workOrderId} · {unit.status || "status unknown"}
      </div>
      <div className="fo-mission-unit__signals">
        <StatusPill tone={partsReadinessTone(unit.partsReadiness)} label={partsReadinessLabel(unit.partsReadiness)} asText />
        <StatusPill tone={loadVerifiedTone(unit.loadVerified)} label={loadVerifiedLabel(unit.loadVerified)} asText />
      </div>
      {mb && (
        // Service ↔ Inventory material blocker — the part is named; resolution shown only if the canonical
        // replenishment substrate is connected, otherwise honestly UNKNOWN + routed (never a fabricated ETA).
        <p className="fo-mission-unit__blocker fo-muted">
          Material blocker: <strong>{mb.partRef}</strong>{mb.shortBy != null ? ` (short ${mb.shortBy})` : ""} —{" "}
          {mb.replenishmentConnected ? `replenishment: ${mb.resolution}` : "replenishment not connected (routed to Inventory / Purchasing)"}
        </p>
      )}
    </li>
  );
}

function Mission({ mission, ctx }) {
  const facts = [
    { key: "customer", label: "Customer", value: nameOr(ctx.accountNameById, mission.customerId) },
    { key: "location", label: "Location", value: nameOr(ctx.locationNameById, mission.locationId) },
    { key: "load", label: "Coordinated load", value: <StatusPill tone={missionReadinessTone(mission.loadReadiness)} label={visitReadinessLabel(mission.loadReadiness)} /> },
    { key: "readiness", label: "Mission readiness", value: <StatusPill tone={missionReadinessTone(mission.missionReadiness)} label={missionReadinessLabel(mission.missionReadiness)} /> },
  ];
  const p = mission.progress;
  return (
    <div className="fo-mission">
      <ContextBand items={facts} />
      <p className="fo-mission__anchor fo-muted">{ctx.salesOrderLabelById[mission.salesOrderId] || mission.salesOrderId}</p>
      {!mission.contextConsistent && (
        <p className="fo-covisit-warn"><StatusPill tone="attention" label="Units disagree on customer/location" asText /></p>
      )}
      <section className="fo-mission__progress">
        <h4>Overall progress</h4>
        <p>
          <span className="fo-mission-count">{`${p.completed} of ${p.total} complete`}</span>
          {p.blocked > 0 ? <> · <StatusPill tone="attention" label={`${p.blocked} blocked`} asText /></> : null}
          {` · ${p.remaining} remaining`}
        </p>
        {p.completed < p.total && <p className="fo-muted">Mission not complete — each unit is completed independently.</p>}
      </section>
      <section className="fo-mission__units">
        <h4>Equipment units ({p.total})</h4>
        <ul className="fo-mission-units">
          {mission.units.map((u) => <UnitCard key={u.workOrderId} unit={u} />)}
        </ul>
      </section>
    </div>
  );
}

// Props: `source` optional injection seam for tests. Production renders <CoordinatedMissionView /> (synthetic).
export default function CoordinatedMissionView({ source } = {}) {
  const { status, synthetic, visits, fieldSignalsByWorkOrderId, ...ctx } = useCoordinatedOperations(source);
  const [selectedId, setSelectedId] = useState(null);

  // A technician is on ONE mission at a time; default to the attention-first visit (hook already sorts).
  const selectedVisit = useMemo(
    () => visits.find((v) => v.salesOrderId === selectedId) ?? visits[0] ?? null,
    [visits, selectedId]
  );
  const mission = useMemo(
    () => (selectedVisit ? buildCoordinatedFieldMission(selectedVisit, fieldSignalsByWorkOrderId) : null),
    [selectedVisit, fieldSignalsByWorkOrderId]
  );

  // Minimal mission switcher when the technician has more than one coordinated mission.
  const switcher = visits.length > 1 ? (
    <div className="fo-mission-switch">
      {visits.map((v) => (
        <button
          key={v.salesOrderId}
          type="button"
          className={`fo-btn-ghost ${selectedVisit?.salesOrderId === v.salesOrderId ? "is-active" : ""}`.trim()}
          onClick={() => setSelectedId(v.salesOrderId)}
        >
          {nameOr(ctx.accountNameById, v.customerId)}
          {/* A technician saw a SAMPLE "unit 3 COMPLETED" beside their real "unit 3 Working".
              Same model, same unit number, opposite status. The tab must say which is which. */}
          {synthetic && <span className="fo-sample-badge">SAMPLE</span>}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <WorkspaceShell title="Coordinated Mission" density="field" context={switcher}>
      {synthetic && (
        <p className="fo-sales-banner fo-muted">
          Showing a synthetic sample mission (C713×5). The live coordinated-operations feed connects in a later cycle.
        </p>
      )}
      {status !== "ready" ? (
        <p className="fo-muted">The coordinated-operations source is not connected yet.</p>
      ) : !mission ? (
        <p className="fo-muted">No coordinated mission assigned.</p>
      ) : (
        <Mission mission={mission} ctx={ctx} />
      )}
    </WorkspaceShell>
  );
}
