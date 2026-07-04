import { useMemo } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { assignJob } from "../../domain/jobActions";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { computeJobRisk, computeAgeHours } from "../../domain/jobRiskScoring";
import { activeJobCount } from "../../domain/dispatchScoring";
import { rankJobsByPriority } from "../../domain/dispatchEngine";
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

// Risk-derived chip (Emergency/Scheduled), distinct from the new
// priority-field badge below -- kept the pre-existing name/behavior,
// just renamed from priorityChip() to avoid reader confusion between
// "risk-derived chip" (this) and "job.priority badge" (PRIORITY_CHIP).
function riskChip(job) {
  const risk = computeJobRisk(job);
  const isEmergency = risk && (risk.severity === SEVERITY.HIGH || risk.severity === SEVERITY.CRITICAL);
  return isEmergency ? { label: "Emergency", tone: "emergency" } : { label: "Scheduled", tone: "scheduled" };
}

function statusChipFor(job) {
  return STATUS_CHIP[job.status] ?? riskChip(job);
}

const PRIORITY_CHIP = {
  urgent: { label: "Urgent", tone: "urgent" },
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "low" },
};

function priorityBadge(job) {
  return PRIORITY_CHIP[job.priority] ?? PRIORITY_CHIP.medium;
}

export default function Dispatch() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const technicianName = (id) => technicians.find((t) => t.id === id)?.name;
  const heroTechnician = technicians.find(
    (t) => isHeroTechnician(t.name) && t.status === TECH_STATUS.AVAILABLE
  );

  // Ranked by priority score first (domain/dispatchEngine.js), then the
  // hero job still floats to the very top on top of that ranking -- same
  // pinning behavior as before, just applied after real ranking instead
  // of being the only sort.
  const rankedJobs = useMemo(() => {
    const ranked = rankJobsByPriority(jobs);
    return [...ranked].sort(
      (a, b) => (isHeroActiveJob(b.job.customer) ? 1 : 0) - (isHeroActiveJob(a.job.customer) ? 1 : 0)
    );
  }, [jobs]);

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
        <div className="fo-dispatch-layout">
          <div className="fo-dispatch-left">
            <h3 className="fo-dispatch-panel-title">Ranked Queue</h3>
            {rankedJobs.map(({ job, priorityScore }) => {
              const chip = statusChipFor(job);
              const priority = priorityBadge(job);
              const isHero = isHeroActiveJob(job.customer);
              const ageHours = Math.round(computeAgeHours(job, Date.now()));
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
                    <div style={{ display: "flex", gap: 6 }}>
                      <span className={`fo-chip fo-chip-priority-${priority.tone}`}>{priority.label}</span>
                      <span className={`fo-chip fo-chip-${chip.tone}`}>{chip.label}</span>
                    </div>
                  </div>
                  <p>{job.description}</p>
                  <div className="fo-muted">
                    Priority score {priorityScore} · Age {ageHours}h
                  </div>

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
            })}
          </div>

          <div className="fo-dispatch-right">
            <h3 className="fo-dispatch-panel-title">Technician Workload</h3>
            {technicians.map((tech) => {
              const count = activeJobCount(tech.id, jobs);
              const isIdle = tech.status === TECH_STATUS.AVAILABLE;
              return (
                <div key={tech.id} className={`fo-card${tech.active === false ? " fo-card--inactive" : ""}`}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <strong>{tech.name}</strong>
                    <span className={`fo-chip fo-chip-${isIdle ? "idle" : "busy"}`}>
                      {isIdle ? "Idle" : tech.status}
                    </span>
                  </div>
                  <div className="fo-muted">
                    {count}
                    {tech.maxConcurrentJobs != null ? ` / ${tech.maxConcurrentJobs}` : ""} active job(s)
                    {tech.active === false && " · Inactive"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
