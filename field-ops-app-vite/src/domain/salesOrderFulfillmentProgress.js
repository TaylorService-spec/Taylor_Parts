// SALES ORDER -> FULFILLMENT & INSTALLATION PROGRESSION.
//
// A pure projection from records that already exist onto the left-to-right progression a
// salesperson asks about: "where is my customer's order?"
//
//   ORDER CONFIRMED -> INVENTORY ALLOCATED -> INSTALLATION CREATED -> SCHEDULED
//   -> DISPATCHED -> ON SITE -> INSTALLED -> CUSTOMER HANDOFF
//
// ============================ WHAT THIS IS NOT ============================
//
// It is NOT a status field. Nothing writes these steps and nothing may. Every value is
// derived, each time, from the Sales Order's own state, its line quantities, and the Work
// Orders linked to it. An editable "installation status" would be a second source of truth
// that drifts from the records it claims to summarize, and the drift would be invisible
// precisely because the field looks authoritative.
//
// ============================ UNKNOWN STAYS UNKNOWN ============================
//
// The rule this file exists to enforce: ABSENT EVIDENCE IS NOT EVIDENCE OF COMPLETION.
//
// If no Work Order is linked, installation is UNKNOWN -- not "not started", because a Work
// Order may exist that this caller could not read. If no custody event exists, CUSTOMER
// HANDOFF is UNKNOWN -- not "done", even when everything before it is complete. A green
// chevron is a claim about the real world, and this projection may only make claims it can
// support.
//
// ============================ MANY UNITS, ONE ANSWER ============================
//
// One Sales Order can carry several installations. The overall progression is the WEAKEST
// link, never the furthest: it does not say INSTALLED while any required installation is
// outstanding. Per-Work-Order detail is returned alongside so the summary can be honest
// without hiding the parts that are ahead.

/** The eight steps, in order. Exported so the UI cannot invent a ninth or reorder them. */
export const FULFILLMENT_STEPS = Object.freeze([
  { key: "confirmed", label: "Order Confirmed" },
  { key: "allocated", label: "Inventory Allocated" },
  { key: "installationCreated", label: "Installation Created" },
  { key: "scheduled", label: "Scheduled" },
  { key: "dispatched", label: "Dispatched" },
  { key: "onSite", label: "On Site" },
  { key: "installed", label: "Installed" },
  { key: "handoff", label: "Customer Handoff" },
]);

/**
 * Step states.
 *
 * COMPLETE / CURRENT / FUTURE are the ordinary progression. The other three are the honest
 * answers a progression usually lacks, and the reason this is not a simple index:
 *   BLOCKED   evidence says this cannot proceed (e.g. every linked Work Order cancelled)
 *   FAILED    the order itself was cancelled
 *   UNKNOWN   the authority that would prove this step does not exist or was not readable
 */
export const STEP_STATE = Object.freeze({
  COMPLETE: "complete",
  CURRENT: "current",
  FUTURE: "future",
  BLOCKED: "blocked",
  FAILED: "failed",
  UNKNOWN: "unknown",
});

// Work Order statuses, from the transition engine and accountWorkOrders' own lists. Grouped
// by what each proves about the physical world rather than by name.
const DISPATCH_REACHED = new Set(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED"]);
const ONSITE_REACHED = new Set(["ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED"]);
const SCHEDULED_REACHED = new Set(["SCHEDULED", ...DISPATCH_REACHED]);
const INSTALLED_REACHED = new Set(["COMPLETED", "CLOSED"]);
const CANCELLED = new Set(["CANCELLED"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Allocation and fulfilment totals across the order's lines.
 *
 * Returns nulls rather than zeros when the quantities are absent: an order whose lines carry
 * no allocatedQty has not "allocated nothing", it has told us nothing. Zero is a measurement;
 * null is the absence of one, and the two must not be spelled the same way.
 */
export function summarizeQuantities(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ordered: null, allocated: null, fulfilled: null, lineCount: 0 };
  }
  let ordered = 0;
  let allocated = 0;
  let fulfilled = 0;
  let sawAllocated = false;
  let sawFulfilled = false;
  for (const line of lines) {
    ordered += num(line?.orderedQty) ?? 0;
    const a = num(line?.allocatedQty);
    const f = num(line?.fulfilledQty);
    if (a !== null) { allocated += a; sawAllocated = true; }
    if (f !== null) { fulfilled += f; sawFulfilled = true; }
  }
  return {
    ordered,
    allocated: sawAllocated ? allocated : null,
    fulfilled: sawFulfilled ? fulfilled : null,
    lineCount: lines.length,
  };
}

/** Where one Work Order has reached. Pure, and deliberately tiny. */
export function projectWorkOrderProgress(workOrder) {
  const status = typeof workOrder?.status === "string" ? workOrder.status : null;
  return {
    id: workOrder?.id ?? null,
    workOrderNumber: workOrder?.workOrderNumber ?? null,
    status,
    scheduledAtMillis: num(workOrder?.scheduledAtMillis),
    technicianName: workOrder?.technicianName ?? null,
    cancelled: status !== null && CANCELLED.has(status),
    reachedScheduled: status !== null && SCHEDULED_REACHED.has(status),
    reachedDispatched: status !== null && DISPATCH_REACHED.has(status),
    reachedOnSite: status !== null && ONSITE_REACHED.has(status),
    reachedInstalled: status !== null && INSTALLED_REACHED.has(status),
  };
}

/**
 * The whole progression.
 *
 * @param salesOrder  the governed projection (state, lines, serviceWorkOrderIds)
 * @param workOrders  the linked Work Orders the caller could actually READ. `null` means
 *                    "not loaded / not readable" and is NOT the same as `[]`, which means
 *                    "loaded, and there are none". The first yields UNKNOWN; the second is
 *                    a real answer.
 * @param custodyHandoff  an authoritative custody/handoff event, or null when none exists.
 */
export function projectFulfillmentProgress(salesOrder, workOrders, custodyHandoff = null) {
  const state = typeof salesOrder?.state === "string" ? salesOrder.state : null;
  const qty = summarizeQuantities(salesOrder?.lines);
  const wosKnown = Array.isArray(workOrders);
  const wos = wosKnown ? workOrders.map(projectWorkOrderProgress) : [];
  const live = wos.filter((w) => !w.cancelled);

  // A cancelled ORDER fails the whole progression. Nothing downstream can be true, and
  // showing earlier steps as complete would read as progress toward an outcome that is gone.
  if (state === "CANCELLED") {
    return {
      steps: FULFILLMENT_STEPS.map((s) => ({ ...s, state: STEP_STATE.FAILED })),
      workOrders: wos,
      quantities: qty,
      overall: STEP_STATE.FAILED,
      blockers: ["This Sales Order was cancelled."],
    };
  }

  const blockers = [];
  const at = {};

  // 1. ORDER CONFIRMED — the Sales Order exists in a committed state.
  at.confirmed = state ? STEP_STATE.COMPLETE : STEP_STATE.UNKNOWN;
  if (!state) blockers.push("The Sales Order state could not be read.");

  // 2. INVENTORY ALLOCATED — every ordered unit allocated. Partial is CURRENT, not complete.
  if (qty.allocated === null) {
    at.allocated = STEP_STATE.UNKNOWN;
    blockers.push("Allocation quantities are not recorded on this order.");
  } else if (qty.ordered > 0 && qty.allocated >= qty.ordered) {
    at.allocated = STEP_STATE.COMPLETE;
  } else if (qty.allocated > 0) {
    at.allocated = STEP_STATE.CURRENT;
  } else {
    at.allocated = STEP_STATE.FUTURE;
  }

  // 3. INSTALLATION CREATED — at least one live Work Order links to this order.
  if (!wosKnown) {
    at.installationCreated = STEP_STATE.UNKNOWN;
    blockers.push("Linked Work Orders could not be read, so installation progress is unknown.");
  } else if (live.length > 0) {
    at.installationCreated = STEP_STATE.COMPLETE;
  } else if (wos.length > 0) {
    // Every linked Work Order is cancelled: not "not created", and not progressing either.
    at.installationCreated = STEP_STATE.BLOCKED;
    blockers.push("Every linked Work Order has been cancelled.");
  } else {
    at.installationCreated = STEP_STATE.FUTURE;
  }

  // 4-7. The physical steps. EVERY live Work Order must have reached a step for the ORDER to
  // claim it -- the weakest link, never the furthest ahead.
  const everyLive = (pred) => live.length > 0 && live.every(pred);
  const someLive = (pred) => live.some(pred);

  const physical = [
    ["scheduled", (w) => w.reachedScheduled],
    ["dispatched", (w) => w.reachedDispatched],
    ["onSite", (w) => w.reachedOnSite],
    ["installed", (w) => w.reachedInstalled],
  ];
  for (const [key, pred] of physical) {
    if (!wosKnown) { at[key] = STEP_STATE.UNKNOWN; continue; }
    if (live.length === 0) { at[key] = at.installationCreated === STEP_STATE.BLOCKED ? STEP_STATE.BLOCKED : STEP_STATE.FUTURE; continue; }
    if (everyLive(pred)) at[key] = STEP_STATE.COMPLETE;
    else if (someLive(pred)) at[key] = STEP_STATE.CURRENT;
    else at[key] = STEP_STATE.FUTURE;
  }
  if (wosKnown && live.length > 1 && someLive((w) => w.reachedInstalled) && !everyLive((w) => w.reachedInstalled)) {
    blockers.push(`${live.filter((w) => w.reachedInstalled).length} of ${live.length} installations complete.`);
  }

  // 8. CUSTOMER HANDOFF — needs an authoritative custody event. There is no such event in the
  // model today, so this is UNKNOWN rather than inferred from "everything else finished".
  // Finishing the work and handing the equipment over are different facts, and only one of
  // them is recorded.
  if (custodyHandoff) {
    at.handoff = STEP_STATE.COMPLETE;
  } else {
    at.handoff = STEP_STATE.UNKNOWN;
    blockers.push("Customer handoff is not recorded: no serialized-asset custody event exists for this order.");
  }

  // The FIRST step that is not complete becomes CURRENT, so the progression reads left to
  // right with one obvious "you are here" -- unless that step is already blocked/unknown, in
  // which case its own state is the more informative one and is kept.
  const steps = FULFILLMENT_STEPS.map((s) => ({ ...s, state: at[s.key] ?? STEP_STATE.FUTURE }));
  const firstOpen = steps.find((s) => s.state !== STEP_STATE.COMPLETE);
  if (firstOpen && firstOpen.state === STEP_STATE.FUTURE) firstOpen.state = STEP_STATE.CURRENT;

  const overall = steps.every((s) => s.state === STEP_STATE.COMPLETE)
    ? STEP_STATE.COMPLETE
    : (firstOpen?.state ?? STEP_STATE.UNKNOWN);

  return { steps, workOrders: wos, quantities: qty, overall, blockers };
}
