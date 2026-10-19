// TW5 -- WHAT recordWorkOrderExecution ACTUALLY DID, said in words a technician can act on.
//
// The server caps recorded usage at the Work Order's planned quantity (Firebase parity: mergeQtyUsed has clamped qtyUsed to
// [0, qtyPlanned] since #925). A request that hits the cap used to come back "RECORDED" with appliedDelta 0, and the screen
// said "Recorded 1 x Part" for something that was NOT recorded. The server now answers NOT_APPLIED / PARTIALLY_APPLIED with a
// per-line governed `reason`; this is the ONE place that turns that answer into screen copy, so the scanner and the
// execution-capture card cannot disagree.
//
// Pure: no React, no Firebase, importable in plain node.

const LINE_REASONS = Object.freeze({
  PLAN_LIMIT_REACHED: "plan limit reached",
  NOTHING_TO_REVERSE: "nothing to take back",
});

/**
 * @param {{ outcome?: string, usage?: Array<object> } | null | undefined} result  updateWorkOrderExecutionData's result.
 * @param {{ qty: number, label: string, woNumber: string, sourceLabel?: string|null }} ctx  what the technician asked for.
 * @returns {{ tone: "ok"|"warn", text: string, applied: boolean }}
 */
export function describeExecutionOutcome(result, { qty, label, woNumber, sourceLabel = null }) {
  const from = sourceLabel ? ` from ${sourceLabel}` : "";
  const line = Array.isArray(result?.usage) ? result.usage[0] ?? null : null;
  const outcome = result?.outcome ?? "RECORDED";

  if (outcome === "NOT_APPLIED") {
    if (line?.reason === "NOTHING_TO_REVERSE") {
      return { tone: "warn", applied: false, text: `Nothing was taken back: no ${label} is recorded on ${woNumber}.` };
    }
    const plan = Number.isFinite(line?.qtyPlanned) ? ` (${line.qtyPlanned} planned, ${line.qtyUsed} already recorded)` : "";
    return {
      tone: "warn", applied: false,
      text: `Not recorded: ${woNumber} is at its planned quantity of ${label}${plan}. Ask dispatch to raise the parts plan if more was used.`,
    };
  }
  if (outcome === "PARTIALLY_APPLIED") {
    const done = Number.isFinite(line?.appliedDelta) ? line.appliedDelta : 0;
    const why = LINE_REASONS[line?.reason] ?? "limit reached";
    return {
      tone: "warn", applied: true,
      text: `Recorded ${done} of ${qty} × ${label} on ${woNumber}${from} (${why}). Ask dispatch to raise the parts plan for the rest.`,
    };
  }
  return { tone: "ok", applied: true, text: `Recorded ${qty} × ${label} on ${woNumber}${from}.` };
}
