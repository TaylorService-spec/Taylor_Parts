// Owner capacity reserve -- PURE CORE. EOS operational authorization §4.1.
//
// WHY: `classifyBudget()` measures EOS's OWN consumption -- dispatches and subagent tokens --
// against EOS's own per-window ceilings. It has no concept of the Owner's subscription. So an
// unattended run can be perfectly within its own budget while consuming the capacity the Owner
// needs to do interactive work, and he discovers it when his own session throttles.
//
// **Unattended EOS yields to interactive Owner work.** Interactive/supervised use has priority.
// This module is the mechanism for that, not the aspiration.
//
// Reaching the floor is NOT terminal: checkpoint, persist, suspend, resume when capacity returns.
//
// PURE: no clock, network, or filesystem. The caller supplies observed usage.

export const OWNER_RESERVE = Object.freeze({
  // Keep this fraction of each window unspent, for the Owner.
  reserveFraction: 0.25,
  // Warn while there is still room to wind down gracefully rather than stopping abruptly.
  warnAtSpendableFraction: 0.8,
});

export const CAPACITY_STATE = {
  OK: "OK",
  APPROACHING: "RESERVE_APPROACHING",
  REACHED: "RESERVE_REACHED",
  UNOBSERVABLE: "CAPACITY_UNOBSERVABLE",
};

const known = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * @param {object} args
 * @param {number} [args.weeklyUsedFraction]   0..1 of the weekly subscription window
 * @param {number} [args.sessionUsedFraction]  0..1 of the shorter session window
 * @param {object} [policy]
 *
 * Both windows are checked and **the worse one governs** — §4.1 requires preserving 25% of each.
 */
export function assessOwnerCapacity(
  { weeklyUsedFraction, sessionUsedFraction } = {},
  policy = OWNER_RESERVE,
) {
  const spendable = 1 - policy.reserveFraction; // 0.75
  const windows = [
    { name: "weekly", used: weeklyUsedFraction },
    { name: "session", used: sessionUsedFraction },
  ].filter((w) => known(w.used));

  // Nothing observable. Do NOT assume healthy -- but do not hard-stop either, or EOS could never
  // run on a runtime that simply does not expose usage. Report it, and let the caller apply the
  // conservative fallback (§4.1: "a conservative estimator/proxy that fails toward preserving
  // Owner capacity"). Silence must be visible, not comfortable.
  if (windows.length === 0) {
    return {
      state: CAPACITY_STATE.UNOBSERVABLE,
      mayConsume: true,
      conservative: true,
      reason:
        "subscription capacity is not observable — proceeding under the conservative fallback; " +
        "EOS must stay within its own tightened per-window budget and this state must be surfaced, never silently treated as healthy",
      governingWindow: null,
      headroom: null,
    };
  }

  // The worst observed window governs.
  const worst = windows.reduce((a, b) => (b.used > a.used ? b : a));
  const headroom = Math.max(0, spendable - worst.used);

  if (worst.used >= spendable) {
    return {
      state: CAPACITY_STATE.REACHED,
      mayConsume: false,
      conservative: false,
      governingWindow: worst.name,
      headroom: 0,
      reason:
        `${worst.name} usage ${(worst.used * 100).toFixed(0)}% has reached the spendable ceiling ` +
        `(${(spendable * 100).toFixed(0)}%) — holding ${(policy.reserveFraction * 100).toFixed(0)}% for interactive Owner work`,
    };
  }

  if (worst.used >= spendable * policy.warnAtSpendableFraction) {
    return {
      state: CAPACITY_STATE.APPROACHING,
      mayConsume: true,
      conservative: false,
      governingWindow: worst.name,
      headroom,
      reason: `${worst.name} usage ${(worst.used * 100).toFixed(0)}% is approaching the reserve — prefer finishing current work over starting new`,
    };
  }

  return {
    state: CAPACITY_STATE.OK,
    mayConsume: true,
    conservative: false,
    governingWindow: worst.name,
    headroom,
    reason: "within spendable capacity",
  };
}

/**
 * Reaching the reserve suspends; it does not fail. §4.1 is explicit: capacity exhaustion is
 * recoverable, not terminal. Completed work is persisted, remaining work is persisted, and the
 * run resumes when capacity returns.
 */
export function capacityAction(assessment) {
  if (!assessment || assessment.state === CAPACITY_STATE.OK) return { action: "CONTINUE" };
  if (assessment.state === CAPACITY_STATE.APPROACHING) {
    return { action: "WIND_DOWN", guidance: "finish in-flight work; do not start a new child or segment" };
  }
  if (assessment.state === CAPACITY_STATE.UNOBSERVABLE) {
    return { action: "CONTINUE_CONSERVATIVE", guidance: "proceed under the tightened self-budget and surface that capacity is unobserved" };
  }
  return {
    action: "SUSPEND",
    terminal: false, // explicitly NOT a failure
    steps: ["CHECKPOINT", "PERSIST_COMPLETED", "PERSIST_REMAINING", "SUSPEND", "RESUME_WHEN_CAPACITY_RETURNS"],
    guidance: assessment.reason,
  };
}

/**
 * Reason code for `hardStopReason()`. Returned as a SUSPEND-class reason so a caller cannot
 * confuse it with a genuine hard stop -- the mission is intact, only this segment pauses.
 */
export function ownerReserveStopReason(assessment) {
  return assessment?.state === CAPACITY_STATE.REACHED ? "OWNER_RESERVE_REACHED" : null;
}
