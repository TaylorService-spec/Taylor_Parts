import { SEVERITY, createSignal } from "./controlTower/types";
import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";
import { computeWorkOrderState } from "./workOrderLifecycle";

// Sprint 3.3's Signal layer for Work Orders, sitting on top of Sprint
// 3.4's lifecycle engine (domain/workOrderLifecycle.js). This file
// computes nothing about Work Order state itself -- computeWorkOrderState()
// is the single source of truth. computeWorkOrderSignal() below only
// wraps that output in the shared { id, score, severity, label, metadata }
// envelope (see domain/controlTower/types.js) so Control Tower's panels/
// components can render Work Orders the same way they render risk/
// dispatch signals.

// WORK_ORDER_STATE is a discrete state, not a continuous magnitude (a
// work order isn't "60% blocked"), so its score/severity are a fixed
// mapping rather than something derived from a formula the way risk/
// dispatch scores are.
const STATE_SEVERITY = {
  [WORK_ORDER_STATE.BLOCKED]: SEVERITY.HIGH,
  [WORK_ORDER_STATE.IN_PROGRESS]: SEVERITY.MEDIUM,
  [WORK_ORDER_STATE.READY]: SEVERITY.LOW,
  [WORK_ORDER_STATE.COMPLETED]: SEVERITY.LOW,
};

const STATE_SCORE = {
  [WORK_ORDER_STATE.BLOCKED]: 75,
  [WORK_ORDER_STATE.IN_PROGRESS]: 50,
  [WORK_ORDER_STATE.READY]: 25,
  [WORK_ORDER_STATE.COMPLETED]: 0,
};

// Transitional re-export so ControlTower.jsx's still-unmigrated import
// keeps working for this one commit -- removed once ControlTower.jsx
// switches to WorkOrderDetail/computeWorkOrderSignal in 451b161.
export const computeWorkOrderStatus = computeWorkOrderState;

// Canonical WorkOrderSignal for Control Tower: wraps
// workOrderLifecycle.computeWorkOrderState() in the shared Signal
// envelope. metadata carries raw job counts for display -- consumers
// never recompute state themselves.
export function computeWorkOrderSignal(workOrderId, jobs) {
  const state = computeWorkOrderState(jobs);
  const completed = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const inProgress = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;
  const pending = jobs.length - completed - inProgress;

  return createSignal({
    id: workOrderId,
    score: STATE_SCORE[state],
    severity: STATE_SEVERITY[state],
    label: `Work Order ${workOrderId}: ${state}`,
    metadata: { state, jobCount: jobs.length, pending, inProgress, completed },
  });
}
