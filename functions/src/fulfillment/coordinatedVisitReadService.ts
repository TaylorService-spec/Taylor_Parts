// Coordinated Operations — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Fixes a fidelity gap
// flagged 2026-08-15: `Coordinated Visits` (Service/Dispatch) and `Coordinated Mission` (Technician) are
// normal, visible product surfaces, but their client-side default source was SYNTHETIC data presented as
// real product. The Sales Order → Work Order coordination model already exists and is real: the pure
// projections `buildCoordinatedVisits`/`buildCoordinatedVisit` (./coordinatedVisit.ts) and
// `buildCoordinatedFieldMission` (./coordinatedFieldMission.ts) are framework-independent, unit-tested, and
// unchanged by this file. What was missing was a governed READ that hands those projections real Work
// Order data. This file is that read — nothing else. No new coordination model, no new Job/Visit/
// WorkOrderGroup authority: the Sales Order remains the coordination anchor and each Work Order remains
// individual execution/accountability, exactly as coordinatedVisit.ts's own header states.
//
// Follows the `salesOrder.read` / `inventory.serializedAsset.read` trusted-read pattern exactly
// (functions/src/salesOrder/salesOrderReadService.ts, functions/src/serializedAsset/
// serializedAssetReadService.ts):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `fulfillment.coordinatedVisit.read`, resolved through the
//     trusted effective-access feed (registered active:false ⇒ ungranted ⇒ deny for everyone; this phase
//     grants it to NO Role and adds NO per-environment activation override — same posture as
//     inventory.serializedAsset.read's own introduction);
//   • the client does NOT receive direct `fieldops_wos` read access for this purpose (firestore.rules is
//     UNCHANGED by this file); a trusted backend resolves the caller's governed scope, reads the canonical
//     Work Order documents via the Admin SDK, and returns ONLY the minimal fields the two existing
//     projections need (id, woNumber, status, customerId, locationId, salesOrderId, salesOrderLineRefs) —
//     no raw UID, no execution log, no financial/pricing data;
//   • distinguishes the states the caller must tell apart: denied · unavailable · ready.
//
// QUERY SHAPE / BOUNDING: a single-field `status IN [...]` filter (Firestore auto-maintains a single-field
// index for this — NO composite index needed) narrows to Work Orders that are not yet CLOSED, bounded by
// `.limit()`. This is honest but NOT a server-side `salesOrderId`-presence filter — Firestore cannot filter
// "field is a non-empty string" on a SECOND field without a composite index alongside the `status IN`
// filter, and adding one is a separate, reportable step (see the PR report). Non-coordinated Work Orders
// (no salesOrderId) are still fetched within the bounded page and dropped here, purely in code — matching
// groupWorkOrdersBySalesOrder's own behavior. If the open-WO volume ever regularly exceeds DEFAULT_LIMIT,
// a composite index on (status, salesOrderId) would let this filter server-side instead.
//
// FIELD SIGNALS ARE NOT WIRED HERE: `fieldSignalsByWorkOrderId` (parts readiness, load verification) and
// operational context (scheduled window, technician/truck names) are SEPARATE governed sources
// (coordinatedFieldMission.ts's own header: "Field signals ... are INJECTED from the governed sources; this
// projection never fabricates them"). Wiring the WO Parts Planning read, Scheduling/assignment read, and
// Account/Location name resolution into this snapshot is future work — this read honestly leaves them
// empty rather than fabricating them, so every unit renders UNKNOWN parts/load readiness (F1/F2 principle),
// not a fake READY.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production until a
// separate deploy + capability grant + per-environment activation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { WORK_ORDERS_COLLECTION } from "../constants/collections";
import type { SalesOrderLineRef } from "../types/workOrder";

export const COORDINATED_VISIT_READ_CAPABILITY = "fulfillment.coordinatedVisit.read";

// Work Order statuses considered part of the ACTIVE coordination queue. CLOSED is the only status excluded
// -- a fully closed Work Order is archived, not an open coordination obligation. CANCELLED is deliberately
// INCLUDED (not excluded): coordinatedVisit.ts's own BLOCKED_STATUSES treats a cancelled unit as needing
// attention, so silently dropping cancelled units here would hide a real ATTENTION signal. Nine of the
// eleven WorkOrderStatus values below fit Firestore's `in` operator without needing to chunk.
const ACTIVE_COORDINATION_STATUSES = [
  "CREATED",
  "READY_TO_DISPATCH",
  "SCHEDULED",
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const DEFAULT_LIMIT = 300;

// The minimal projected shape the coordinatedVisit/coordinatedFieldMission projections consume (mirrors
// WorkOrderLike in ./coordinatedVisit.ts). No raw UID (assignedTechId/scheduledTechId/createdByUid are NOT
// projected -- the pure projections never needed them, and this read does not introduce them), no
// financial/pricing data (salesOrderLineRefs carries only ref/kind/orderedQty/allocatedQty, the same shape
// already authoritative on the Work Order document).
export interface CoordinatedWorkOrderProjection {
  id: string;
  woNumber: string | null;
  status: string | null;
  customerId: string | null;
  locationId: string | null;
  salesOrderId: string;
  salesOrderLineRefs: SalesOrderLineRef[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function projectLineRef(raw: unknown): SalesOrderLineRef | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const ref = str(l.ref);
  const kind = str(l.kind);
  if (!ref || !kind) return null;
  const out: SalesOrderLineRef = { ref, kind, orderedQty: num(l.orderedQty), allocatedQty: num(l.allocatedQty) };
  const lineId = str(l.lineId);
  if (lineId) out.lineId = lineId;
  return out;
}

// Pure projection of one canonical `fieldops_wos/{id}` doc -> the minimal coordinated-visit shape. Returns
// null (skip, never fabricate) if the doc lacks a usable id or a non-empty `salesOrderId` -- a standalone
// Work Order (no Sales Order coordination link) is not part of this read's subject matter at all.
export function projectCoordinatedWorkOrder(id: string, data: Record<string, unknown> | undefined): CoordinatedWorkOrderProjection | null {
  if (typeof id !== "string" || id.trim() === "" || !data || typeof data !== "object") return null;
  const salesOrderId = str(data.salesOrderId);
  if (!salesOrderId) return null;
  const rawRefs = Array.isArray(data.salesOrderLineRefs) ? data.salesOrderLineRefs : [];
  return {
    id,
    woNumber: str(data.woNumber),
    status: str(data.status),
    customerId: str(data.customerId),
    locationId: str(data.locationId),
    salesOrderId,
    salesOrderLineRefs: rawRefs.map(projectLineRef).filter((r): r is SalesOrderLineRef => r !== null),
  };
}

export interface CoordinatedOperationsReadResult {
  status: "ready";
  workOrders: CoordinatedWorkOrderProjection[];
  skipped: number; // fetched docs that were not honestly projectable OR carried no salesOrderId (not coordinated)
  truncated: boolean; // true when the active-status Work Order count exceeds `limit`
}

// Core bounded read, factored out of the onCall adapter for direct testability (mirrors
// readSalesOrdersForAccount / getAvailableEquipment's own core-function split).
export async function readActiveCoordinatedWorkOrders(
  db: FirebaseFirestore.Firestore,
  limit: number = DEFAULT_LIMIT
): Promise<CoordinatedOperationsReadResult> {
  // Single-field `in` filter, no `.orderBy()` -- needs no composite index (see header comment).
  const snap = await db
    .collection(WORK_ORDERS_COLLECTION)
    .where("status", "in", ACTIVE_COORDINATION_STATUSES as unknown as string[])
    .limit(limit + 1)
    .get();
  const truncated = snap.size > limit;
  const docs = snap.docs.slice(0, limit);
  const workOrders: CoordinatedWorkOrderProjection[] = [];
  let skipped = 0;
  for (const d of docs) {
    const projection = projectCoordinatedWorkOrder(d.id, d.data() as Record<string, unknown>);
    if (projection) workOrders.push(projection);
    else skipped += 1;
  }
  return { status: "ready", workOrders, skipped, truncated };
}

// The trusted read callable. Same fail-closed shape as getAvailableEquipment / getSalesOrderContext:
// unauthenticated -> unauthenticated, ungranted -> permission-denied, read failure -> internal
// ("unavailable"). No request payload is accepted -- the caller's own authorized scope resolves entirely
// server-side; there is nothing for a client to parameterize yet (no per-Account/per-technician scoping in
// this phase -- see the PR report for that known limitation).
export const listCoordinatedOperations = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [COORDINATED_VISIT_READ_CAPABILITY],
    });
    allowed = decisions[COORDINATED_VISIT_READ_CAPABILITY] === true;
  } catch (err) {
    console.error(`[listCoordinatedOperations] capability resolution failed for ${COORDINATED_VISIT_READ_CAPABILITY}`, err);
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read coordinated operations.");

  try {
    const db = getFirestore();
    return await readActiveCoordinatedWorkOrders(db);
  } catch {
    throw new HttpsError("internal", "The coordinated-operations read is temporarily unavailable.");
  }
});
