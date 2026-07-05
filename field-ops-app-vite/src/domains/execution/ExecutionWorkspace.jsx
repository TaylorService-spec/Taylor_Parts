// Moved from modules/dispatch/Dispatch.jsx as part of the domain-routing
// scaffold (structural only -- no logic changed, only the default export's
// name, to match this file's name). App.jsx still renders this directly
// under its existing "dispatch" tab; this file is not yet reachable via
// the new src/app/AppRouter.jsx scaffold (not wired into main.jsx yet).
import { useMemo } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { assignJob } from "../../domain/jobActions";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { computeJobRisk } from "../../domain/jobRiskScoring";
import { SEVERITY } from "../../domain/controlTower/types";
import { isHeroActiveJob, isHeroTechnician } from "../../demo/heroConfig";

// Assigns pending jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// realtime listeners. The write itself goes through assignJob(), which
// re-checks technician availability inside a Firestore transaction so two
// dispatchers can't both win the same technician.
//
// Sprint 3.6.4: visual-only upgrade. Shows every job (not just
// unassigned ones) with a status/priority chip, so the board reads as a
// full dispatch view rather than just a to-do queue. The chip for
// OPEN/ASSIGNED jobs reuses the existing risk severity engine
// (domain/jobRiskScoring.js -- already-derived, no new logic here) to
// label them Emergency (HIGH/CRITICAL) vs Scheduled (MEDIUM/LOW). No new
// backend logic, no schema change -- assign() below is byte-for-byte the
// same call into assignJob() this screen already made.
//
// Hero-story follow-up: pins demo/heroConfig.js's hero job to the top and
// pre-selects the hero technician in its assign dropdown. Pure display
// ordering/defaultValue -- no data mutation, no change to assign()'s
// call, and any job/technician not matching the hero config renders
// exactly as before.

const STATUS_CHIP = {
  [JOB_STATUS.IN_PROGRESS]: { label: "In Progress", tone: "in-progress" },
  [JOB_STATUS.COMPLETE]: { label: "Completed", tone: "completed" },
};

function priorityChip(job) {
  const risk = computeJobRisk(job);
  const isEmergency = risk && (risk.severity === SEVERITY.HIGH || risk.severity === SEVERITY.CRITICAL);
  return isEmergency ? { label: "Emergency", tone: "emergency" } : { label: "Scheduled", tone: "scheduled" };
}

function statusChipFor(job) {
  return STATUS_CHIP[job.status] ?? priorityChip(job);
}

export default function ExecutionWorkspace() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const technicianName = (id) => technicians.find((t) => t.id === id)?.name;
  const heroTechnician = technicians.find(
    (t) => isHeroTechnician(t.name) && t.status === TECH_STATUS.AVAILABLE
  );

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => (isHeroActiveJob(b.customer) ? 1 : 0) - (isHeroActiveJob(a.customer) ? 1 : 0)),
    [jobs]
  );

  async function assign(job, technicianId) {
    if (!technicianId) return;
    const technician = technicians.find((t) => t.id === technicianId);
    if (!technician) return;
    try {
      await assignJob(job, technician);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        sortedJobs.map((job) => {
          const chip = statusChipFor(job);
          const isHero = isHeroActiveJob(job.customer);
          return (
            <div
              key={job.id}
              className={`fo-card fo-card--dispatch fo-card--dispatch-${chip.tone}${isHero ? " fo-card--hero" : ""}`}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3>
                  {job.customer}
                  {isHero && <span className="fo-chip fo-chip-hero">Active Demo Job</span>}
                </h3>
                <span className={`fo-chip fo-chip-${chip.tone}`}>{chip.label}</span>
              </div>
              <p>{job.description}</p>

              {!job.technicianId ? (
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
                <div className="fo-muted">Assigned to {technicianName(job.technicianId) ?? job.technicianId}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
