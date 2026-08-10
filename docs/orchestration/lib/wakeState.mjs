// Wake-state visibility (Owner requirement) — the FULL pre-execution → consumption chain, so the
// Control Center distinguishes authorization from trigger from execution, and — critically —
// "authorized work is WAITING_FOR_TRIGGER" from "no authorized work exists".
//
// Extends the work-pickup lifecycle (workLifecycle.mjs) with the earlier wake stages. Not a new
// queue: it annotates the same durable assignments. READY is never authorization; a protected
// boundary is never auto-triggered (enforced upstream in wakeSupervisor.assessReadiness).

export const WAKE_STATES = Object.freeze([
  "READY",        // eligible work exists (selection), but NOT yet authorized — never a reason to run
  "AUTHORIZED",   // explicit authorization granted (authorized === true); still needs a trigger
  "ROUTED",       // a durable assignment written to a worker
  "TRIGGERED",    // a wake was ATTEMPTED (see triggerMechanism); not proof of pickup
  "ACKNOWLEDGED", // the worker confirmed receipt
  "ACTIVE",       // execution began
  "COMPLETED",    // a durable result exists
  "CONSUMED",     // the destination interpreted/disposed the result
]);
const WAKE_INDEX = Object.freeze(Object.fromEntries(WAKE_STATES.map((s, i) => [s, i])));

// Trigger mechanism/state (aligned with wakeSupervisor). NO_WAKE_MECHANISM is the honest seam.
export const TRIGGER_MECHANISM = Object.freeze(["MANUAL_RUNTIME_TRIGGER", "AUTOMATIC_TRIGGER", "NO_WAKE_MECHANISM", "FAILED"]);

// A derived, Owner-facing status that resolves the key ambiguity.
export const WAKE_STATUS = Object.freeze([
  "NO_AUTHORIZED_WORK",   // nothing is AUTHORIZED+ — a legitimate resting state
  "WAITING_FOR_TRIGGER",  // authorized/routed work exists but has NOT been woken (e.g. NO_WAKE_MECHANISM)
  "TRIGGERED_PENDING",    // a wake was attempted; awaiting acknowledge
  "IN_FLIGHT",            // acknowledged/active
  "AWAITING_CONSUMPTION", // completed, not yet consumed (feeds §23)
  "TRIGGER_FAILED",       // the wake attempt failed
]);

export function isAuthorized(item) { return item && WAKE_INDEX[item.wakeState] >= WAKE_INDEX.AUTHORIZED; }
export function isTriggered(item) { return item && WAKE_INDEX[item.wakeState] >= WAKE_INDEX.TRIGGERED; }

/**
 * Derive the Owner-facing wake status for ONE assignment. Distinguishes the two states the Owner
 * called out: authorized-but-waiting-for-trigger vs no-authorized-work.
 */
export function deriveWakeStatus(item) {
  if (!item || WAKE_INDEX[item.wakeState] < WAKE_INDEX.AUTHORIZED) return "NO_AUTHORIZED_WORK";
  if (item.triggerMechanism === "FAILED") return "TRIGGER_FAILED";
  if (item.wakeState === "COMPLETED") return "AWAITING_CONSUMPTION";
  if (WAKE_INDEX[item.wakeState] >= WAKE_INDEX.ACKNOWLEDGED) return "IN_FLIGHT";
  if (item.wakeState === "TRIGGERED") return "TRIGGERED_PENDING";
  // AUTHORIZED or ROUTED but not yet triggered → waiting for a wake (the honest seam surfaces here).
  return "WAITING_FOR_TRIGGER";
}

/**
 * Project the wake board for the cockpit: per-item status + counts by wake state, trigger mechanism,
 * and derived status — so the Owner can tell, at a glance, whether authorized work is merely waiting
 * for a wake (a FUTURE_SEAM condition) versus genuinely drained.
 */
export function projectWakeBoard(items = []) {
  const byWakeState = {}; for (const s of WAKE_STATES) byWakeState[s] = 0;
  const byTrigger = {}; for (const t of TRIGGER_MECHANISM) byTrigger[t] = 0;
  const byStatus = {}; for (const s of WAKE_STATUS) byStatus[s] = 0;
  const rows = [];
  for (const it of items || []) {
    if (it.wakeState && byWakeState[it.wakeState] != null) byWakeState[it.wakeState]++;
    if (it.triggerMechanism && byTrigger[it.triggerMechanism] != null) byTrigger[it.triggerMechanism]++;
    const status = deriveWakeStatus(it);
    byStatus[status] = (byStatus[status] || 0) + 1;
    rows.push({ workId: it.workId, responsibleParty: it.responsibleParty, wakeState: it.wakeState, triggerMechanism: it.triggerMechanism ?? null, status });
  }
  const authorizedWaiting = byStatus.WAITING_FOR_TRIGGER || 0;
  return {
    byWakeState, byTrigger, byStatus, rows,
    // The Owner's explicit distinction, surfaced as a single honest flag:
    authorizedButWaitingForTrigger: authorizedWaiting > 0,
    note: authorizedWaiting > 0
      ? `${authorizedWaiting} authorized item(s) WAITING_FOR_TRIGGER — authorized work exists but was not woken (trigger seam).`
      : null,
  };
}
