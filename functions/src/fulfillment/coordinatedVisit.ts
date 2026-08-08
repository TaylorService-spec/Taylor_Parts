// Fulfillment — PURE coordinated-visit projection (Cycle 8 impl; framework-independent, unit-tested). Groups
// the Work Orders that fulfill one Sales Order (they share `salesOrderId`, established in Cycle 7) into a
// single coordinated-visit view for Dispatch/Scheduling — WITHOUT a new Job/Visit/WorkOrderGroup authority
// (multi-equipment-coordination-assessment.md: the Sales Order IS the coordinator). No Firestore imports.
//
// This is an OPERATIONAL (Service/Dispatch) read — deliberately SEPARATE from commercial coverage/territory
// (register #15): it groups by the Sales Order and shows the shared customer/site + per-Work-Order execution,
// and never asserts sales ownership. Per-unit accountability = one Work Order per row; one coordinated visit =
// this group; partial completion is honest (never a fake whole-visit COMPLETE/INCOMPLETE).

export interface WorkOrderLike {
  id: string;
  woNumber?: string;
  status?: string;
  customerId?: string;
  locationId?: string;
  salesOrderId?: string;
  salesOrderLineRefs?: string[];
}

// Work Order statuses that count as "done" for the coordinated-visit rollup. Kept small + explicit; unknown
// statuses are treated as not-done (honest — we don't assume completion we can't read).
const DONE_STATUSES = new Set(["COMPLETED", "CLOSED"]);
// Statuses that actively need attention (blockers). Others are simply "in progress".
const BLOCKED_STATUSES = new Set(["BLOCKED", "ON_HOLD", "CANCELLED"]);

export type VisitReadiness = "READY" | "IN_PROGRESS" | "PARTIAL" | "ATTENTION";

export interface CoordinatedVisit {
  salesOrderId: string;
  customerId: string | null;
  locationId: string | null;
  contextConsistent: boolean; // false if the grouped Work Orders disagree on customer/location (a data issue)
  total: number;
  completed: number;
  blocked: number;
  readiness: VisitReadiness;
  workOrders: Array<{ id: string; woNumber: string | null; status: string | null; lineRefs: string[] }>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

// Group Work Orders by their `salesOrderId` (only those that carry one — standalone Work Orders are not part
// of a Sales-Order coordinated visit). Returns a map salesOrderId → Work Orders.
export function groupWorkOrdersBySalesOrder(workOrders: WorkOrderLike[]): Map<string, WorkOrderLike[]> {
  const groups = new Map<string, WorkOrderLike[]>();
  for (const wo of Array.isArray(workOrders) ? workOrders : []) {
    const soId = str(wo?.salesOrderId);
    if (!soId) continue;
    const list = groups.get(soId) ?? [];
    list.push(wo);
    groups.set(soId, list);
  }
  return groups;
}

// Build the coordinated-visit view for one Sales Order's Work Orders. Honest partial completion: all done ⇒
// READY; any blocked ⇒ ATTENTION; some done + some not ⇒ PARTIAL; otherwise IN_PROGRESS. Customer/location are
// the shared context; if the Work Orders disagree, contextConsistent=false (surfaced, not hidden).
export function buildCoordinatedVisit(salesOrderId: string, workOrders: WorkOrderLike[]): CoordinatedVisit {
  const list = Array.isArray(workOrders) ? workOrders : [];
  const customers = new Set(list.map((w) => str(w.customerId)).filter((v): v is string => v !== null));
  const locations = new Set(list.map((w) => str(w.locationId)).filter((v): v is string => v !== null));
  let completed = 0;
  let blocked = 0;
  const rows = list.map((w) => {
    const status = str(w.status);
    if (status && DONE_STATUSES.has(status)) completed += 1;
    if (status && BLOCKED_STATUSES.has(status)) blocked += 1;
    return { id: w.id, woNumber: str(w.woNumber), status, lineRefs: Array.isArray(w.salesOrderLineRefs) ? w.salesOrderLineRefs : [] };
  });
  const total = rows.length;
  let readiness: VisitReadiness;
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
    readiness,
    workOrders: rows,
  };
}

// Build coordinated-visit views for a set of Work Orders (one per Sales Order that has Work Orders).
export function buildCoordinatedVisits(workOrders: WorkOrderLike[]): CoordinatedVisit[] {
  const groups = groupWorkOrdersBySalesOrder(workOrders);
  return [...groups.entries()].map(([soId, wos]) => buildCoordinatedVisit(soId, wos));
}
