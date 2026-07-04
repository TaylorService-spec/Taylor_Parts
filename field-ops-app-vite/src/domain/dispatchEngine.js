import { JOB_STATUS, JOB_PRIORITY } from "./constants";
import { computeAgeHours } from "./jobRiskScoring";

// Pure, derived-only priority-ranking engine for the Dispatch screen's
// "ranked queue" (left panel). Like dispatchScoring.js/jobRiskScoring.js,
// this never touches Firestore and never persists its output -- there is
// deliberately no `dispatchQueue` collection. Ranking is recomputed on
// every read from whatever jobs snapshot the caller already has, the
// same philosophy already used for dispatch recommendations and work
// order state: derived aggregates are computed live, never cached in a
// second collection that could drift out of sync.
//
// This is a distinct concept from dispatchScoring.js's
// computeDispatchScore()/rankTechnicians(): that module scores
// technician-for-job fit (who should take this job). This module scores
// job-for-attention (which job should the dispatcher work next), driven
// by the job's own `priority` field rather than technician fit.

const PRIORITY_WEIGHTS = {
  [JOB_PRIORITY.URGENT]: 100,
  [JOB_PRIORITY.HIGH]: 70,
  [JOB_PRIORITY.MEDIUM]: 40,
  [JOB_PRIORITY.LOW]: 10,
};

const UNASSIGNED_STALE_HOURS = 24;
const UNASSIGNED_STALE_BONUS = 30;
const REPEAT_CUSTOMER_BONUS = 20;
const LOW_PRIORITY_LONG_JOB_PENALTY = -10;
const LONG_DURATION_MINUTES_THRESHOLD = 120;

// `priority` is optional/additive -- a job written before this field
// existed (or one just never given a priority) scores as if it were
// "medium", rather than being written a default value at creation time.
function baseWeight(job) {
  return PRIORITY_WEIGHTS[job.priority] ?? PRIORITY_WEIGHTS[JOB_PRIORITY.MEDIUM];
}

function unassignedStalenessBonus(job, now) {
  if (job.status !== JOB_STATUS.OPEN) return { score: 0, reason: null };
  const ageHours = computeAgeHours(job, now);
  if (ageHours < UNASSIGNED_STALE_HOURS) return { score: 0, reason: null };
  return {
    score: UNASSIGNED_STALE_BONUS,
    reason: `unassigned for ${Math.round(ageHours)}h (>${UNASSIGNED_STALE_HOURS}h)`,
  };
}

// v1 heuristic: exact string match on job.customer against other
// COMPLETE jobs. No normalization/fuzzy-matching and no resolution
// through domain/workOrders.js's customer linkage -- matches how
// `customer` is treated everywhere else in this codebase (a plain,
// unnormalized string). Flat bonus if there's at least one match, not
// scaled by how many repeat jobs exist.
function repeatCustomerBonus(job, jobs) {
  if (!job.customer) return { score: 0, reason: null };
  const hasPriorCompletedJob = jobs.some(
    (j) => j.id !== job.id && j.customer === job.customer && j.status === JOB_STATUS.COMPLETE
  );
  return hasPriorCompletedJob
    ? { score: REPEAT_CUSTOMER_BONUS, reason: "repeat customer (prior completed job)" }
    : { score: 0, reason: null };
}

// SLA tracking doesn't exist yet in this schema (no due-date/SLA field
// on jobs) -- explicitly a documented no-op stub, not implemented. Wire
// this up once an SLA deadline field is introduced in a future sprint.
function slaFactor() {
  return { score: 0, reason: null };
}

function longLowPriorityPenalty(job) {
  const isLowPriority = (job.priority ?? JOB_PRIORITY.MEDIUM) === JOB_PRIORITY.LOW;
  const isLongJob = (job.estimatedDuration ?? 0) > LONG_DURATION_MINUTES_THRESHOLD;
  if (!isLowPriority || !isLongJob) return { score: 0, reason: null };
  return {
    score: LOW_PRIORITY_LONG_JOB_PENALTY,
    reason: `low priority + long estimated duration (${job.estimatedDuration}min)`,
  };
}

// Returns { job, priorityScore, reasons }. Not a Signal (see
// controlTower/types.js) -- Signal's score is a normalized 0-100
// "attention-worthiness" scale meant to be cross-comparable with risk/
// dispatch-recommendation scores. priorityScore here is an unbounded
// additive score (base 10-100 plus modifiers from -10 to +30, so it can
// exceed 100) with a different meaning entirely -- forcing it into
// Signal's contract would mean either lossy clamping or redefining what
// "severity" means for a priority queue, neither of which this task asks
// for.
export function computeJobPriorityScore(job, jobs = [], now = Date.now()) {
  const modifiers = [
    unassignedStalenessBonus(job, now),
    repeatCustomerBonus(job, jobs),
    slaFactor(job),
    longLowPriorityPenalty(job),
  ];

  const priorityScore = modifiers.reduce((sum, m) => sum + m.score, baseWeight(job));
  const reasons = modifiers.filter((m) => m.reason).map((m) => m.reason);

  return { job, priorityScore, reasons };
}

// Ranks all non-COMPLETE jobs (OPEN/ASSIGNED/IN_PROGRESS) by priority
// score, highest first -- this is the ranked queue Dispatch.jsx's left
// panel renders. Deliberately broader than
// dispatchScoring.computeDispatchRecommendations(), which only looks at
// OPEN jobs: this queue is "what should the dispatcher pay attention to
// next," which includes jobs already assigned/in progress, not just
// unassigned ones. COMPLETE jobs are excluded -- nothing left to
// prioritize once a job is done.
export function rankJobsByPriority(jobs, now = Date.now()) {
  return jobs
    .filter((j) => j.status !== JOB_STATUS.COMPLETE)
    .map((job) => computeJobPriorityScore(job, jobs, now))
    .sort((a, b) => b.priorityScore - a.priorityScore || (a.job.createdAt ?? 0) - (b.job.createdAt ?? 0));
}
