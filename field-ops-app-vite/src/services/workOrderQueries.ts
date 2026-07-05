// Work Order Engine v1.2 -- Pre-Phase 2 Read Architecture.
//
// The dedicated Work Order query layer: every Firestore READ for Work
// Orders lives here, and only here. Writes are a separate concern and
// stay in services/workOrderService.ts (createWorkOrder/
// transitionWorkOrder, the only file that imports httpsCallable for
// Work Orders) -- this file never imports httpsCallable/getFunctions
// and has no write path of its own. See
// docs/architecture/UI_ACTION_PIPELINES.md for how this fits Pipeline 2
// overall: reads bypass Cloud Functions entirely and go straight to
// Firestore (rules-enforced, role-scoped), same as it's always been --
// this file just gives that read path its own home instead of sharing
// a file with the write path.
import { collection, doc, getDoc, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import type { WorkOrder, WorkOrderStatus } from "../types/workOrder";

export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  const snap = await getDoc(doc(db, WORK_ORDERS_COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkOrder) : null;
}

// Live single-doc subscription -- what useWorkOrder(id) wraps. Distinct
// from getWorkOrder() above (a one-time read, kept for call sites that
// genuinely want a snapshot-in-time, e.g. a future confirmation step).
export function subscribeToWorkOrder(
  id: string,
  onChange: (workOrder: WorkOrder | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, WORK_ORDERS_COLLECTION, id), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkOrder) : null);
  });
}

// Unfiltered listener -- matches how fieldops_jobs/fieldops_technicians
// are read today (useFirestoreCollection). What useWorkOrders() wraps,
// and what ControlTower.jsx has used since Epic 1 -- moved here
// unchanged, no behavior change.
export function subscribeToWorkOrders(onChange: (workOrders: WorkOrder[]) => void): Unsubscribe {
  return onSnapshot(collection(db, WORK_ORDERS_COLLECTION), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
  });
}

// Statuses where the NEXT action belongs to a dispatcher (per
// transitionEngine.ts's ACTION_PERMISSIONS: MarkReady/Schedule/Dispatch
// are all admin/dispatcher-only), i.e. "needs a dispatcher to do
// something before a technician can move it forward." This is a
// first-pass definition for Pre-Phase 2 -- the actual Dispatcher Queue
// UI (Phase 2) may refine it further; this hook exists so that UI has
// a query to build on rather than inventing its own Firestore access.
const DISPATCHER_QUEUE_STATUSES: WorkOrderStatus[] = ["CREATED", "READY_TO_DISPATCH", "SCHEDULED"];

// Single-field `where("status", "in", [...])` -- no composite index
// needed (Firestore only requires one for multi-field queries or a
// filter combined with an orderBy on a different field, neither of
// which this does).
export function subscribeToDispatcherQueue(onChange: (workOrders: WorkOrder[]) => void): Unsubscribe {
  const q = query(collection(db, WORK_ORDERS_COLLECTION), where("status", "in", DISPATCHER_QUEUE_STATUSES));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
  });
}
