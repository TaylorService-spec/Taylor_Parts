import { SEVERITY, createSignal } from "./controlTower/types";
import { WORK_ORDER_STATE } from "./constants";
import { explainWorkOrder } from "./workOrderLifecycle";

// Sprint 3.3's Signal layer for Work Orders, sitting on top of the
// lifecycle engine (domain/workOrderLifecycle.js). This file computes
// nothing about Work Order state itself -- it only wraps a lifecycle
// result in the shared { id, score, severity, label, metadata } envelope
// (see domain/controlTower/types.js) so Control Tower renders Work Orders
// the same way it renders risk/dispatch signals.
//
// After W4's one-model reconciliation, ONE signal function remains:
// computeWorkOrderSignalFromDoc() -- the LIVE Work Order Engine v1.2 path,
// wrapping explainWorkOrder(workOrderDoc) (a pure map from a real
// fieldops_wos doc). Sole consumer: modules/controlTower/WorkOrderDetail.jsx.
// The legacy jobs-aggregate computeWorkOrderSignal() (which wrapped the
// retired explainWorkOrderState) was verified zero-consumer and RETIRED in W4.

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

// Canonical WorkOrderSignal for Control Tower (Work Order Engine v1.2):
// wraps workOrderLifecycle.explainWorkOrder(), derived from a real
// fieldops_wos doc (via workOrderDoc.status), in the shared Signal
// envelope. metadata carries the full { state, reasons, metrics } from the
// lifecycle engine untouched -- consumers (WorkOrderDetail) read it for
// display but never recompute state/reasons themselves.
export function computeWorkOrderSignalFromDoc(workOrderDoc) {
  const { state, isCancelled, reasons, metrics } = explainWorkOrder(workOrderDoc);

  return createSignal({
    id: workOrderDoc.id,
    score: STATE_SCORE[state],
    severity: STATE_SEVERITY[state],
    label: `Work Order ${workOrderDoc.woNumber}: ${workOrderDoc.status}`,
    metadata: { state, isCancelled, reasons, metrics },
  });
}
