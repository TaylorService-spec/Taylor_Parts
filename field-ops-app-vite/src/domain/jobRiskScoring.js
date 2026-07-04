import { JOB_STATUS } from "./constants";
import { createSignal, compareBySeverity, SEVERITY } from "./controlTower/types";

// Pure, derived-only risk scoring. No Firestore access, no writes -- takes
// whatever jobs snapshot the caller already has (Control Tower's
// useFirestoreCollection listener) and classifies staleness risk in memory.
//
// APPROXIMATION, NOT PRECISE TIMING: job.createdAt (set once, at
// creation, by collectionStore.add()) is the only timestamp this schema
// tracks -- there's no assignedAt/startedAt per status transition, since
// adding one would require changing assignJob() or updateJobStatus(),
// which is out of scope for this sprint. "Time in status" is therefore a
// temporary proxy using time-since-creation. This undercounts risk for
// jobs that sat OPEN a long time before being assigned (their
// ASSIGNED-state clock effectively starts from creation, not from the
// assignment event). Replace this with real assignedAt/startedAt
// lifecycle timestamps once they're introduced in a future sprint --
// until then, treat every risk/age figure this module produces as an
// approximation, not precise operational timing.

const HOUR = 1000 * 60 * 60;

// OPEN jobs have nobody working them yet, so they're held to tighter
// thresholds than jobs already ASSIGNED/IN_PROGRESS.
const THRESHOLDS_HOURS = {
  [JOB_STATUS.OPEN]: { medium: 2, high: 8, critical: 24 },
  [JOB_STATUS.ASSIGNED]: { medium: 8, high: 24, critical: 72 },
  [JOB_STATUS.IN_PROGRESS]: { medium: 8, high: 24, critical: 72 },
};

// A work order with many jobs still active at once suggests congestion
// (scheduling/staffing strain on that site/customer) -- bump risk one
// tier when it crosses this count.
const CONGESTION_BUMP_THRESHOLD = 4;

// Maps a status-relative age tier onto the shared 0-100 score scale (see
// domain/controlTower/types.js) rather than a bespoke LOW/MEDIUM/HIGH/
// CRITICAL enum of its own -- keeps severity derivation (severityFromScore)
// identical to every other Control Tower signal.
const TIER_SCORE = { none: 0, medium: 40, high: 65, critical: 90 };
const CONGESTION_BUMP_SCORE = 15;

// options.workOrderActiveJobCount is optional context a caller (e.g.
// detectStalledJobs) can supply after counting active jobs per work order
// across the full jobs list. Without it, congestion is simply not
// factored in -- computeJobRisk(job) still works standalone.
//
// Returns a canonical RiskSignal ({ id, score, severity, label, metadata })
// for non-complete jobs, or null for COMPLETE jobs (nothing to flag).
export function computeJobRisk(job, options = {}, now = Date.now()) {
  if (job.status === JOB_STATUS.COMPLETE) {
    return null;
  }

  const thresholds = THRESHOLDS_HOURS[job.status] ?? THRESHOLDS_HOURS[JOB_STATUS.ASSIGNED];
  const ageHours = Math.max(0, (now - (job.createdAt || now)) / HOUR);

  let tier = "none";
  if (ageHours >= thresholds.critical) tier = "critical";
  else if (ageHours >= thresholds.high) tier = "high";
  else if (ageHours >= thresholds.medium) tier = "medium";

  const reasons = [`${Math.round(ageHours)}h since creation in status ${job.status}`];

  let score = TIER_SCORE[tier];
  const congestionCount = options.workOrderActiveJobCount;
  if (congestionCount != null && congestionCount >= CONGESTION_BUMP_THRESHOLD) {
    score = Math.min(100, score + CONGESTION_BUMP_SCORE);
    reasons.push(`${congestionCount} active jobs congested on work order ${job.workOrderId}`);
  }

  return createSignal({
    id: job.id,
    score,
    label: `${job.customer || job.id} (${job.status})`,
    metadata: { ageHours, status: job.status, workOrderId: job.workOrderId || null, reasons },
  });
}

// Counts active (non-complete) jobs per workOrderId, for the congestion
// signal above.
function countActiveJobsByWorkOrder(jobs) {
  const counts = {};
  jobs.forEach((j) => {
    if (!j.workOrderId || j.status === JOB_STATUS.COMPLETE) return;
    counts[j.workOrderId] = (counts[j.workOrderId] || 0) + 1;
  });
  return counts;
}

// Full pass over a jobs snapshot: computes a RiskSignal for every
// non-complete job (with congestion context included) and returns those
// at HIGH or CRITICAL severity, most severe (then highest score) first.
export function detectStalledJobs(jobs, now = Date.now()) {
  const congestionCounts = countActiveJobsByWorkOrder(jobs);

  return jobs
    .filter((j) => j.status !== JOB_STATUS.COMPLETE)
    .map((job) =>
      computeJobRisk(job, { workOrderActiveJobCount: congestionCounts[job.workOrderId] }, now)
    )
    .filter((signal) => signal.severity === SEVERITY.HIGH || signal.severity === SEVERITY.CRITICAL)
    .sort((a, b) => compareBySeverity(a.severity, b.severity) || b.score - a.score);
}
