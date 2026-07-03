import { JOB_STATUS } from "./constants";

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

export const RISK_LEVEL = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const RISK_ORDER = [RISK_LEVEL.LOW, RISK_LEVEL.MEDIUM, RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL];

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

function bumpRiskLevel(level) {
  const idx = RISK_ORDER.indexOf(level);
  return RISK_ORDER[Math.min(idx + 1, RISK_ORDER.length - 1)];
}

// options.workOrderActiveJobCount is optional context a caller (e.g.
// detectStalledJobs) can supply after counting active jobs per work order
// across the full jobs list. Without it, congestion is simply not
// factored in -- computeJobRisk(job) still works standalone.
export function computeJobRisk(job, options = {}, now = Date.now()) {
  if (job.status === JOB_STATUS.COMPLETE) {
    return { level: null, ageHours: 0, reasons: [] };
  }

  const thresholds = THRESHOLDS_HOURS[job.status] ?? THRESHOLDS_HOURS[JOB_STATUS.ASSIGNED];
  const ageHours = Math.max(0, (now - (job.createdAt || now)) / HOUR);

  let level = RISK_LEVEL.LOW;
  if (ageHours >= thresholds.critical) level = RISK_LEVEL.CRITICAL;
  else if (ageHours >= thresholds.high) level = RISK_LEVEL.HIGH;
  else if (ageHours >= thresholds.medium) level = RISK_LEVEL.MEDIUM;

  const reasons = [`${Math.round(ageHours)}h since creation in status ${job.status}`];

  const congestionCount = options.workOrderActiveJobCount;
  if (congestionCount != null && congestionCount >= CONGESTION_BUMP_THRESHOLD) {
    level = bumpRiskLevel(level);
    reasons.push(`${congestionCount} active jobs congested on work order ${job.workOrderId}`);
  }

  return { level, ageHours, reasons };
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

// Full pass over a jobs snapshot: computes risk for every non-complete
// job (with congestion context included) and returns those at HIGH or
// CRITICAL, most severe first.
export function detectStalledJobs(jobs, now = Date.now()) {
  const congestionCounts = countActiveJobsByWorkOrder(jobs);

  return jobs
    .filter((j) => j.status !== JOB_STATUS.COMPLETE)
    .map((job) => ({
      job,
      risk: computeJobRisk(
        job,
        { workOrderActiveJobCount: congestionCounts[job.workOrderId] },
        now
      ),
    }))
    .filter(({ risk }) => risk.level === RISK_LEVEL.HIGH || risk.level === RISK_LEVEL.CRITICAL)
    .sort((a, b) => RISK_ORDER.indexOf(b.risk.level) - RISK_ORDER.indexOf(a.risk.level));
}
