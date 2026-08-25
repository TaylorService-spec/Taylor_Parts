// Coordinated VISIT — PURE read-side mirror of functions/src/fulfillment/coordinatedVisit.ts (kept in sync
// with the backend authority; no I/O, unit-tested). Groups the Work Orders that fulfill ONE Sales Order (they
// share `salesOrderId`) into a single coordinated-visit view for Service/Dispatch — WITHOUT a new Job/Visit/
// WorkOrderGroup authority (the Sales Order IS the coordinator; multi-equipment-coordination-assessment.md).
//
// Per-unit accountability = one Work Order per row; one coordinated visit = this group. Partial completion is
// HONEST: 4 of 5 done + 1 blocked is NOT "complete". This is an OPERATIONAL read, deliberately separate from
// commercial coverage/territory (#15) — it never asserts sales ownership.

// Work Order statuses that count as "done" for the rollup. Small + explicit; any unknown status is treated as
// not-done (we never assume completion we cannot read).
// Exported (not just module-local) so tests can assert every status this projection references is a member
// of the canonical WorkOrderStatus set -- see test/coordinatedVisit.test.mjs.
export const DONE_STATUSES = new Set(["COMPLETED", "CLOSED"]);
// Statuses that actively need attention (blockers). Everything else is simply "in progress".
// ONLY canonical WorkOrderStatus values (types/workOrder.ts) belong here -- "BLOCKED"/"ON_HOLD" are NOT real
// lifecycle statuses (PR #1030 audit finding, mirrors the fix in functions/src/fulfillment/coordinatedVisit.ts).
export const BLOCKED_STATUSES = new Set(["CANCELLED"]);

const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);

// Group Work Orders by their `salesOrderId` (only those that carry one — a standalone Work Order is not part
// of a Sales-Order coordinated visit). Returns Map salesOrderId → Work Orders.
export function groupWorkOrdersBySalesOrder(workOrders) {
  const groups = new Map();
  for (const wo of Array.isArray(workOrders) ? workOrders : []) {
    const soId = str(wo?.salesOrderId);
    if (!soId) continue;
    const list = groups.get(soId) ?? [];
    list.push(wo);
    groups.set(soId, list);
  }
  return groups;
}

// Build the coordinated-visit view for one Sales Order's Work Orders. Honest readiness: any blocked ⇒
// ATTENTION; all done ⇒ READY; some done ⇒ PARTIAL; otherwise IN_PROGRESS. Customer/location are the shared
// context; if the Work Orders disagree, contextConsistent=false (surfaced, not hidden).
export function buildCoordinatedVisit(salesOrderId, workOrders) {
  const list = Array.isArray(workOrders) ? workOrders : [];
  const customers = new Set(list.map((w) => str(w.customerId)).filter((v) => v !== null));
  const locations = new Set(list.map((w) => str(w.locationId)).filter((v) => v !== null));
  let completed = 0;
  let blocked = 0;
  const rows = list.map((w) => {
    const status = str(w.status);
    if (status && DONE_STATUSES.has(status)) completed += 1;
    if (status && BLOCKED_STATUSES.has(status)) blocked += 1;
    return {
      id: w.id,
      woNumber: str(w.woNumber),
      status,
      lineRefs: Array.isArray(w.salesOrderLineRefs) ? w.salesOrderLineRefs : [],
      equipmentLabel: str(w.equipmentLabel), // optional display label for the equipment unit (never fabricated)
    };
  });
  const total = rows.length;
  let readiness;
  if (blocked > 0) readiness = "ATTENTION";
  else if (total > 0 && completed === total) readiness = "READY";
  else if (completed > 0) readiness = "PARTIAL";
  else readiness = "IN_PROGRESS";
  return {
    salesOrderId,
    customerId: customers.size ? [...customers][0] : null,
    locationId: locations.size ? [...locations][0] : null,
    contextConsistent: customers.size <= 1 && locations.size <= 1,
    total,
    completed,
    blocked,
    remaining: total - completed, // remaining obligation (never negative for well-formed input)
    readiness,
    workOrders: rows,
  };
}

// Build coordinated-visit views for a set of Work Orders (one per Sales Order that has Work Orders).
export function buildCoordinatedVisits(workOrders) {
  const groups = groupWorkOrdersBySalesOrder(workOrders);
  return [...groups.entries()].map(([soId, wos]) => buildCoordinatedVisit(soId, wos));
}

// Semantic tone (Wave-0 StatusPill vocabulary) for a visit readiness. PARTIAL/IN_PROGRESS are progress states
// (not problems) → info/neutral; ATTENTION → attention; READY → positive.
const VISIT_READINESS_TONE = { READY: "positive", PARTIAL: "info", IN_PROGRESS: "neutral", ATTENTION: "attention" };
const VISIT_READINESS_LABEL = { READY: "Ready", PARTIAL: "Partial", IN_PROGRESS: "In progress", ATTENTION: "Attention" };
export const visitReadinessTone = (r) => VISIT_READINESS_TONE[r] ?? "unknown";
export const visitReadinessLabel = (r) => VISIT_READINESS_LABEL[r] ?? "Unknown";

// Tone for a single Work Order status row within the visit (done / blocked / in-progress).
export function workOrderStatusTone(status) {
  if (status && DONE_STATUSES.has(status)) return "positive";
  if (status && BLOCKED_STATUSES.has(status)) return "attention";
  return status ? "neutral" : "unknown";
}

/**
 * HOW THE ANCHORING SALES ORDER IS NAMED ON SCREEN.
 *
 * Both coordinated surfaces rendered `salesOrderLabelById[id] || id`, and that label map was
 * honestly empty — so Coordinated Visits and Coordinated Mission each printed a Firestore document
 * id at the top of the screen. DECISIONS #106: a document id is a routing key, not a name, and a
 * missing reference is not permission to display one.
 *
 * Shared rather than duplicated, so the two surfaces cannot drift into disagreeing about how to
 * name the order a technician is working against.
 *
 * The fallback says WHAT the thing is and that its number could not be read — it does not invent a
 * number, abbreviate the key, or imply an official reference exists.
 */
export const SALES_ORDER_ANCHOR_UNRESOLVED = "Sales Order — reference unavailable";

export function salesOrderAnchorLabel(salesOrderLabelById, salesOrderId) {
  const reference = salesOrderId ? salesOrderLabelById?.[salesOrderId] : null;
  // A non-empty string is the only thing that counts as a reference. Anything else — absent, null,
  // blank, or a non-string that crept through a projection — takes the truthful fallback.
  return typeof reference === "string" && reference.trim().length > 0
    ? reference.trim()
    : SALES_ORDER_ANCHOR_UNRESOLVED;
}
