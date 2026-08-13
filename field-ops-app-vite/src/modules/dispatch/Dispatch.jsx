import { useMemo, useState } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import { TECHNICIANS_COLLECTION, TECH_STATUS } from "../../domain/constants";
import { FIELD_PHASE, fieldPhase } from "../../domain/fieldWorkOrder";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { computeJobRisk } from "../../domain/jobRiskScoring";
import { SEVERITY } from "../../domain/controlTower/types";
import { isHeroActiveJob, isHeroTechnician } from "../../demo/heroConfig";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";

// F0 -- this IS now the canonical Work Order dispatch surface. It reads
// fieldops_wos and assigns by invoking the governed `Dispatch` transition
// (transitionWorkOrder), which sets assignedTechId and writes the lifecycle
// timestamp server-side. The legacy assignJob() client transaction against
// fieldops_jobs is no longer used here.
//
// Assigns pending jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// realtime listeners. The write goes through the governed Dispatch
// transition, which re-checks permission and lifecycle server-side so two
// dispatchers can't both win the same technician.
//
// Sprint 3.6.4: visual-only upgrade. Shows every job (not just
// unassigned ones) with a status/priority chip, so the board reads as a
// full dispatch view rather than just a to-do queue. The chip for
// OPEN/ASSIGNED jobs reuses the existing risk severity engine
// (domain/jobRiskScoring.js -- already-derived, no new logic here) to
// label them Emergency (HIGH/CRITICAL) vs Scheduled (MEDIUM/LOW). No new
// backend logic, no schema change -- assign() below is byte-for-byte the
// same governed Dispatch transition this screen already invoked.
//
// Hero-story follow-up: pins demo/heroConfig.js's hero job to the top and
// pre-selects the hero technician in its assign dropdown. Pure display
// ordering/defaultValue -- no data mutation, no change to assign()'s
// call, and any job/technician not matching the hero config renders
// exactly as before.

// Chips read the governed operational phase, so all eleven statuses are
// covered without this surface enumerating them.
const PHASE_CHIP = {
  [FIELD_PHASE.ON_SITE]: { label: "In Progress", tone: "in-progress" },
  [FIELD_PHASE.FINISHED]: { label: "Completed", tone: "completed" },
};

function priorityChip(job) {
  // This chip reads computeJobRisk(), which is DERIVED from how long a job has been
  // sitting and what state it is in -- age and status factors. It is not a customer-
  // declared priority, and this platform has no such field.
  //
  // It used to render that score as "Emergency". A dispatcher persona reported
  // routine PM work badged red and read the queue as full of emergencies. "At risk"
  // is what the number actually supports: this job needs attention because it is
  // aging or stuck, which is a claim the data can carry.
  const risk = computeJobRisk(job);
  const atRisk = risk && (risk.severity === SEVERITY.HIGH || risk.severity === SEVERITY.CRITICAL);
  return atRisk ? { label: "At risk", tone: "emergency" } : { label: "Scheduled", tone: "scheduled" };
}

function statusChipFor(job) {
  return PHASE_CHIP[fieldPhase(job)] ?? priorityChip(job);
}

export default function Dispatch() {
  const { data: jobs, loading, error } = useWorkOrders();
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [dispatchError, setDispatchError] = useState(null);

  const technicianName = (id) => technicians.find((t) => t.id === id)?.name;
  const heroTechnician = technicians.find(
    (t) => isHeroTechnician(t.name) && t.status === TECH_STATUS.AVAILABLE
  );

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => (isHeroActiveJob(b.woNumber) ? 1 : 0) - (isHeroActiveJob(a.woNumber) ? 1 : 0)),
    [jobs]
  );

  // Governed dispatch: the server sets assignedTechId, enforces the
  // CREATED/READY_TO_DISPATCH/SCHEDULED -> DISPATCHED transition and the
  // admin/dispatcher permission, and writes the timestamp. Nothing about the
  // assignment is decided client-side.
  async function assign(job, technicianId) {
    if (!technicianId) return;
    setDispatchError(null);
    const technician = technicians.find((t) => t.id === technicianId);
    if (!technician) return;
    try {
      await transitionWorkOrder(job.id, "Dispatch", { assignedTechId: technicianId });
    } catch (err) {
      console.error(err);
      setDispatchError(workflowActionErrorMessage(err));
    }
  }

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>
      {dispatchError && <p className="fo-error" role="alert">{dispatchError}</p>}

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : error ? (
        // Fail VISIBLY. A denied/unavailable read used to fall through to
        // "No work orders yet" -- a false empty board a dispatcher could read
        // as nothing to do, missing real jobs with no indication of failure.
        <p className="fo-muted" role="alert">
          {loadErrorMessage(error, { entity: "work orders" })}
        </p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        sortedJobs.map((job) => {
          const chip = statusChipFor(job);
          const isHero = isHeroActiveJob(job.woNumber);
          return (
            <div
              key={job.id}
              className={`fo-card fo-card--dispatch fo-card--dispatch-${chip.tone}${isHero ? " fo-card--hero" : ""}`}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3>
                  {job.woNumber ?? job.id}
                  {isHero && <span className="fo-chip fo-chip-hero">Active Demo Job</span>}
                </h3>
                <span className={`fo-chip fo-chip-${chip.tone}`}>{chip.label}</span>
              </div>
              <p>{job.description}</p>

              {/* The governed engine allows Dispatch only from SCHEDULED
                  (CREATED -> READY_TO_DISPATCH -> SCHEDULED -> DISPATCHED).
                  Asking the engine rather than assuming means this control is
                  never offered where the transition would be rejected -- and
                  scheduling is NOT fabricated here, because Schedule requires a
                  real scheduledStart/End/TechId decision this board does not
                  make. */}
              {!getAllowedActions(job.status, "dispatcher", false).includes("Dispatch") ? (
                <div className="fo-muted">
                  {job.assignedTechId
                    ? `Assigned to ${technicianName(job.assignedTechId) ?? job.assignedTechId}`
                    : "Not ready to dispatch — this work order must be scheduled first."}
                </div>
              ) : !job.assignedTechId ? (
                <select
                  key={heroTechnician?.id ?? "none"}
                  defaultValue={isHero && heroTechnician ? heroTechnician.id : ""}
                  onChange={(e) => assign(job, e.target.value)}
                >
                  <option value="" disabled>
                    Select technician…
                  </option>
                  {technicians
                    .filter((t) => t.status === TECH_STATUS.AVAILABLE)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              ) : (
                <div className="fo-muted">Assigned to {technicianName(job.assignedTechId) ?? job.assignedTechId}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
