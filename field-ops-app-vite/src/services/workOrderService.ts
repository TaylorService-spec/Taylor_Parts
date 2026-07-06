// Work Order Engine v1.2 -- client service layer.
//
// Writes go ONLY through the two Cloud Functions (createWorkOrder/
// transitionWorkOrder) -- firestore.rules denies all direct client
// writes to fieldops_wos/counters unconditionally. Reads bypass
// Functions entirely and go straight to Firestore (rules-enforced,
// role-scoped), mirroring firebase/collectionStore.js's existing read
// patterns for fieldops_jobs/fieldops_technicians.
import { httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db, functions } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import type { WorkOrder, Priority, Severity, WorkOrderType, ActionName } from "../types/workOrder";

interface CreateWorkOrderInput {
  customerId: string;
  locationId: string;
  priority: Priority;
  severity?: Severity;
  type: WorkOrderType;
  complaint?: string;
}

interface CreateWorkOrderResult {
  id: string;
  woNumber: string;
}

const createWorkOrderCallable = httpsCallable<CreateWorkOrderInput, CreateWorkOrderResult>(
  functions,
  "createWorkOrder"
);

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<CreateWorkOrderResult> {
  const result = await createWorkOrderCallable(input);
  return result.data;
}

interface TransitionWorkOrderExtra {
  scheduledStart?: number;
  scheduledEnd?: number;
  scheduledTechId?: string;
  assignedTechId?: string;
}

interface TransitionWorkOrderResult {
  id: string;
  status: string;
}

const transitionWorkOrderCallable = httpsCallable<
  { workOrderId: string; action: ActionName } & TransitionWorkOrderExtra,
  TransitionWorkOrderResult
>(functions, "transitionWorkOrder");

export async function transitionWorkOrder(
  workOrderId: string,
  action: ActionName,
  extra: TransitionWorkOrderExtra = {}
): Promise<TransitionWorkOrderResult> {
  const result = await transitionWorkOrderCallable({ workOrderId, action, ...extra });
  return result.data;
}

export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  const snap = await getDoc(doc(db, WORK_ORDERS_COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkOrder) : null;
}

// Unfiltered listener -- matches how fieldops_jobs/fieldops_technicians
// are read today (useFirestoreCollection). A technician-scoped,
// status-filtered query is a Phase 2 concern (would need a composite
// index, see firestore.indexes.json's commit note) -- not implemented
// here since this pass only wires the admin/dispatcher-facing Control
// Tower view.
export function subscribeToWorkOrders(onChange: (workOrders: WorkOrder[]) => void): Unsubscribe {
  return onSnapshot(collection(db, WORK_ORDERS_COLLECTION), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
  });
}

// PT-002 -- Assigned Work Order Query Layer. A separate, additional
// listener (not a modification of subscribeToWorkOrders() above,
// which dispatcher/admin callers keep using unchanged): queries only
// the signed-in technician's own Work Orders via a where() clause on
// assignedTechId, matching firestore.rules' fieldops_wos rule
// (`isTechnician() && isOwnTechnician(resource.data.assignedTechId)`).
//
// Real, unresolved uncertainty, not glossed over: firestore.rules'
// isOwnTechnician() check depends on a get()-based lookup
// (userData().technicianId), not a value directly comparable to
// request.auth.uid. Whether Firestore's rule engine can actually prove
// this where("assignedTechId", "==", technicianId) query satisfies
// that rule for every possible result (a requirement for LIST queries
// specifically, distinct from single-document get() reads) has NOT
// been empirically verified against the live rules or the emulator --
// this repo has no test credentials available to do so in this
// session (see docs/epics/EPIC-6-Technician-Execution-Workspace.md's
// Section 8 for the same caveat). Verify this actually returns data
// (not a permission-denied query rejection) with a real
// technician-role account before relying on it.
export function subscribeAssignedWorkOrders(
  technicianId: string,
  onChange: (workOrders: WorkOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const assignedQuery = query(collection(db, WORK_ORDERS_COLLECTION), where("assignedTechId", "==", technicianId));
  return onSnapshot(
    assignedQuery,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
    },
    (error) => onError?.(error)
  );
}
