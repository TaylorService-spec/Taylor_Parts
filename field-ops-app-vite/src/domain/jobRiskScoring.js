import { JOB_STATUS, TECH_STATUS } from "./constants";
import { createSignal, compareBySeverity, severityFromScore, SEVERITY } from "./controlTower/types";

// Pure, derived-only risk scoring. No Firestore access, no writes -- takes
// whatever jobs/technicians snapshot the caller already has (Control
// Tower's useFirestoreCollection listeners) and classifies staleness risk
// in memory.
//
// APPROXIMATION, NOT PRECISE TIMING: job.createdAt (set once, at
// creation, by collectionStore.add()) is the only timestamp this schema
// tracks -- there's no assignedAt/startedAt per status transition, since
// adding one would require changing assignJob() or updateJobStatus(),
// which is out of scope for this sprint. Every age-derived factor below
// is therefore a temporary proxy using time-since-creation, not precise
// operational timing. Replace with real assignedAt/startedAt lifecycle
// timestamps once they're introduced in a future sprint.

const HOUR = 1000 * 60 * 60;

// Sprint 3.3.3: layered risk model. Each factor is normalized to 0-100
// and combined by weight into one 0-100 score (see
// domain/controlTower/types.js for the shared score/severity scale).
const RISK_WEIGHTS = {
  age: 0.5, // absolute time since creation, independent of status
  stagnation: 0.3, // time relative to what's expected for the job's *current* status
  fragmentation: 0.15, // unassigned/orphaned jobs on a work order that's otherwise active
  idleCorrelation: 0.05, // an available technician sitting idle while this job goes unassigned
};

// Beyond this many hours old, the absolute age factor maxes out
// regardless of status -- a job that's simply existed a long time is a
// risk signal on its own, on top of whether it's overdue *for its
// status*.
const ABSOLUTE_AGE_CEILING_HOURS = 96;

// OPEN jobs have nobody working them yet, so they're held to tighter
// stagnation thresholds than jobs already ASSIGNED/IN_PROGRESS.
const STAGNATION_THRESHOLDS_HOURS = {
  [JOB_STATUS.OPEN]: { medium: 2, high: 8, critical: 24 },
  [JOB_STATUS.ASSIGNED]: { medium: 8, high: 24, critical: 72 },
  [JOB_STATUS.IN_PROGRESS]: { medium: 8, high: 24, critical: 72 },
};

function computeAgeHours(job, now) {
  return Math.max(0, (now - (job.createdAt || now)) / HOUR);
}

function ageFactor(ageHours) {
  const score = Math.min(100, (ageHours / ABSOLUTE_AGE_CEILING_HOURS) * 100);
  return {
    type: "age",
    weight: RISK_WEIGHTS.age,
    score: Math.round(score),
    explanation: `${Math.round(ageHours)}h since creation`,
  };
}

function stagnationFactor(job, ageHours) {
  const thresholds =
    STAGNATION_THRESHOLDS_HOURS[job.status] ?? STAGNATION_THRESHOLDS_HOURS[JOB_STATUS.ASSIGNED];

  let score = 0;
  let tier = "within expected time for this status";
  if (ageHours >= thresholds.critical) {
    score = 100;
    tier = "far beyond expected time for this status";
  } else if (ageHours >= thresholds.high) {
    score = 66;
    tier = "well beyond expected time for this status";
  } else if (ageHours >= thresholds.medium) {
    score = 33;
    tier = "beyond expected time for this status";
  }

  return {
    type: "stagnation",
    weight: RISK_WEIGHTS.stagnation,
    score,
    explanation: `${tier} (${job.status})`,
  };
}

// siblingJobs = other jobs sharing this job's workOrderId. A job that's
// still OPEN (unassigned) while siblings on the same work order are
// actively being worked suggests it was overlooked during dispatch, not
// just naturally slower -- that's weighted higher than plain congestion.
function fragmentationFactor(job, siblingJobs = []) {
  if (!job.workOrderId) {
    return {
      type: "fragmentation",
      weight: RISK_WEIGHTS.fragmentation,
      score: 0,
      explanation: "no work order assigned",
    };
  }

  const activeSiblingCount = siblingJobs.filter((j) => j.status !== JOB_STATUS.COMPLETE).length;
  const hasActiveSibling = siblingJobs.some(
    (j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS
  );
  const orphaned = job.status === JOB_STATUS.OPEN && hasActiveSibling;
  const score = orphaned
    ? Math.min(100, 40 + activeSiblingCount * 15)
    : Math.min(100, activeSiblingCount * 15);

  return {
    type: "fragmentation",
    weight: RISK_WEIGHTS.fragmentation,
    score,
    explanation: orphaned
      ? `unassigned while ${activeSiblingCount} sibling job(s) on the same work order are active`
      : `${activeSiblingCount} active sibling job(s) on the same work order`,
  };
}

// technicians = full technician snapshot, optional. Only meaningful for
// OPEN jobs: if a technician is sitting AVAILABLE while this job remains
// unassigned, that correlates with a dispatch process gap rather than a
// genuinely hard-to-staff job.
function idleCorrelationFactor(job, technicians = []) {
  if (job.status !== JOB_STATUS.OPEN || technicians.length === 0) {
    return {
      type: "idleCorrelation",
      weight: RISK_WEIGHTS.idleCorrelation,
      score: 0,
      explanation: "not applicable",
    };
  }

  const hasIdleAvailableTechnician = technicians.some((t) => t.status === TECH_STATUS.AVAILABLE);

  return {
    type: "idleCorrelation",
    weight: RISK_WEIGHTS.idleCorrelation,
    score: hasIdleAvailableTechnician ? 100 : 0,
    explanation: hasIdleAvailableTechnician
      ? "an available technician is idle while this job is unassigned"
      : "no available technician is currently idle",
  };
}

// Full explainable breakdown for one job: { score, severity, factors[],
// ageHours }. Each factor reports its own type/weight/score/explanation
// so a panel (or a debugging session) can see exactly why a job scored
// the way it did, not just the final number.
export function getRiskBreakdown(job, context = {}, now = Date.now()) {
  const ageHours = computeAgeHours(job, now);

  const factors = [
    ageFactor(ageHours),
    stagnationFactor(job, ageHours),
    fragmentationFactor(job, context.siblingJobs),
    idleCorrelationFactor(job, context.technicians),
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0));

  return { score, severity: severityFromScore(score), factors, ageHours };
}

// context.siblingJobs / context.technicians are optional snapshots a
// caller (e.g. detectStalledJobs) can supply for the fragmentation/idle
// correlation factors. Without them, those two factors simply score 0 --
// computeJobRisk(job) still works standalone with just age + stagnation.
//
// Returns a canonical RiskSignal ({ id, score, severity, label, metadata })
// for non-complete jobs, or null for COMPLETE jobs (nothing to flag).
export function computeJobRisk(job, context = {}, now = Date.now()) {
  if (job.status === JOB_STATUS.COMPLETE) {
    return null;
  }

  const breakdown = getRiskBreakdown(job, context, now);

  return createSignal({
    id: job.id,
    score: breakdown.score,
    severity: breakdown.severity,
    label: `${job.customer || job.id} (${job.status})`,
    metadata: {
      ageHours: breakdown.ageHours,
      status: job.status,
      workOrderId: job.workOrderId || null,
      factors: breakdown.factors,
    },
  });
}

function siblingJobsFor(job, jobs) {
  if (!job.workOrderId) return [];
  return jobs.filter((j) => j.id !== job.id && j.workOrderId === job.workOrderId);
}

// Full pass over a jobs snapshot: computes a RiskSignal for every
// non-complete job (with fragmentation/idle-correlation context from the
// full jobs/technicians snapshot) and returns those at HIGH or CRITICAL
// severity, most severe (then highest score) first.
export function detectStalledJobs(jobs, technicians = [], now = Date.now()) {
  return jobs
    .filter((j) => j.status !== JOB_STATUS.COMPLETE)
    .map((job) =>
      computeJobRisk(job, { siblingJobs: siblingJobsFor(job, jobs), technicians }, now)
    )
    .filter((signal) => signal.severity === SEVERITY.HIGH || signal.severity === SEVERITY.CRITICAL)
    .sort((a, b) => compareBySeverity(a.severity, b.severity) || b.score - a.score);
}
