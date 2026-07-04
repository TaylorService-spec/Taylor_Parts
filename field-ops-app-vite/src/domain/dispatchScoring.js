import { JOB_STATUS, TECH_STATUS } from "./constants";
import { createSignal } from "./controlTower/types";
import { computeJobRisk } from "./jobRiskScoring";

// Pure, derived-only dispatch recommendation engine. Reads a Firestore
// snapshot (jobs + technicians already fetched by the caller) and computes
// scores/rankings in memory. Nothing here writes to Firestore or mutates
// its inputs -- assignJob() remains the only place a job actually gets
// assigned. This module only suggests.

const ACTIVE_JOB_STATUSES = [JOB_STATUS.ASSIGNED, JOB_STATUS.IN_PROGRESS];

// Weighted scoring model (Sprint 3.3.2). Each factor is normalized to
// 0-100 before weighting, so the final score is always 0-100 regardless
// of how many factors contribute -- same scale as RiskSignal/
// WorkOrderSignal scores, so panels can compare/sort them consistently.
const WEIGHTS = {
  urgency: 0.35, // job age / risk -- see jobRiskScoring.computeJobRisk()
  availability: 0.3, // is the technician actually free right now
  workloadBalance: 0.25, // avoid piling more jobs onto an already-busy technician
  workOrderPriority: 0.1, // continuity with work the technician is already on
};

const WORKLOAD_PENALTY_PER_JOB = 25;

function activeJobCount(technicianId, jobs) {
  return jobs.filter(
    (j) => j.technicianId === technicianId && ACTIVE_JOB_STATUSES.includes(j.status)
  ).length;
}

// There's no explicit "priority" field on jobs or work orders (see
// domain/workOrders.js) -- work-order priority is therefore approximated
// as continuity: a technician already active on the same work order
// scores higher, since keeping one technician on a work order tends to
// finish it faster than splitting it across people.
function hasWorkOrderAffinity(job, technicianId, jobs) {
  if (!job.workOrderId) return false;
  return jobs.some(
    (j) =>
      j.technicianId === technicianId &&
      j.workOrderId === job.workOrderId &&
      ACTIVE_JOB_STATUSES.includes(j.status)
  );
}

// Scores one technician against one job on a 0-100 scale, using the
// weighted model above. `job`/`technician` may carry precomputed fields
// (job.riskScore, technician.activeJobCount, technician.hasAffinity) --
// rankTechnicians attaches these from the full jobs snapshot before
// calling this, so this function itself stays a pure per-pair
// computation with no snapshot to search. Missing fields default to the
// least-favorable assumption (no urgency, no affinity, zero workload).
export function computeDispatchScore(job, technician) {
  const urgencyScore = job.riskScore ?? 0;
  const availabilityScore = technician.status === TECH_STATUS.AVAILABLE ? 100 : 0;
  const jobCount = technician.activeJobCount ?? 0;
  const workloadScore = Math.max(0, 100 - jobCount * WORKLOAD_PENALTY_PER_JOB);
  const priorityScore = technician.hasAffinity ? 100 : 0;

  const score = Math.round(
    urgencyScore * WEIGHTS.urgency +
      availabilityScore * WEIGHTS.availability +
      workloadScore * WEIGHTS.workloadBalance +
      priorityScore * WEIGHTS.workOrderPriority
  );

  const reasons = [
    technician.status === TECH_STATUS.AVAILABLE
      ? "technician is available"
      : `technician is ${technician.status}, not available`,
    `${jobCount} active job(s) (workload score ${workloadScore})`,
  ];
  if (urgencyScore > 0) reasons.push(`job urgency score ${Math.round(urgencyScore)}`);
  if (technician.hasAffinity) reasons.push("already working this work order");

  return { technicianId: technician.id, score, reasons };
}

// Ranks all technicians against a single job, highest score first.
// Attaches workload/affinity context (and the job's own risk score, used
// as the urgency factor) from `jobs` before scoring, so
// computeDispatchScore can stay a pure per-pair function.
//
// Returns [{ technicianId, score, reasons[] }], most explainable-first
// item being the top recommendation.
export function rankTechnicians(job, technicians, jobs = [], now = Date.now()) {
  const riskSignal = computeJobRisk(job, {}, now);
  const enrichedJob = { ...job, riskScore: riskSignal?.score ?? 0 };

  return technicians
    .map((technician) => {
      const enrichedTechnician = {
        ...technician,
        activeJobCount: activeJobCount(technician.id, jobs),
        hasAffinity: hasWorkOrderAffinity(job, technician.id, jobs),
      };
      return computeDispatchScore(enrichedJob, enrichedTechnician);
    })
    .sort((a, b) => b.score - a.score);
}

const OVERLOAD_JOB_THRESHOLD = 3;

// Flags technicians carrying more active (ASSIGNED/IN_PROGRESS) jobs than
// the threshold. Read-only signal for the Control Tower panel -- doesn't
// change anyone's status.
export function detectOverloadedTechnicians(technicians, jobs, threshold = OVERLOAD_JOB_THRESHOLD) {
  return technicians
    .map((technician) => ({
      technician,
      activeJobCount: activeJobCount(technician.id, jobs),
    }))
    .filter(({ activeJobCount: count }) => count >= threshold)
    .sort((a, b) => b.activeJobCount - a.activeJobCount);
}

// Top-level recommendation pass: for every unassigned (OPEN) job, ranks
// technicians and returns a canonical DispatchRecommendation signal (see
// domain/controlTower/types.js) with the current top pick, its reasons,
// and runners-up in metadata. Read-only -- callers decide whether/how to
// act on this (e.g. Dispatch.jsx still calls assignJob() itself; this
// never does).
export function computeDispatchRecommendations(jobs, technicians, now = Date.now()) {
  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN);

  return openJobs.map((job) => {
    const ranked = rankTechnicians(job, technicians, jobs, now);
    const recommended = ranked[0] ?? null;

    return createSignal({
      id: job.id,
      score: recommended?.score ?? 0,
      label: recommended
        ? `${job.customer || job.id} → ${recommended.technicianId}`
        : `${job.customer || job.id}: no eligible technician`,
      metadata: {
        job,
        recommended,
        alternates: ranked.slice(1, 4),
      },
    });
  });
}
