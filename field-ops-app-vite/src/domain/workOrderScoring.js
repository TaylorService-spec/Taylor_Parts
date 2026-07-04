import { SEVERITY, createSignal } from "./controlTower/types";
import { WORK_ORDER_STATE } from "./constants";
import { explainWorkOrderState } from "./workOrderLifecycle";

// Sprint 3.3's Signal layer for Work Orders, sitting on top of Sprint
// 3.4's lifecycle engine (domain/workOrderLifecycle.js). This file
// computes nothing about Work Order state itself -- explainWorkOrderState()
// is the single source of truth for state/reasons/metrics.
// computeWorkOrderSignal() below only wraps that output in the shared
// { id, score, severity, label, metadata } envelope (see
// domain/controlTower/types.js) so Control Tower's panels/components can
// render Work Orders the same way they render risk/dispatch signals.

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

// Canonical WorkOrderSignal for Control Tower: wraps
// workOrderLifecycle.explainWorkOrderState() in the shared Signal
// envelope. metadata carries the full { state, reasons, metrics } from
// the lifecycle engine untouched -- consumers (e.g. WorkOrderDetail) read
// it for display but never recompute state/reasons themselves.
export function computeWorkOrderSignal(workOrderId, jobs) {
  const { state, reasons, metrics } = explainWorkOrderState(jobs);

  return createSignal({
    id: workOrderId,
    score: STATE_SCORE[state],
    severity: STATE_SEVERITY[state],
    label: `Work Order ${workOrderId}: ${state}`,
    metadata: { state, reasons, metrics },
  });
}
