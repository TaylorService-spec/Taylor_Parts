// TW5 -- WHAT recordWorkOrderExecution ACTUALLY DID, said in words a technician can act on.
//
// The server caps recorded usage at the Work Order's planned quantity (Firebase parity: mergeQtyUsed has clamped qtyUsed to
// [0, qtyPlanned] since #925). A request that hits the cap used to come back "RECORDED" with appliedDelta 0, and the screen
// said "Recorded 1 x Part" for something that was NOT recorded. The server now answers NOT_APPLIED / PARTIALLY_APPLIED with a
// per-line governed `reason`; this is the ONE place that turns that answer into screen copy AND into the offline queue's
// verdict, so the scanner, the execution-capture card and the sync queue cannot disagree.
//
// A REPLAY (same idempotency key) carries the original per-line requested/applied/reason, so a held-back request that is
// answered again is still held back -- never "synced" and never "Recorded".
//
// Pure: no React, no Firebase, importable in plain node.

const LINE_REASONS = Object.freeze({
  PLAN_LIMIT_REACHED: "plan limit reached",
  NOTHING_TO_REVERSE: "nothing to take back",
});

/**
 * Was any of this request held back? `null` when everything asked was applied (or this is a plain replay of that).
 * @returns {null | { kind: "NOT_APPLIED" | "PARTIAL", reason: string, line: object | null }}
 */
export function heldBack(result) {
  const lines = Array.isArray(result?.usage) ? result.usage : [];
  const held = lines.filter((l) => l && l.reason);
  const first = held[0] ?? null;
  const outcome = result?.outcome;
  // "Applied some" means something was ADDED. A zero or negative applied delta recorded nothing new, however it is labelled.
  const appliedSome = lines.some((l) => Number(l?.appliedDelta) > 0);
  if (outcome === "NOT_APPLIED") return { kind: "NOT_APPLIED", reason: first?.reason ?? "PLAN_LIMIT_REACHED", line: first ?? lines[0] ?? null };
  if (outcome === "PARTIALLY_APPLIED") return { kind: appliedSome ? "PARTIAL" : "NOT_APPLIED", reason: first?.reason ?? "PLAN_LIMIT_REACHED", line: first };
  if (outcome === "REPLAYED" && first) return { kind: appliedSome ? "PARTIAL" : "NOT_APPLIED", reason: first.reason, line: first };
  return null;
}

/**
 * @param {{ outcome?: string, usage?: Array<object> } | null | undefined} result  updateWorkOrderExecutionData's result.
 * @param {{ qty: number, label: string, woNumber: string, sourceLabel?: string|null }} ctx  what the technician asked for.
 * @returns {{ tone: "ok"|"warn", text: string, applied: boolean }}
 */
export function describeExecutionOutcome(result, { qty, label, woNumber, sourceLabel = null }) {
  const from = sourceLabel ? ` from ${sourceLabel}` : "";
  const held = heldBack(result);

  if (held?.kind === "NOT_APPLIED") {
    if (held.reason === "NOTHING_TO_REVERSE") {
      return { tone: "warn", applied: false, text: `Nothing was taken back: no ${label} is recorded on ${woNumber}.` };
    }
    const l = held.line;
    // A plan lowered BELOW what was already recorded: say that, not a quantity arithmetic that reads as nonsense.
    if (Number.isFinite(l?.qtyUsed) && Number.isFinite(l?.qtyPlanned) && l.qtyUsed > l.qtyPlanned) {
      return {
        tone: "warn", applied: false,
        text: `Not recorded: the usage already recorded for ${label} on ${woNumber} exceeds its plan (${l.qtyUsed} recorded, ${l.qtyPlanned} planned). Ask dispatch to raise the parts plan if more was used.`,
      };
    }
    const plan = Number.isFinite(l?.qtyPlanned) ? ` (${l.qtyPlanned} planned, ${l.qtyUsed} already recorded)` : "";
    return {
      tone: "warn", applied: false,
      text: `Not recorded: ${woNumber} is at its planned quantity of ${label}${plan}. Ask dispatch to raise the parts plan if more was used.`,
    };
  }
  if (held?.kind === "PARTIAL") {
    const done = Math.max(0, Number.isFinite(held.line?.appliedDelta) ? held.line.appliedDelta : 0);
    const why = LINE_REASONS[held.reason] ?? "limit reached";
    return {
      tone: "warn", applied: true,
      text: `Recorded ${done} of ${qty} × ${label} on ${woNumber}${from} (${why}). Ask dispatch to raise the parts plan for the rest.`,
    };
  }
  if (result?.outcome === "REPLAYED") {
    // The same request was already answered (a retry, or a lost response). Nothing new was recorded now.
    return { tone: "ok", applied: true, text: `Already recorded earlier: ${qty} × ${label} on ${woNumber}${from}.` };
  }
  return { tone: "ok", applied: true, text: `Recorded ${qty} × ${label} on ${woNumber}${from}.` };
}
