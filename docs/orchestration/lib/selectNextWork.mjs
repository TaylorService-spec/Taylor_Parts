// Continuous Workstream Orchestrator — pure next-eligible work selector.
//
// This is the CORE the Option A `/loop` continuation driver runs each iteration
// (see ../loop-continuation-driver.md). It is a PURE function: no I/O, no
// scheduler, no timers, no unattended self-invocation — Option B (unattended
// self-scheduling) is deliberately NOT implemented here. A driver iteration
// reads the durable backlog (../execution-backlog.md), maps it to work items,
// calls selectNextWork(), and acts on the returned decision.
//
// It encodes the design's §4 selection rule AND the Owner-ratified correction:
// before declaring a checkpoint / roadmap-complete, blocked items are inspected
// for executable repo-safe PREREQUISITE work (investigation / assessment /
// authority tracing / design / evidence / tests / docs-reconciliation /
// migration-readiness) — a blocked *implementation* does not mean its
// prerequisite *discovery* is blocked.

/** The schedulability states a work item may carry (design §3; +READY_BUT_WAITING_RESOURCE, Phase 3 §4). */
export const WORK_STATES = Object.freeze([
  "READY",
  "RUNNING",
  "READY_BUT_WAITING_RESOURCE", // valid + unblocked, but no global remote-agent slot free — a TRANSIENT resource wait, NOT a product blocker
  "BLOCKED_DEPENDENCY",
  "OWNER_DECISION",
  "PROTECTED_ACTION",
  "TOOL_PERMISSION_BLOCKED",
  "SAFE_CHECKPOINT",
  "BUDGET_LIMIT",
  "DONE",
  "ROADMAP_COMPLETE",
]);

/** Decision kinds returned to the driver. */
export const DECISIONS = Object.freeze({
  RUN: "RUN", // begin (or resume) this item now
  PREREQUISITE_AVAILABLE: "PREREQUISITE_AVAILABLE", // no READY item, but a blocked item exposes repo-safe prerequisite work
  WAIT_RESOURCE: "WAIT_RESOURCE", // only resource-waiting work remains — hold and retry when a slot frees (transient, not a gate)
  CHECKPOINT: "CHECKPOINT", // no actionable work; only genuine gates (owner/protected/budget/blocked) remain
  ROADMAP_COMPLETE: "ROADMAP_COMPLETE", // nothing left in any non-DONE state
});

// States a worker can act on immediately, most-in-flight first. RUNNING and
// SAFE_CHECKPOINT resume started work before READY starts new work;
// TOOL_PERMISSION_BLOCKED is mechanics (resolve the permission, then continue),
// never a product gate, so it stays actionable.
const ACTIONABLE_RANK = Object.freeze({
  RUNNING: 0,
  SAFE_CHECKPOINT: 1,
  TOOL_PERMISSION_BLOCKED: 2,
  READY: 3,
});

// States that are genuine STOPS (only an Owner / authorized operator / budget
// extension clears them). BLOCKED_DEPENDENCY is a soft stop — it may still carry
// executable prerequisite work (the correction below).
const GATE_STATES = Object.freeze(["OWNER_DECISION", "PROTECTED_ACTION", "BUDGET_LIMIT"]);

function assertKnownStates(items) {
  for (const it of items) {
    if (!WORK_STATES.includes(it.state)) {
      throw new Error(`selectNextWork: unknown state ${JSON.stringify(it.state)} for item ${JSON.stringify(it.id)}`);
    }
  }
}

// §4.2 priority order: (a) explicit pinned priority (lower number = higher),
// then (b) unblocks the most downstream items, then (c) declared backlog order.
// `index` is the item's position in the input array (declared order).
function actionableComparator(a, b) {
  const rankA = ACTIONABLE_RANK[a.state];
  const rankB = ACTIONABLE_RANK[b.state];
  if (rankA !== rankB) return rankA - rankB;
  const pa = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
  const pb = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  const ua = Number.isFinite(a.unblocks) ? a.unblocks : 0;
  const ub = Number.isFinite(b.unblocks) ? b.unblocks : 0;
  if (ua !== ub) return ub - ua; // more unblocks first
  return a.index - b.index; // declared order
}

// A blocked item exposes executable prerequisite work when it carries at least
// one prerequisiteWork entry that is repo-safe and not yet done. This is what
// keeps the R1-style "briefly concluded no READY work" error from recurring.
function pendingPrerequisites(item) {
  if (!Array.isArray(item.prerequisiteWork)) return [];
  return item.prerequisiteWork.filter((p) => p && p.repoSafe === true && p.done !== true);
}

/**
 * Decide what a `/loop` iteration should do next.
 *
 * @param {Array<{id:string,state:string,title?:string,priority?:number,unblocks?:number,
 *                blockedOn?:string,prerequisiteWork?:Array<{kind:string,repoSafe:boolean,done?:boolean}>}>} items
 * @returns {{decision:string, item?:object, prerequisites?:Array<object>, pending?:object}}
 */
export function selectNextWork(items = []) {
  if (!Array.isArray(items)) throw new Error("selectNextWork: items must be an array");
  assertKnownStates(items);

  const withIndex = items.map((it, index) => ({ ...it, index }));

  // 1–2. Highest-ranked actionable item (resume in-flight, else next READY).
  const actionable = withIndex.filter((it) => it.state in ACTIONABLE_RANK).sort(actionableComparator);
  if (actionable.length > 0) {
    const item = actionable[0];
    return { decision: DECISIONS.RUN, item };
  }

  // 3a. CORRECTION — before any checkpoint, surface executable repo-safe
  // prerequisite work hiding inside blocked items.
  const prereqItems = withIndex
    .filter((it) => it.state === "BLOCKED_DEPENDENCY")
    .map((it) => ({ item: it, prerequisites: pendingPrerequisites(it) }))
    .filter((x) => x.prerequisites.length > 0);
  if (prereqItems.length > 0) {
    return { decision: DECISIONS.PREREQUISITE_AVAILABLE, prerequisites: prereqItems };
  }

  // 3b. Transient resource wait (Phase 3 §4). Items that are valid + unblocked but
  // waiting for a global remote-agent slot are NOT a product gate — the driver holds
  // and retries when a slot frees, rather than checkpointing to the Owner.
  const waitingResource = withIndex.filter((it) => it.state === "READY_BUT_WAITING_RESOURCE");

  // 3c. Genuine gates / passive blockers.
  const pending = {
    ownerDecision: withIndex.filter((it) => it.state === "OWNER_DECISION"),
    protectedAction: withIndex.filter((it) => it.state === "PROTECTED_ACTION"),
    budgetLimit: withIndex.filter((it) => it.state === "BUDGET_LIMIT"),
    blocked: withIndex.filter((it) => it.state === "BLOCKED_DEPENDENCY"),
  };
  const anyGate =
    pending.ownerDecision.length + pending.protectedAction.length + pending.budgetLimit.length + pending.blocked.length > 0;

  // Prefer the transient wait: resource-waiting work will run once a slot frees.
  if (waitingResource.length > 0) return { decision: DECISIONS.WAIT_RESOURCE, waitingResource, pending };
  if (!anyGate) return { decision: DECISIONS.ROADMAP_COMPLETE };
  return { decision: DECISIONS.CHECKPOINT, pending };
}

export const _internal = { GATE_STATES, ACTIONABLE_RANK, actionableComparator, pendingPrerequisites };
