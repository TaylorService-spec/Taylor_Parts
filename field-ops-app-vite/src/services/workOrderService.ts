// Work Order Engine -- client service layer.
//
// Writes go ONLY through the Cloud Functions (createWorkOrder / transitionWorkOrder /
// updateWorkOrderExecutionData). READS NOW GO THE SAME WAY.
//
// ════════════════════ THE READS MOVED, AND WHY ════════════════════
//
// This file used to read fieldops_wos directly -- one getDoc and two onSnapshot subscriptions --
// with firestore.rules deciding who saw what from users/{uid}.role. That is the arrangement the
// governed access model exists to replace: Firebase authenticates, EOS authorizes. All three now
// go through the scoped Work Order seam, which resolves workOrder.read / workOrder.assigned.read
// server-side, derives the technician identity from request.auth.uid, and forces the assignment
// predicate in where it applies.
//
// The subscription API is UNCHANGED on purpose -- same callback, same unsubscribe -- so no
// consumer needed rewriting to stop talking to Firestore. What changed is underneath it, and it is
// a real behaviour change rather than parity: a governed callable cannot push, so a Firestore
// snapshot became an automatic refresh bounded at five seconds (access/governedAutoRefresh.js).
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import {
  WORK_ORDER_READ_RESULT,
  readAllScopedWorkOrders,
  readScopedWorkOrderById,
  readScopedWorkOrders,
} from "../access/scopedWorkOrderClient.js";
import { startGovernedRefresh } from "../access/governedAutoRefresh.js";
import type { WorkOrder, Priority, Severity, WorkOrderType, ActionName } from "../types/workOrder";

type Unsubscribe = () => void;

/**
 * Turn a seam refusal into the error the Firestore listener used to deliver.
 *
 * DENIED stays DENIED. The surfaces below distinguish a permission refusal from a failure and say
 * different things about them, and collapsing the two would tell a technician the system is broken
 * when it is in fact working exactly as configured.
 */
function readError(result: string): Error {
  return new Error(
    result === WORK_ORDER_READ_RESULT.DENIED
      ? "You do not have access to these work orders."
      : "Work orders could not be loaded.",
  );
}

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
  // H20 fix (dispatch reassignment): required only when Dispatch's assignedTechId differs from the Work
  // Order's current scheduledTechId. See functions/src/transitionWorkOrder.ts's TransitionWorkOrderInput.
  reassignReason?: string;
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

/**
 * One Work Order by id.
 *
 * THE THREE OUTCOMES STAY THREE. An authorized read of an existing record returns it; an
 * authorized read of an absent one returns null; a SCOPE REFUSAL THROWS. Knowing an id does not
 * bypass scope -- the server checks the stored assignedTechId against the technician identity it
 * derived -- and a refusal must not arrive as null, because null means the work order is not there,
 * which is a claim about the business rather than about permission.
 */
export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  const res = await readScopedWorkOrderById(id);
  if (!res.ok) throw readError(res.result);
  return (res.workOrder as WorkOrder | null) ?? null;
}

/**
 * Every Work Order this principal may see, refreshed automatically.
 *
 * THE POPULATION IS COMPLETE, not a page. This replaced an unfiltered collection listener feeding
 * the operations boards, which count and bucket what they are given; handing them one page would
 * turn every board total into a number about a page while still being labelled a total. The seam
 * is therefore paged to exhaustion, and a run that cannot finish reports a failure rather than a
 * short list.
 *
 * GLOBAL AUTHORITY IS REQUIRED and is not asserted here -- the server resolves it. A technician
 * reaching this path holds only workOrder.assigned.read, so the seam scopes them to their own
 * assignments rather than serving an unscoped board; nothing in this file could widen that.
 *
 * The error channel is not optional in practice: a swallowed refusal left this surface spinning on
 * "Loading work orders..." forever, which is how a permission decision became a hang.
 */
export function subscribeToWorkOrders(
  onChange: (workOrders: WorkOrder[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return startGovernedRefresh(
    async () => {
      const res = await readAllScopedWorkOrders({ mode: "all" });
      if (!res.ok) throw readError(res.result);
      return res.items as WorkOrder[];
    },
    onChange,
    (err: Error) => { onError?.(err); },
  );
}

/**
 * One technician's assignments, refreshed automatically.
 *
 * THE TECHNICIAN ID IS NOT AUTHORITY. It names WHOSE assignments are wanted -- a business input --
 * and the server checks it against the identity it derived from request.auth.uid: a principal
 * scoped to their own assignments may name only themselves and is REFUSED otherwise, and naming
 * somebody else is possible only for a principal who already holds the global work-order read.
 * The parameter survives because every caller has a technician id in hand, not because it decides
 * anything.
 *
 * BOUNDED AT 100, exactly as the listener it replaces was: without a cap every historical
 * assignment stayed subscribed forever, and a technician's phone is the device paying for it. The
 * dashboard applies its own active/today view filtering on top, unchanged.
 */
export function subscribeAssignedWorkOrders(
  technicianId: string,
  onChange: (workOrders: WorkOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return startGovernedRefresh(
    async () => {
      const res = await readScopedWorkOrders({ mode: "assigned", params: { technicianId }, pageSize: 100 });
      if (!res.ok) throw readError(res.result);
      return res.items as WorkOrder[];
    },
    onChange,
    (err: Error) => { onError?.(err); },
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
  updates: {
    qtyUsedUpdates?: QtyUsedDelta[];
    executionNote?: string;
    // Decision #171 -- the governed physical source per sku, for POSITIVE deltas only. A decrement is
    // a correction against the original lineage and deliberately carries none.
    consumptionSources?: { sku: string; locationId: string }[];
  }
): Promise<UpdateWorkOrderExecutionDataResult> {
  const result = await updateWorkOrderExecutionDataCallable({ workOrderId, ...updates });
  return result.data;
}

// Decision #171 -- the trusted, command-scoped source projection. Identities and labels only: no
// on-hand, no available, no reserved. It exists so a technician can name where a part came from
// WITHOUT being granted any standing read of warehouses, trucks or inventory.
export interface ConsumptionSourceOption {
  locationId: string;
  locationType: string;
  label: string;
  method: "PICK" | "EXPLICIT" | "SERIALIZED_CUSTODY";
}
export interface ConsumptionSourceOptions {
  autoSource: ConsumptionSourceOption | null;
  selectableSources: ConsumptionSourceOption[];
  serializedSource: ConsumptionSourceOption | null;
  sourceRequired: boolean;
  autoSourceUnavailableReason: string | null;
  mobileAmbiguous: boolean;
}
const listConsumptionSourcesCallable = httpsCallable<
  { workOrderId: string; partId: string; requestedQuantity?: number; trackingMode?: string; serialNo?: string },
  ConsumptionSourceOptions
>(functions, "listWorkOrderConsumptionSources");

export async function listWorkOrderConsumptionSources(input: {
  workOrderId: string;
  partId: string;
  requestedQuantity?: number;
  trackingMode?: string;
  serialNo?: string;
}): Promise<ConsumptionSourceOptions> {
  const result = await listConsumptionSourcesCallable(input);
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
