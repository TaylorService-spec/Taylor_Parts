import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";
import { EVENT_TYPE } from "./eventTypes";
import { normalizeEvent, sortEvents } from "./eventModel";
import { computeWorkOrderState } from "./workOrderLifecycle";

// The single Operational Timeline builder (Sprint 3.5). Every consumer --
// ActivityTimelinePanel, WorkOrderDetail's Operational History -- calls
// buildTimeline() and nothing else generates events. Pure, derived-only:
// no Firestore access, no writes, no persistence of any kind.
//
// APPROXIMATION, NOT PRECISE TIMING: job.createdAt (set once, at
// creation, by collectionStore.add()) is the only timestamp this schema
// tracks -- there's no assignedAt/startedAt/completedAt per lifecycle
// milestone, since adding one would require changing assignJob()/
// updateJobStatus() (out of scope, per Sprint 3.5's "no schema changes,
// no timestamp additions" constraint). Every event below is therefore
// stamped with job.createdAt regardless of which milestone it
// represents -- multiple milestones for the same job will carry the same
// timestamp. sortEvents() (domain/eventModel.js) breaks ties using
// EVENT_SEQUENCE_RANK so relative order still displays correctly even
// though absolute times don't yet distinguish them. Replace with real
// per-transition timestamps once introduced in a future sprint (see
// docs/FUTURE_ARCHITECTURE_BACKLOG.md).

// A job in its current status implies every earlier milestone already
// happened -- a COMPLETE job was necessarily CREATED, ASSIGNED, and
// STARTED first, since assignJob()/updateJobStatus() only allow forward
// transitions (see domain/jobWorkflow.js's canTransitionJob()). This
// emits an event for every milestone the job has actually reached, not
// just its current status.
function jobEvents(job) {
  const events = [
    normalizeEvent({
      timestamp: job.createdAt,
      type: EVENT_TYPE.JOB_CREATED,
      entityId: job.id,
      metadata: { job },
    }),
  ];

  const reachedAssigned =
    job.status === JOB_STATUS.ASSIGNED ||
    job.status === JOB_STATUS.IN_PROGRESS ||
    job.status === JOB_STATUS.COMPLETE;
  const reachedStarted = job.status === JOB_STATUS.IN_PROGRESS || job.status === JOB_STATUS.COMPLETE;
  const reachedCompleted = job.status === JOB_STATUS.COMPLETE;

  if (reachedAssigned) {
    events.push(
      normalizeEvent({
        timestamp: job.createdAt,
        type: EVENT_TYPE.JOB_ASSIGNED,
        entityId: job.id,
        metadata: { job, technicianId: job.technicianId },
      })
    );
  }
  if (reachedStarted) {
    events.push(
      normalizeEvent({
        timestamp: job.createdAt,
        type: EVENT_TYPE.JOB_STARTED,
        entityId: job.id,
        metadata: { job },
      })
    );
  }
  if (reachedCompleted) {
    events.push(
      normalizeEvent({
        timestamp: job.createdAt,
        type: EVENT_TYPE.JOB_COMPLETED,
        entityId: job.id,
        metadata: { job },
      })
    );
  }

  return events;
}

const STATE_EVENT_TYPE = {
  [WORK_ORDER_STATE.READY]: EVENT_TYPE.WORK_ORDER_READY,
  [WORK_ORDER_STATE.BLOCKED]: EVENT_TYPE.WORK_ORDER_BLOCKED,
  [WORK_ORDER_STATE.COMPLETED]: EVENT_TYPE.WORK_ORDER_COMPLETED,
  // IN_PROGRESS has no dedicated work-order-level event -- an
  // in-progress work order is represented by its jobs' own
  // JOB_STARTED/JOB_COMPLETED events instead, mirroring how
  // computeWorkOrderState() itself treats job status as the only source
  // of truth.
};

// A Work Order's "creation" isn't separately recorded -- there is no
// populated Firestore "workOrders" collection yet (see
// domain/workOrders.js) -- so it's approximated as the earliest of its
// jobs' createdAt. Its current lifecycle state (via
// domain/workOrderLifecycle.js -- the single aggregation engine) is
// emitted as one event reflecting the *current* derived state, not a
// full transition history: with only createdAt available, there's no
// way to know when a work order actually became READY vs BLOCKED in the
// past, only what it is now.
function workOrderEvents(workOrderId, jobs) {
  if (jobs.length === 0) return [];

  const timestamps = jobs.map((j) => j.createdAt).filter((t) => typeof t === "number");
  if (timestamps.length === 0) return [];

  const earliestCreatedAt = Math.min(...timestamps);
  const latestCreatedAt = Math.max(...timestamps);

  const events = [
    normalizeEvent({
      timestamp: earliestCreatedAt,
      type: EVENT_TYPE.WORK_ORDER_CREATED,
      entityId: workOrderId,
      metadata: { jobCount: jobs.length },
    }),
  ];

  const state = computeWorkOrderState(jobs);
  const stateEventType = STATE_EVENT_TYPE[state];

  if (stateEventType) {
    events.push(
      normalizeEvent({
        timestamp: latestCreatedAt,
        type: stateEventType,
        entityId: workOrderId,
        metadata: { state, jobCount: jobs.length },
      })
    );
  }

  return events;
}

function groupJobsByWorkOrder(jobs) {
  const groups = {};
  jobs.forEach((job) => {
    const id = job.workOrderId || "unassigned";
    if (!groups[id]) groups[id] = [];
    groups[id].push(job);
  });
  return groups;
}

// Builds the full derived Operational Timeline for a jobs snapshot:
// every reached Job milestone, plus one current-state event per Work
// Order (jobs grouped by workOrderId, same grouping Control Tower
// already uses). Newest first. Pure, derived-only -- no Firestore
// access, no writes.
export function buildTimeline(jobs) {
  const events = [];

  jobs.forEach((job) => {
    events.push(...jobEvents(job));
  });

  const byWorkOrder = groupJobsByWorkOrder(jobs);
  Object.entries(byWorkOrder).forEach(([workOrderId, woJobs]) => {
    events.push(...workOrderEvents(workOrderId, woJobs));
  });

  return sortEvents(events);
}
