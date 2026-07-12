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

// Two INDEPENDENT aggregate count() queries. Never derived by summing or
// recomputing the timeline's loaded pages -- each is its own
// getCountFromServer over the composite index. Completed = COMPLETED/CLOSED;
// Open = the eight non-terminal, non-cancelled statuses above.
export async function fetchAccountWorkOrderCounts(accountId) {
  const base = collection(db, WORK_ORDERS_COLLECTION);
  const completedQuery = query(
    base,
    where("customerId", "==", accountId),
    where("status", "in", COMPLETED_WORK_ORDER_STATUSES)
  );
  const openQuery = query(
    base,
    where("customerId", "==", accountId),
    where("status", "in", OPEN_WORK_ORDER_STATUSES)
  );
  const [completedSnap, openSnap] = await Promise.all([
    getCountFromServer(completedQuery),
    getCountFromServer(openQuery),
  ]);
  return { completed: completedSnap.data().count, open: openSnap.data().count };
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
    };
  });
  const lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
  return { items, lastDoc, hasMore: snap.docs.length === pageSize };
}
