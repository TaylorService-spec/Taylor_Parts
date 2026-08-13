// Work Order Engine v1.2 -- client service layer.
//
// Writes go ONLY through the three Cloud Functions (createWorkOrder/
// transitionWorkOrder/updateWorkOrderExecutionData, the last added in
// Epic 6 Phase 6.3) -- firestore.rules denies all direct client
// writes to fieldops_wos/counters unconditionally. Reads bypass
// Functions entirely and go straight to Firestore (rules-enforced,
// role-scoped), mirroring firebase/collectionStore.js's existing read
// patterns for fieldops_jobs/fieldops_technicians.
import { httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, limit, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
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
  // site-work #2 -- optional client-supplied idempotency key (functions/src/createWorkOrder.ts's
  // CreateWorkOrderInput). A retry / double-submit carrying the SAME key replays the already-created
  // Work Order instead of minting a duplicate and burning a WO number. Stable-per-submission generation
  // lives in domain/workOrderWizard.js's createIdempotencyKeyHolder; this service only forwards it.
  idempotencyKey?: string;
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
export function subscribeToWorkOrders(
  onChange: (workOrders: WorkOrder[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  // The error channel is not optional in practice: this is an UNFILTERED
  // collection listener, and firestore.rules only lets a technician read Work
  // Orders assigned to them. Without it the denial was swallowed and the
  // surface span forever on "Loading work orders...".
  return onSnapshot(collection(db, WORK_ORDERS_COLLECTION), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
  }, (err) => { onError?.(err as Error); });
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
  // Bound the live listener: without this cap every historical assignment remains subscribed forever.
  // Ordering is deliberately not added here because it would require a new composite index; the cap is safe
  // with the existing Rules/index posture and the dashboard still applies its active/today view filtering.
  const assignedQuery = query(collection(db, WORK_ORDERS_COLLECTION), where("assignedTechId", "==", technicianId), limit(100));
  return onSnapshot(
    assignedQuery,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
    },
    (error) => onError?.(error)
  );
}

// Epic 6 Phase 6.3 -- Field Execution Capture. The ONLY write path for
// qtyUsed/executionLog/lastUpdated -- firestore.rules denies all
// direct client writes to fieldops_wos unconditionally, so this is a
// Cloud Function callable, same as createWorkOrder/transitionWorkOrder
// above, never a client-side Firestore write.
interface QtyUsedDelta {
  sku: string;
  delta: number;
}

interface UpdateWorkOrderExecutionDataInput {
  workOrderId: string;
  qtyUsedUpdates?: QtyUsedDelta[];
  executionNote?: string;
}

interface UpdateWorkOrderExecutionDataResult {
  success: true;
  workOrderId: string;
  updatedFields: string[];
}

const updateWorkOrderExecutionDataCallable = httpsCallable<
  UpdateWorkOrderExecutionDataInput,
  UpdateWorkOrderExecutionDataResult
>(functions, "updateWorkOrderExecutionData");

export async function updateWorkOrderExecutionData(
  workOrderId: string,
  updates: { qtyUsedUpdates?: QtyUsedDelta[]; executionNote?: string }
): Promise<UpdateWorkOrderExecutionDataResult> {
  const result = await updateWorkOrderExecutionDataCallable({ workOrderId, ...updates });
  return result.data;
}

// WO Parts Planning Phase 2 -- client binding for the governed PLANNED producer setWorkOrderPartsPlan.
// A business intent ("plan these parts for this Work Order"), NOT a generic snapshot update. Same callable
// pattern as the WO callables above; the server enforces the workOrder.parts.plan capability (fail-closed,
// active:false until a separate grant) and the PLAN != RESERVE != USE invariants. Not yet consumed by any UI
// (the planning experience is a later phase); the function is undeployed, so this fails closed today.
// The client sends canonical partId only; sku is resolved server-side from Part Master's internalPartNumber
// (never client-supplied, never fabricated as partId).
interface PartsPlanLineInput {
  partId: string;
  name?: string;
  qtyPlanned: number;
}

interface SetWorkOrderPartsPlanResult {
  success: true;
  workOrderId: string;
  plannedCount: number;
}

const setWorkOrderPartsPlanCallable = httpsCallable<
  { workOrderId: string; plan: PartsPlanLineInput[] },
  SetWorkOrderPartsPlanResult
>(functions, "setWorkOrderPartsPlan");

export async function setWorkOrderPartsPlan(
  workOrderId: string,
  plan: PartsPlanLineInput[]
): Promise<SetWorkOrderPartsPlanResult> {
  const result = await setWorkOrderPartsPlanCallable({ workOrderId, plan });
  return result.data;
}
