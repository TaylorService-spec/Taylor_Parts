import { useMemo, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { useWorkOrderTechnicians } from "../../hooks/useWorkOrderTechnicians";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useMyWorkOrderCapabilities } from "../../hooks/useMyWorkOrderCapabilities";
import { mergeTechnicianDirectories, techniciansFromWorkOrders } from "../../domain/workOrderAdapter.js";
import { suggestWorkOrderPlacement } from "../../services/workOrderService";
import { FIELD_PHASE, fieldPhase } from "../../domain/fieldWorkOrder";
import { computeJobRisk } from "../../domain/jobRiskScoring";
import { SEVERITY } from "../../domain/controlTower/types";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { placementWindow } from "../../domain/dispatchBoardGeometry.js";
import { JOB_SECTION, groupJobs } from "../../domain/jobsDispatchList.js";
import { Button } from "../../shared/ui/primitives/index.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import PlacementDialog, { PLACEMENT_INTENT } from "../dispatcherBoard/PlacementDialog.jsx";
import { usePlacementCommands } from "../dispatcherBoard/usePlacementCommands.js";

// THE JOBS PAGE — the list view of the same dispatch work the Dispatcher Board shows on a timeline.
//
// ════════════════════ ONE AUTHORITY, TWO VIEWS (Owner "FIX JOBS AND DISPATCH", 2026-10-16) ════════════════════
//
// Since the governed cutover a Work Order gets its technician when it is SCHEDULED (the adapter carries the one governed
// assignee as assignedTechId), so this page's old branch — "pick a technician to dispatch an UNASSIGNED job" — never
// matched anything, and every scheduled job showed "Assigned to X" with no control: nothing could be dispatched here.
// The page now acts through exactly what the Board uses:
//
//   * reads    — the governed Work Order list (useWorkOrders) and roster (useWorkOrderTechnicians); no Firestore;
//   * commands — usePlacementCommands (the Board's runner): Schedule, Move, Reassign (typed reason, H20/ND-18) and the
//                governed Dispatch transition — every one re-checked server-side;
//   * the Schedule dialog — the Board's PlacementDialog, defaulted by the governed suggestWorkOrderPlacement (earliest
//                valid window, company business time zone), re-checked on submit;
//   * what is OFFERED — the caller's own governed capabilities (readMyWorkOrderCapabilities): Schedule/Move/Reassign need
//                workOrder.lifecycle.schedule, Dispatch needs workOrder.lifecycle.dispatch. Fail closed while unknown.
//
// Rows are grouped by what can be done next (domain/jobsDispatchList.js). No demo fixture, hero job or hero technician
// is referenced here (heroConfig.js stays demo/test-only); the chips below read the governed status and the derived risk.

const SCHEDULE_CAPABILITY = "workOrder.lifecycle.schedule";
const DISPATCH_CAPABILITY = "workOrder.lifecycle.dispatch";

// Chips read the governed operational phase, so all eleven statuses are covered without this surface enumerating them.
const PHASE_CHIP = {
  [FIELD_PHASE.ON_SITE]: { label: "In Progress", tone: "in-progress" },
  [FIELD_PHASE.FINISHED]: { label: "Completed", tone: "completed" },
};

function priorityChip(job) {
  // computeJobRisk() is DERIVED from age and state, not a customer-declared priority — so "At risk", never "Emergency".
  const risk = computeJobRisk(job);
  const atRisk = risk && (risk.severity === SEVERITY.HIGH || risk.severity === SEVERITY.CRITICAL);
  return atRisk ? { label: "At risk", tone: "emergency" } : { label: "Scheduled", tone: "scheduled" };
}

// CANCELLED is checked against the real governed status ahead of the phase projection (which folds it into FINISHED),
// so a cancelled job never wears the green "Completed" chip.
function statusChipFor(job) {
  if (job?.status === "CANCELLED") return { label: "Cancelled", tone: "emergency" };
  return PHASE_CHIP[fieldPhase(job)] ?? priorityChip(job);
}

const whenText = (wo) => {
  const w = placementWindow(wo);
  if (!w) return null;
  const f = (ms, opts) => new Date(ms).toLocaleString(undefined, opts);
  return `${f(w.startMillis, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${f(w.endMillis, { hour: "numeric", minute: "2-digit" })}`;
};

export default function Dispatch() {
  const { data: jobs, loading, error } = useWorkOrders();
  // The technicians read can fail independently; the screen says so instead of offering an empty picker.
  const { data: roster, error: techniciansError } = useWorkOrderTechnicians();
  const technicians = useMemo(() => mergeTechnicianDirectories(roster, techniciansFromWorkOrders(jobs)), [roster, jobs]);
  const caps = useMyWorkOrderCapabilities();
  // Schedule, Move and Reassign need the roster for their technician picker; Dispatch does not (it goes to the scheduled
  // technician). A failed roster read therefore withdraws the first three and keeps Dispatch, and the notice says exactly that.
  const holdsSchedule = caps.has(SCHEDULE_CAPABILITY);
  const canSchedule = holdsSchedule && !techniciansError;
  const canDispatch = caps.has(DISPATCH_CAPABILITY);
  const { runPlacement, dispatchTo, busyWorkOrderId, message } = usePlacementCommands({ workOrders: jobs, technicians });
  const [pending, setPending] = useState(null);
  const sections = useMemo(() => groupJobs(jobs), [jobs]);
  const inRouter = useInRouterContext();

  const technicianName = (id) => resolveTechnicianIdentity(id, { technicians, error: techniciansError }).name;

  const openDialog = (intent, wo) => setPending({
    intent, workOrder: wo,
    technicianId: intent === PLACEMENT_INTENT.SCHEDULE ? null : (wo.scheduledTechId ?? null),
    durationMinutes: placementWindow(wo)?.durationMinutes ?? wo.estimatedDurationMinutes ?? 120,
    errorMessage: null,
  });
  const confirm = async (payload) => {
    const outcome = await runPlacement(payload);
    if (outcome.ok) setPending(null);
    else setPending((p) => (p ? { ...p, errorMessage: outcome.message } : null));
  };

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>
      {message ? (
        <p className={message.tone === "error" ? "fo-error" : "fo-muted"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>
      ) : null}
      {techniciansError && (
        <p className="fo-scan__notice fo-scan__notice--warn" role="alert">
          Technicians could not be loaded, so scheduling, moving and reassigning are unavailable{caps.has(DISPATCH_CAPABILITY) ? " (dispatching to the scheduled technician still works)" : ""}.
          {" "}{loadErrorMessage(techniciansError, { entity: "technicians" })}
        </p>
      )}
      {caps.status === "ready" && !holdsSchedule && !canDispatch ? (
        <p className="fo-muted" role="status">You can see these jobs, but scheduling and dispatching are not part of your access.</p>
      ) : null}

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : error ? (
        // Fail VISIBLY: a denied/unavailable read is never a false empty board.
        <p className="fo-muted" role="alert">{loadErrorMessage(error, { entity: "work orders" })}</p>
      ) : (jobs ?? []).length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        sections.map(({ section, title, items }) => (
          <section key={section} className="fo-dispatch__section" aria-label={title}>
            <h2 className="fo-dispatch__section-title">{title} <span className="fo-muted">({items.length})</span></h2>
            {items.map((job) => {
              const chip = statusChipFor(job);
              const busy = busyWorkOrderId === job.id;
              const when = whenText(job);
              const tech = job.scheduledTechId ?? job.assignedTechId ?? null;
              return (
                <div key={job.id} className={`fo-card fo-card--dispatch fo-card--dispatch-${chip.tone}`}>
                  <div className="fo-dispatch__card-head">
                    <h3>{job.woNumber ?? job.id}</h3>
                    <span className={`fo-chip fo-chip-${chip.tone}`}>{chip.label}</span>
                  </div>
                  <p className="fo-muted">
                    {[job.customerName, when].filter(Boolean).join(" · ")}
                  </p>
                  {job.description ? <p>{job.description}</p> : null}
                  {job.id && inRouter ? <p><Link to={`/service/work-orders/${job.id}`}>Open work order</Link></p> : null}

                  {section === JOB_SECTION.READY_TO_DISPATCH ? (
                    tech ? (
                      <div className="fo-dispatch__actions">
                        <span className="fo-muted">Scheduled for {technicianName(tech)}</span>
                        {canDispatch ? (
                          <Button onClick={() => dispatchTo(job, tech)} loading={busy} disabled={busy}>
                            Dispatch to {technicianName(tech)}
                          </Button>
                        ) : null}
                        {canSchedule ? (
                          <>
                            <Button variant="secondary" onClick={() => openDialog(PLACEMENT_INTENT.REASSIGN, job)} disabled={busy}>Reassign…</Button>
                            <Button variant="secondary" onClick={() => openDialog(PLACEMENT_INTENT.RESCHEDULE, job)} disabled={busy}>Move…</Button>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="fo-dispatch__actions">
                        <span className="fo-muted">Scheduled, but no technician is recorded — choose one before dispatching.</span>
                        {canSchedule ? <Button variant="secondary" onClick={() => openDialog(PLACEMENT_INTENT.REASSIGN, job)} disabled={busy}>Choose technician…</Button> : null}
                      </div>
                    )
                  ) : section === JOB_SECTION.TO_SCHEDULE ? (
                    <div className="fo-dispatch__actions">
                      <span className="fo-muted">Waiting to be scheduled — this work order must be scheduled first.</span>
                      {canSchedule ? <Button onClick={() => openDialog(PLACEMENT_INTENT.SCHEDULE, job)} disabled={busy}>Schedule…</Button> : null}
                    </div>
                  ) : section === JOB_SECTION.NOT_READY ? (
                    <div className="fo-muted">Not ready to dispatch — this work order must be scheduled first, and it has not been marked ready to schedule yet.</div>
                  ) : job.status === "CANCELLED" && !tech ? (
                    <div className="fo-muted">This work order was cancelled before it was dispatched — no further action is needed.</div>
                  ) : tech ? (
                    <div className="fo-muted">Assigned to {technicianName(tech)}</div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))
      )}

      {pending ? (
        <PlacementDialog
          intent={pending.intent}
          workOrder={pending.workOrder}
          technicians={technicians}
          defaultTechnicianId={pending.technicianId}
          defaultStartMillis={null}
          defaultDurationMinutes={pending.durationMinutes}
          suggestPlacement={pending.intent === PLACEMENT_INTENT.REASSIGN ? null : suggestWorkOrderPlacement}
          submitting={busyWorkOrderId === pending.workOrder.id}
          errorMessage={pending.errorMessage}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
