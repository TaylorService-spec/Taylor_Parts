import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "./constants";

// Customer/Account Business Model -- Customer PR 3, Service Activity
// (docs/specifications/customer-account-business-model.md). Account-scoped
// reads over fieldops_wos (Work Order Engine v1.2). These are OPERATIONAL
// activity, never a financial figure -- see the Framework
// (docs/architecture/enterprise-business-metrics-framework.md, Section 3):
// Work Order counts are not sales/revenue and never share a label with a
// dollar metric.
//
// Two DISTINCT query shapes, never one shared query:
//   - counts: aggregate getCountFromServer() over customerId + status `in`
//     (composite index fieldops_wos(customerId ASC, status ASC)).
//   - timeline: bounded, createdAt-desc, cursor-paginated getDocs()
//     (composite index fieldops_wos(customerId ASC, createdAt DESC)).
// Both indexes are already deployed [READY]; this file only READS against
// them and never defines or changes an index.

// These two buckets partition the canonical 11-value WorkOrderStatus enum
// (the authority is functions/src/transitionEngine.ts, mirrored client-side
// in domain/workOrderWorkflow.js -- verified in sync 2026-08-05, W0). KEEP
// IN SYNC: if a WorkOrderStatus value is ever added/renamed there, update
// these buckets in the same change, or account counts silently drift.
// CANCELLED is deliberately in NEITHER bucket -- a cancelled Work Order is
// excluded from both Completed and Open counts, never folded into either.
export const COMPLETED_WORK_ORDER_STATUSES = ["COMPLETED", "CLOSED"];
export const OPEN_WORK_ORDER_STATUSES = [
  "CREATED",
  "READY_TO_DISPATCH",
  "SCHEDULED",
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
];

export const SERVICE_ACTIVITY_PAGE_SIZE = 10;

// Two SEPARATE, INDEPENDENT aggregate count() queries -- deliberately NOT
// combined via Promise.all, so a failure of one count never rejects (and
// thus never hides) the other. Each is fetched and error-handled on its own
// (see hooks/useAccountServiceActivity.js). Never derived by summing or
// recomputing the timeline's loaded pages. Both use the composite index
// fieldops_wos(customerId ASC, status ASC).
async function fetchAccountWorkOrderCountForStatuses(accountId, statuses) {
  const snap = await getCountFromServer(
    query(collection(db, WORK_ORDERS_COLLECTION), where("customerId", "==", accountId), where("status", "in", statuses))
  );
  return snap.data().count;
}

// Completed = COMPLETED/CLOSED.
export function fetchAccountCompletedWorkOrderCount(accountId) {
  return fetchAccountWorkOrderCountForStatuses(accountId, COMPLETED_WORK_ORDER_STATUSES);
}

// Open = the eight non-terminal, non-cancelled statuses.
export function fetchAccountOpenWorkOrderCount(accountId) {
  return fetchAccountWorkOrderCountForStatuses(accountId, OPEN_WORK_ORDER_STATUSES);
}

// One bounded page of the Account Activity timeline, newest-first. Cursor
// pagination via startAfter(<last DocumentSnapshot>) -- not an offset/
// page-number scheme. Returns the raw last DocumentSnapshot as `lastDoc`
// so the caller can pass it straight back as `afterDoc` for the next page
// (startAfter needs the snapshot, which also carries the createdAt cursor
// correctly for a Firestore Timestamp order-by). `hasMore` is true when a
// full page came back -- the next fetch decides definitively.
export async function fetchAccountWorkOrderTimelinePage(
  accountId,
  { pageSize = SERVICE_ACTIVITY_PAGE_SIZE, afterDoc = null } = {}
) {
  const base = collection(db, WORK_ORDERS_COLLECTION);
  const constraints = [where("customerId", "==", accountId), orderBy("createdAt", "desc")];
  if (afterDoc) constraints.push(startAfter(afterDoc));
  constraints.push(limit(pageSize));

  const snap = await getDocs(query(base, ...constraints));
  const items = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      woNumber: data.woNumber ?? null,
      status: data.status ?? null,
      createdAt: data.createdAt ?? null, // Firestore Timestamp | null
      // Account North Star P1: the approved Service activity composition states each job's
      // SCHEDULE and TECHNICIAN beside its status. Both are projected off the SAME documents this
      // query already fetched -- no second read, no new query shape, no new index, and no new
      // authority. Absent on a document means absent on the row: an unscheduled Work Order has no
      // scheduledStart at all (see workOrder.js's own gap note), and an unassigned one has no
      // assignedTechId. Neither is defaulted, and the display resolution of the technician id
      // belongs to the employee/technician entity, never to this projection.
      scheduledStart: data.scheduledStart ?? null, // Firestore Timestamp | number | null
      assignedTechId: data.assignedTechId ?? null, // fieldops_technicians doc id | null
    };
  });
  const lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return { items, lastDoc, hasMore: snap.docs.length === pageSize };
}

// Wave 7 extension, PART 1.6 -- Account Attention. A bounded, honest, account-scoped read of this
// account's SCHEDULED work orders, carrying exactly the fields domain/workOrderAttentionProjection.js's
// OWN workOrderPastDueItem() needs (id, status, scheduledStart) -- so PART 1.6 can COMPOSE that already-
// merged, authoritative PAST_DUE signal (PR #1014) instead of re-deriving past-due logic here. This is a
// SEPARATE query from fetchAccountWorkOrderTimelinePage (which is createdAt-ordered and omits
// scheduledStart entirely) -- reusing it would silently under-report past-due WOs sitting outside
// whatever page the timeline happened to load.
//
// customerId=="..." AND status=="SCHEDULED" is a pure-equality compound query, served by the SAME
// already-deployed fieldops_wos(customerId ASC, status ASC) composite index
// fetchAccountWorkOrderCountForStatuses uses above -- no new index required.
//
// `limit` is a defensive bound (an account's own SCHEDULED backlog is normally small); `hasMore` tells
// the caller when the result may be truncated, so a caller can degrade to an honest "unavailable" instead
// of confidently under-reporting past-due WOs it never saw -- mirrors accountArView.js's own "a truncated
// page is never labeled ready" rule.
export async function fetchAccountScheduledWorkOrdersForAttention(accountId, { limit: pageLimit = 200 } = {}) {
  const snap = await getDocs(
    query(
      collection(db, WORK_ORDERS_COLLECTION),
      where("customerId", "==", accountId),
      where("status", "==", "SCHEDULED"),
      limit(pageLimit)
    )
  );
  const items = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      woNumber: data.woNumber ?? null,
      status: data.status ?? null,
      scheduledStart: data.scheduledStart ?? null,
    };
  });
  return { items, hasMore: snap.docs.length === pageLimit };
}
