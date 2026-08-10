// Work pickup / responsibility visibility (Owner-approved control-plane requirement).
//
// THE PROBLEM: routed/assigned work does NOT prove the intended worker received it or started.
// A UX/Design/Claude session may be open but cannot necessarily be externally awakened, so the
// Control Center must never imply work is active merely because it was routed. This is a durable
// LIFECYCLE + escalation vocabulary that ANNOTATES existing assignments (agent requests,
// collaboration requests, decision requests) — it is NOT a new queue and NOT a new Agent Manager.
//
// WORKER-AGNOSTIC: Claude, ChatGPT, Design, UX, Codex, future runtimes, and human workers.
//
// FOUR DISTINCT CONCEPTS (never collapse them):
//   ROUTE       — write the durable assignment. Proves nothing about pickup.
//   TRIGGER     — ATTEMPT to wake/start the intended worker. May not be possible today
//                 (a standing session with no external wake = NO_WAKE_MECHANISM FUTURE_SEAM).
//   ACKNOWLEDGE — the worker itself confirms receipt/ownership. Only the worker can.
//   EXECUTE     — the worker actually performs the work.
// A successful ROUTE is NEVER a successful TRIGGER or ACTIVE execution. A successful TRIGGER is
// NEVER an ACKNOWLEDGE. Silence never implies pickup, progress, completion, or approval.
//
// Pure: schema + transitions + escalation. Timestamps are SUPPLIED by the caller from durable
// evidence — never fabricated. A timestamp with no durable evidence stays null.

export const WORK_LIFECYCLE = Object.freeze(["ASSIGNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CONSUMED"]);
const LIFE_INDEX = Object.freeze(Object.fromEntries(WORK_LIFECYCLE.map((s, i) => [s, i])));

// Escalation is advisory VISIBILITY, not a failure verdict. Elapsed time alone never declares
// failure — WAITING_FOR_PICKUP / POSSIBLY_STALLED are surfaced states, not "failed".
export const ESCALATION_STATES = Object.freeze(["NONE", "WAITING_FOR_PICKUP", "POSSIBLY_STALLED", "NEEDS_OWNER"]);

export const DELIVERY_ACTIONS = Object.freeze(["ROUTE", "TRIGGER", "ACKNOWLEDGE", "EXECUTE"]);

// What a TRIGGER attempt actually achieved. NO_WAKE_MECHANISM is the honest FUTURE_SEAM: the
// assignment is durable but the worker could not be externally awakened (today's session model).
export const TRIGGER_OUTCOMES = Object.freeze(["NOT_ATTEMPTED", "WOKEN", "NO_WAKE_MECHANISM", "FAILED"]);

const DEFAULTS = Object.freeze({
  lifecycle: "ASSIGNED", triggerOutcome: "NOT_ATTEMPTED", escalationState: "NONE",
  acknowledgedAt: null, startedAt: null, lastActivityAt: null, completedAt: null, consumedAt: null,
  expectedAckBy: null, stallAfter: null, escalateToOwnerAfter: null,
});

/** ROUTE — write the durable assignment. Sets ASSIGNED + assignedAt only; nothing about pickup. */
export function routeWork(input = {}) {
  const w = { ...DEFAULTS, ...input };
  if (!w.workId) throw new Error("routeWork: workId is required");
  if (!w.responsibleParty) throw new Error("routeWork: responsibleParty is required (who is expected to act)");
  if (!w.assignedAt) throw new Error("routeWork: assignedAt is required (when the assignment was written)");
  return Object.freeze({ ...w, lifecycle: "ASSIGNED" });
}

export function validateWorkAssignment(w) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!w.workId, "workId is required");
  need(!!w.responsibleParty, "responsibleParty is required");
  need(WORK_LIFECYCLE.includes(w.lifecycle), "lifecycle must be a WORK_LIFECYCLE state");
  need(TRIGGER_OUTCOMES.includes(w.triggerOutcome), "triggerOutcome must be a TRIGGER_OUTCOME");
  need(ESCALATION_STATES.includes(w.escalationState), "escalationState must be an ESCALATION_STATE");
  return errors;
}

/** TRIGGER — record a wake attempt. NEVER advances the lifecycle (trigger ≠ acknowledge). */
export function recordTrigger(w, outcome, atMs = null) {
  if (!TRIGGER_OUTCOMES.includes(outcome)) throw new Error(`recordTrigger: unknown outcome ${JSON.stringify(outcome)}`);
  return Object.freeze({ ...w, triggerOutcome: outcome, triggeredAt: atMs });
}

const LEGAL_NEXT = Object.freeze({
  ASSIGNED: "ACKNOWLEDGED", ACKNOWLEDGED: "ACTIVE", ACTIVE: "COMPLETED", COMPLETED: "CONSUMED", CONSUMED: null,
});
const STAMP_FOR = Object.freeze({ ACKNOWLEDGED: "acknowledgedAt", ACTIVE: "startedAt", COMPLETED: "completedAt", CONSUMED: "consumedAt" });

/** ACKNOWLEDGE / EXECUTE / complete / consume — one forward hop, worker-driven, stamped from evidence. */
export function advanceWork(w, toState, atMs = null) {
  if (LEGAL_NEXT[w.lifecycle] !== toState) {
    throw new Error(`advanceWork: illegal ${w.lifecycle} -> ${toState} (one forward hop only)`);
  }
  const patch = { lifecycle: toState };
  const stamp = STAMP_FOR[toState];
  if (stamp) patch[stamp] = atMs; // supplied from durable evidence; null if unknown — never fabricated
  if (toState === "ACTIVE") patch.lastActivityAt = atMs;
  return Object.freeze({ ...w, ...patch });
}

/** Heartbeat: update lastActivityAt while ACTIVE (durable evidence of ongoing work). */
export function recordActivity(w, atMs) {
  if (w.lifecycle !== "ACTIVE") return w;
  return Object.freeze({ ...w, lastActivityAt: atMs });
}

/**
 * Escalation VISIBILITY — computed from EXPLICIT expectations, never raw elapsed time as failure.
 *   ASSIGNED past expectedAckBy → WAITING_FOR_PICKUP (routed, not yet picked up; NOT a failure)
 *   ACTIVE with lastActivityAt older than stallAfter → POSSIBLY_STALLED (NOT declared failed)
 *   past an explicit escalateToOwnerAfter while still un-acknowledged → NEEDS_OWNER
 * Requires the caller to have set the expectation; with no expectation, escalation is NONE.
 */
export function computeEscalation(w, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.parse(nowMs);
  const past = (t) => t != null && Number.isFinite(now) && now >= (typeof t === "number" ? t : Date.parse(t));
  if (w.lifecycle === "ASSIGNED") {
    if (w.escalateToOwnerAfter != null && past(w.escalateToOwnerAfter)) return "NEEDS_OWNER";
    if (w.expectedAckBy != null && past(w.expectedAckBy)) return "WAITING_FOR_PICKUP";
  }
  if (w.lifecycle === "ACTIVE" && w.stallAfter != null && w.lastActivityAt != null) {
    const staleAt = (typeof w.lastActivityAt === "number" ? w.lastActivityAt : Date.parse(w.lastActivityAt))
      + (typeof w.stallAfter === "number" ? w.stallAfter : 0);
    if (Number.isFinite(now) && now >= staleAt) return "POSSIBLY_STALLED";
  }
  return "NONE";
}

export function withEscalation(w, nowMs) {
  return Object.freeze({ ...w, escalationState: computeEscalation(w, nowMs) });
}

// Invariant guards (the Owner's hard rules), usable by callers/tests.
export const isAcknowledged = (w) => LIFE_INDEX[w.lifecycle] >= LIFE_INDEX.ACKNOWLEDGED;
export const isActive = (w) => LIFE_INDEX[w.lifecycle] >= LIFE_INDEX.ACTIVE;
export const isCompleted = (w) => LIFE_INDEX[w.lifecycle] >= LIFE_INDEX.COMPLETED;
export const isConsumed = (w) => w.lifecycle === "CONSUMED";

// Compact projection for the "Who's Doing What" view — the single most recent durable timestamp.
export function summarizeAssignment(w) {
  const lastDurable = w.consumedAt ?? w.completedAt ?? w.lastActivityAt ?? w.startedAt ?? w.acknowledgedAt ?? w.assignedAt ?? null;
  return {
    workId: w.workId, responsibleParty: w.responsibleParty, resultDestination: w.resultDestination ?? null,
    lifecycle: w.lifecycle, escalationState: w.escalationState, triggerOutcome: w.triggerOutcome,
    lastDurableAt: lastDurable,
  };
}
