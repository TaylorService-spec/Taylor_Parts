// Work Order Engine v1.2 -- client WRITE service layer only.
//
// Writes go ONLY through the two Cloud Functions here (createWorkOrder/
// transitionWorkOrder) -- firestore.rules denies all direct client
// writes to fieldops_wos/counters unconditionally, and this is the
// ONLY file that imports httpsCallable/getFunctions for Work Orders.
// No page component may call either directly (see
// docs/architecture/UI_ACTION_PIPELINES.md).
//
// Reads live in services/workOrderQueries.ts, a separate file as of
// Pre-Phase 2's Read Architecture pass -- this file has no Firestore
// read of its own anymore (moved out, not duplicated).
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import type { Priority, Severity, WorkOrderType, ActionName } from "../types/workOrder";

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
