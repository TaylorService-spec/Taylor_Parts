import { JOB_STATUS, TECH_STATUS } from "./constants";
import { createSignal } from "./controlTower/types";

// Pure, derived-only dispatch recommendation engine. Reads a Firestore
// snapshot (jobs + technicians already fetched by the caller) and computes
// scores/rankings in memory. Nothing here writes to Firestore or mutates
// its inputs -- assignJob() remains the only place a job actually gets
// assigned. This module only suggests.

const WORKLOAD_PENALTY_PER_JOB = 15;
const AVAILABILITY_SCORE = {
  [TECH_STATUS.AVAILABLE]: 50,
  [TECH_STATUS.ON_JOB]: -100,
  [TECH_STATUS.OFF_SHIFT]: -1000,
};
const WORK_ORDER_AFFINITY_BONUS = 25;
const MAX_IDLE_BONUS = 40;
const IDLE_BONUS_PER_HOUR = 2;

const ACTIVE_JOB_STATUSES = [JOB_STATUS.ASSIGNED, JOB_STATUS.IN_PROGRESS];

// APPROXIMATION, NOT PRECISE TIMING: technician.createdAt/job.createdAt
// are the only timestamps the current schema writes (see
// collectionStore.add()). There is no assignedAt/startedAt field, since
// adding one would mean changing assignJob() or updateJobStatus() --
// out of scope for this sprint. "Recency" is therefore a temporary proxy
// using the most recent createdAt among a technician's currently active
// jobs, which is the closest available signal for "when did this
// technician last pick up work." Replace this with a real assignedAt
// timestamp once lifecycle timestamps are introduced in a future sprint.
function lastActivityTimestamp(technicianId, jobs) {
  const activeJobs = jobs.filter(
    (j) => j.technicianId === technicianId && ACTIVE_JOB_STATUSES.includes(j.status)
  );
  if (activeJobs.length === 0) return null;
  return Math.max(...activeJobs.map((j) => j.createdAt || 0));
}

function activeJobCount(technicianId, jobs) {
  return jobs.filter(
    (j) => j.technicianId === technicianId && ACTIVE_JOB_STATUSES.includes(j.status)
  ).length;
}

function hasWorkOrderAffinity(job, technicianId, jobs) {
  if (!job.workOrderId) return false;
  return jobs.some(
    (j) =>
      j.technicianId === technicianId &&
      j.workOrderId === job.workOrderId &&
      ACTIVE_JOB_STATUSES.includes(j.status)
  );
}

// Scores one technician against one job. `technician` may already carry
// precomputed fields (activeJobCount, lastActivityAt, hasAffinity) --
// rankTechnicians/computeDispatchRecommendations attach these from the
// full jobs snapshot before calling this. Called standalone (e.g. in a
// test) it falls back to treating the technician as having no other
// active jobs.
export function scoreTechnicianForJob(job, technician, now = Date.now()) {
  const jobCount = technician.activeJobCount ?? 0;
  const lastActivityAt = technician.lastActivityAt ?? null;
  const hasAffinity = technician.hasAffinity ?? false;

  let score = 100;

  score += AVAILABILITY_SCORE[technician.status] ?? -1000;
  score -= jobCount * WORKLOAD_PENALTY_PER_JOB;

  if (lastActivityAt != null) {
    const idleHours = Math.max(0, (now - lastActivityAt) / (1000 * 60 * 60));
    score += Math.min(MAX_IDLE_BONUS, idleHours * IDLE_BONUS_PER_HOUR);
  }

  if (hasAffinity) {
    score += WORK_ORDER_AFFINITY_BONUS;
  }

  return {
    technicianId: technician.id,
    score,
    signals: {
      status: technician.status,
      activeJobCount: jobCount,
      lastActivityAt,
      hasAffinity,
    },
  };
}

// Ranks all technicians against a single job, highest score first.
// Attaches workload/recency/affinity context from `jobs` before scoring
// so scoreTechnicianForJob can stay a pure per-pair function.
export function rankTechnicians(job, technicians, jobs = [], now = Date.now()) {
  return technicians
    .map((technician) => {
      const enriched = {
        ...technician,
        activeJobCount: activeJobCount(technician.id, jobs),
        lastActivityAt: lastActivityTimestamp(technician.id, jobs),
        hasAffinity: hasWorkOrderAffinity(job, technician.id, jobs),
      };
      return scoreTechnicianForJob(job, enriched, now);
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
// domain/controlTower/types.js) with the current top pick plus
// runners-up in metadata. Read-only -- callers decide whether/how to act
// on this (e.g. Dispatch.jsx still calls assignJob() itself; this never
// does).
export function computeDispatchRecommendations(jobs, technicians, now = Date.now()) {
  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN);

  return openJobs.map((job) => {
    const ranked = rankTechnicians(job, technicians, jobs, now);
    const recommended = ranked[0] ?? null;

    return createSignal({
      id: job.id,
      score: recommended ? Math.max(0, Math.min(100, recommended.score)) : 0,
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
