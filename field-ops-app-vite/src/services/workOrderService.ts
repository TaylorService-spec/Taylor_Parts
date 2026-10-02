// Work Order client service layer -- the GOVERNED EOS route only.
//
// Every read and every write goes through services/workOrderApiClient.js
// (POST {VITE_EOS_API_BASE_URL}/operations/work-orders). Nothing here imports Firebase: there is no
// Firestore `fieldops_wos` read and no Work Order Firebase callable (createWorkOrder /
// transitionWorkOrder / updateWorkOrderExecutionData / setWorkOrderPartsPlan /
// listWorkOrderConsumptionSources) left in the browser, and nothing falls back to one.
//
// The export names callers already used are kept so screen churn is minimal. Where the legacy shape and
// the governed shape differ, domain/workOrderAdapter.js converts -- in particular assignedTechId /
// scheduledTechId now carry an EOS EMPLOYEE id, not a fieldops_technicians id.
//
// Failures THROW a WorkOrderApiError (the screens' existing try/catch contract). `code` is the client
// category (NOT_ACTIVATED, FORBIDDEN, PRECONDITION_FAILED, ...) and `reason` the server's specific code
// (START_IN_PAST, SCHEDULE_CONFLICT, NOT_ASSIGNED, ...). While the authority is not activated every call
// throws code NOT_ACTIVATED, which the safe-copy helpers render as NOT_YET_ACTIVATED.
import { callWorkOrderApi, WORK_ORDER_LIST_MAX } from "./workOrderApiClient.js";
import { adaptWorkOrder, adaptWorkOrders, adaptWorkOrderTechnicians } from "../domain/workOrderAdapter.js";
import type { WorkOrder, Priority, Severity, WorkOrderType, ActionName, WorkOrderStatus } from "../types/workOrder";

export type Unsubscribe = () => void;

type ApiResult =
  | { ok: true; operation: string; result: unknown }
  | { ok: false; code: string; message: string; reason: string | null; status: number | null };

/** The injectable transport (tests pass a fake; production uses the governed client). */
export type WorkOrderCall = (operation: string, input?: Record<string, unknown>) => Promise<ApiResult>;

const defaultCall: WorkOrderCall = (operation, input) => callWorkOrderApi(operation, input) as Promise<ApiResult>;
let activeCall: WorkOrderCall = defaultCall;

/** Test seam only: route this service through an injected transport. Pass null to restore. */
export function __setWorkOrderTransportForTests(call: WorkOrderCall | null): void {
  activeCall = call ?? defaultCall;
}

export class WorkOrderApiError extends Error {
  code: string;
  reason: string | null;
  status: number | null;
  operation: string;
  constructor(operation: string, failure: { code: string; message: string; reason: string | null; status: number | null }) {
    super(failure.message);
    this.name = "WorkOrderApiError";
    this.operation = operation;
    this.code = failure.code;
    this.reason = failure.reason;
    this.status = failure.status;
  }
}

export const isWorkOrderNotActivated = (err: unknown): boolean =>
  !!err && typeof err === "object" && (err as { code?: unknown }).code === "NOT_ACTIVATED";

// ── a successful WRITE tells every refresh loop to reload now, instead of waiting out its interval ──
// (the former onSnapshot listeners saw a write immediately; a 30s-late screen after the user's own action
// would read as a failed action).
const mutationListeners = new Set<(workOrderId: string | null) => void>();

export function onWorkOrderMutation(listener: (workOrderId: string | null) => void): Unsubscribe {
  mutationListeners.add(listener);
  return () => { mutationListeners.delete(listener); };
}

const READ_OPERATIONS = new Set(["readWorkOrder", "listWorkOrders", "listMyAssignedWorkOrders", "listWorkOrderTechnicians",
  "listWorkOrderOperatingCompanies", "readWorkOrderAuthorityStatus", "readTechnicianAvailability", "findAvailableTechnicianSlots",
  "readTechnicianExecutionStats", "readWorkOrderConsumptionSnapshot", "readTechnicianVolumeBreakdown"]);

async function run<T = unknown>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  const res = await activeCall(operation, input);
  if (!res.ok) throw new WorkOrderApiError(operation, res);
  if (!READ_OPERATIONS.has(operation)) {
    const id = typeof input.workOrderId === "string" ? input.workOrderId : null;
    for (const l of [...mutationListeners]) {
      try { l(id); } catch { /* a listener's failure is its own */ }
    }
  }
  return res.result as T;
}

const refuseLocally = (operation: string, reason: string, message: string): never => {
  throw new WorkOrderApiError(operation, { code: "INVALID_INPUT", reason, message, status: null });
};

// ───────────────────────────────────────── create ─────────────────────────────────────────

export interface CreateWorkOrderInput {
  // The governed operating company the Work Order belongs to. REQUIRED and never inferred: the server
  // refuses OPERATING_COMPANY_REQUIRED without it, and so does this service, before any request.
  operatingCompanyId?: string | null;
  customerId: string;
  locationId: string;
  priority: Priority;
  severity?: Severity;
  type: WorkOrderType;
  complaint?: string;
  equipmentId?: string;
  salesOrderId?: string;
  // Stable per submission: the same key + the same request replays the SAME Work Order (replayed: true,
  // no duplicate, no number burned); the same key + a different request is refused IDEMPOTENCY_KEY_REUSED.
  idempotencyKey?: string;
}

export interface CreateWorkOrderResult {
  id: string;
  woNumber: string;
  replayed: boolean;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<CreateWorkOrderResult> {
  const companyId = typeof input.operatingCompanyId === "string" ? input.operatingCompanyId.trim() : "";
  if (!companyId) {
    refuseLocally("createWorkOrder", "OPERATING_COMPANY_REQUIRED",
      "A Work Order must name its governed operating company; none was chosen, and none is inferred.");
  }
  if (!input.type) {
    refuseLocally("createWorkOrder", "WORK_ORDER_TYPE_INVALID", "A Work Order type is required.");
  }
  const body: Record<string, unknown> = {
    operatingCompanyId: companyId,
    customerId: input.customerId,
    locationId: input.locationId,
    workOrderType: input.type,
    priority: input.priority,
  };
  if (input.severity) body.severity = input.severity;
  if (input.complaint) body.complaint = input.complaint;
  if (input.equipmentId) body.equipmentId = input.equipmentId;
  if (input.salesOrderId) body.salesOrderId = input.salesOrderId;
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()) {
    const key = input.idempotencyKey.trim();
    if (key.length > 150) refuseLocally("createWorkOrder", "IDEMPOTENCY_KEY_INVALID", "the idempotency key is longer than 150 characters");
    body.idempotencyKey = key;
  }
  const result = await run<{ workOrderId: string; workOrderNumber: string; replayed?: boolean }>("createWorkOrder", body);
  return { id: result.workOrderId, woNumber: result.workOrderNumber, replayed: result.replayed === true };
}

// ─────────────────────────────────────── transitions ───────────────────────────────────────

export interface TransitionWorkOrderExtra {
  // Epoch ms or ISO-8601 with a zone.
  scheduledStart?: number | string;
  scheduledEnd?: number | string;
  // EMPLOYEE id (the governed technician roster's id). Schedule: the assignee.
  scheduledTechId?: string;
  // EMPLOYEE id. Dispatch: re-points the assignee (reassignReason then required by the server).
  assignedTechId?: string;
  reassignReason?: string;
  // Schedule: required only when re-pointing an existing assignee.
  reason?: string;
  // Unschedule: required.
  unscheduleReason?: string;
  // Cancel: the status the caller SAW -- the server refuses a stale cancel.
  expectedStatus?: WorkOrderStatus;
  note?: string;
}

// Mirrors the server's placement warning ({ code, message }); `detail` is kept for the legacy readers.
export interface SchedulingWarning {
  code: string;
  message: string;
  detail: string;
}

export interface TransitionWorkOrderResult {
  id: string;
  status: string;
  warnings?: SchedulingWarning[];
  /**
   * The inventory boundary the edge states, when it has one (RESERVE_NOT_APPLIED on dispatch, CONSUME_NOT_APPLIED
   * on complete, RELEASE_NOT_APPLIED on cancel) -- a success that moved no stock says so; domain/workOrderOutcome.js
   * turns it into a sentence. Null when the edge has none.
   */
  inventoryBoundary: string | null;
}

const EDGE_OPERATION: Record<string, string> = Object.freeze({
  MarkReady: "markWorkOrderReady",
  Accept: "acceptWorkOrder",
  Travel: "startWorkOrderTravel",
  Arrive: "arriveAtWorkOrder",
  WorkStart: "startWorkOrderWork",
  Complete: "completeWorkOrder",
  Close: "closeWorkOrder",
});

/** Which governed operation carries each legacy action. Exported for tests. */
export const OPERATION_BY_ACTION: Readonly<Record<ActionName, string>> = Object.freeze({
  ...EDGE_OPERATION,
  Schedule: "scheduleWorkOrder",
  Unschedule: "unscheduleWorkOrder",
  Dispatch: "dispatchWorkOrder",
  Cancel: "cancelWorkOrder",
} as Record<ActionName, string>);

const withNote = (input: Record<string, unknown>, note?: string) =>
  (typeof note === "string" && note.trim() ? { ...input, note: note.trim() } : input);

/** The governed request for one legacy action. Pure; exported for tests. Throws on a missing required field. */
export function buildTransitionRequest(
  workOrderId: string,
  action: ActionName,
  extra: TransitionWorkOrderExtra = {},
): { operation: string; input: Record<string, unknown> } {
  const operation = OPERATION_BY_ACTION[action];
  if (!operation) refuseLocally("transitionWorkOrder", "UNKNOWN_ACTION", `"${String(action)}" is not a Work Order action`);
  switch (action) {
    case "Schedule": {
      const input: Record<string, unknown> = {
        workOrderId,
        employeeId: extra.scheduledTechId,
        scheduledStart: extra.scheduledStart,
        scheduledEnd: extra.scheduledEnd,
      };
      if (extra.reason) input.reason = extra.reason;
      return { operation, input: withNote(input, extra.note) };
    }
    case "Unschedule":
      return { operation, input: { workOrderId, reason: extra.unscheduleReason ?? extra.reason } };
    case "Dispatch": {
      const input: Record<string, unknown> = { workOrderId };
      if (extra.assignedTechId) input.employeeId = extra.assignedTechId;
      if (extra.reassignReason) input.reassignReason = extra.reassignReason;
      return { operation, input: withNote(input, extra.note) };
    }
    case "Cancel":
      if (!extra.expectedStatus) {
        refuseLocally("cancelWorkOrder", "EXPECTED_STATUS_REQUIRED", "state the status the Work Order is being cancelled from");
      }
      return { operation, input: withNote({ workOrderId, expectedStatus: extra.expectedStatus }, extra.note) };
    default:
      return { operation, input: withNote({ workOrderId }, extra.note) };
  }
}

const adaptWarnings = (warnings: unknown): SchedulingWarning[] =>
  (Array.isArray(warnings) ? warnings : [])
    .filter((w) => w && typeof w.code === "string")
    .map((w) => ({ code: w.code, message: String(w.message ?? ""), detail: String(w.message ?? "") }));

export async function transitionWorkOrder(
  workOrderId: string,
  action: ActionName,
  extra: TransitionWorkOrderExtra = {},
): Promise<TransitionWorkOrderResult> {
  const { operation, input } = buildTransitionRequest(workOrderId, action, extra);
  const result = await run<Record<string, unknown>>(operation, input);
  const transition = (result?.transition ?? result) as { toStatus?: string; inventoryBoundary?: unknown } | undefined;
  const boundary = result?.inventoryBoundary ?? transition?.inventoryBoundary;
  return {
    id: workOrderId,
    status: String(transition?.toStatus ?? ""),
    warnings: adaptWarnings(result?.warnings),
    inventoryBoundary: typeof boundary === "string" && boundary !== "" ? boundary : null,
  };
}

/**
 * Re-time (and optionally re-point) a SCHEDULED Work Order. `expectedScheduledStart` is the start the
 * caller SAW; the server refuses STALE_SCHEDULE when it moved in between. `employeeId` is an EMPLOYEE id.
 */
export async function rescheduleWorkOrder(input: {
  workOrderId: string;
  expectedScheduledStart: number | string;
  scheduledStart: number | string;
  scheduledEnd: number | string;
  employeeId?: string;
  reason: string;
}): Promise<{ workOrderId: string; scheduledStart: string; scheduledEnd: string; warnings: SchedulingWarning[] }> {
  const body: Record<string, unknown> = {
    workOrderId: input.workOrderId,
    expectedScheduledStart: typeof input.expectedScheduledStart === "number"
      ? new Date(input.expectedScheduledStart).toISOString() : input.expectedScheduledStart,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    reason: input.reason,
  };
  if (input.employeeId) body.employeeId = input.employeeId;
  const result = await run<{ workOrderId: string; scheduledStart: string; scheduledEnd: string; warnings?: unknown }>(
    "rescheduleWorkOrder", body);
  return { workOrderId: result.workOrderId, scheduledStart: result.scheduledStart, scheduledEnd: result.scheduledEnd,
    warnings: adaptWarnings(result.warnings) };
}

// ───────────────────────────────────────── reads ─────────────────────────────────────────

/** One Work Order's DETAIL (execution parts, notes, transitions), or null when it does not exist. */
export async function getWorkOrder(id: string): Promise<WorkOrder | null> {
  try {
    const detail = await run("readWorkOrder", { workOrderId: id });
    return adaptWorkOrder(detail) as WorkOrder | null;
  } catch (err) {
    if (err instanceof WorkOrderApiError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

export interface ListWorkOrdersFilters {
  statuses?: WorkOrderStatus[];
  scheduledFrom?: string;
  scheduledTo?: string;
  assigneeEmployeeId?: string;
  customerId?: string;
  equipmentId?: string;
  plannedPartId?: string;
  search?: string;
  limit?: number;
}

/** The office list. Bounded (<= 200); `truncated` says when there were more -- never a silent partial. */
export async function listWorkOrders(filters: ListWorkOrdersFilters = {}): Promise<{ items: WorkOrder[]; truncated: boolean }> {
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== "") input[k] = v;
  if (typeof input.limit === "number") input.limit = Math.min(Math.max(1, Math.floor(input.limit as number)), WORK_ORDER_LIST_MAX);
  const result = await run<{ items: unknown[]; truncated: boolean }>("listWorkOrders", input);
  return { items: adaptWorkOrders(result?.items) as WorkOrder[], truncated: result?.truncated === true };
}

/**
 * The signed-in person's OWN Work Orders. The server resolves the Employee; `employeeId` null means the
 * login is not linked to an Employee (a real answer, not an error).
 */
export const MY_WORK_DETAIL_MAX = 25;

export async function listMyAssignedWorkOrders(
  options: { includeCompleted?: boolean; withDetail?: boolean } = {},
): Promise<{ employeeId: string | null; items: WorkOrder[] }> {
  const input = options.includeCompleted === true ? { includeCompleted: true } : {};
  const result = await run<{ employeeId: string | null; items: unknown[] }>("listMyAssignedWorkOrders", input);
  let items = adaptWorkOrders(result?.items) as WorkOrder[];
  // The list SUMMARY carries no planned/used parts, notes or lifecycle timestamps; the technician
  // surfaces (execution capture, scanner candidates, the current job) need them. `withDetail` reads each
  // row's governed DETAIL (bounded: the first MY_WORK_DETAIL_MAX rows) -- the same per-record decision.
  if (options.withDetail === true && items.length > 0) {
    const head = items.slice(0, MY_WORK_DETAIL_MAX);
    const details = await Promise.all(head.map((wo) => getWorkOrder(wo.id)));
    items = [...head.map((wo, i) => details[i] ?? wo), ...items.slice(MY_WORK_DETAIL_MAX)];
  }
  return { employeeId: result?.employeeId ?? null, items };
}

export interface WorkOrderOperatingCompany {
  operatingCompanyId: string;
  operatingCompanyKey: string;
}

/**
 * The operating companies a Work Order may be created for: the tenant's ACTIVE companies with an ACTIVE
 * key binding, as the server governs them. A list of one is still a stated choice, never an inference.
 */
export async function listWorkOrderOperatingCompanies(): Promise<WorkOrderOperatingCompany[]> {
  const result = await run<{ items: unknown[] }>("listWorkOrderOperatingCompanies", {});
  return (Array.isArray(result?.items) ? result.items : [])
    .filter((c): c is WorkOrderOperatingCompany => !!c && typeof (c as WorkOrderOperatingCompany).operatingCompanyId === "string"
      && (c as WorkOrderOperatingCompany).operatingCompanyId !== "")
    .map((c) => ({ operatingCompanyId: c.operatingCompanyId, operatingCompanyKey: String(c.operatingCompanyKey ?? "") }));
}

export interface WorkOrderTechnician {
  id: string;
  employeeId: string;
  name: string;
  displayName: string | null;
  employeeNumber: string | null;
  employmentStatus: string | null;
  operatingCompanyId: string | null;
  jobTitle: string | null;
}

/**
 * The Employees who may be scheduled / dispatched. With a workOrderId: the picker for THAT job (its
 * operating company only). Without: the board's roster, each row carrying its operatingCompanyId.
 */
export async function listWorkOrderTechnicians(workOrderId?: string | null): Promise<{
  workOrderId: string | null; operatingCompanyId: string | null; items: WorkOrderTechnician[];
}> {
  const result = await run<{ workOrderId: string | null; operatingCompanyId: string | null; items: unknown[] }>(
    "listWorkOrderTechnicians", workOrderId ? { workOrderId } : {});
  return {
    workOrderId: result?.workOrderId ?? null,
    operatingCompanyId: result?.operatingCompanyId ?? null,
    items: adaptWorkOrderTechnicians(result?.items) as WorkOrderTechnician[],
  };
}

// ─────────────────────────────── refresh loops (no live listener) ───────────────────────────────
//
// The governed route has no push channel, so the former onSnapshot listeners become a BOUNDED refresh:
// one immediate load, then one every WORK_ORDER_REFRESH_MS, until unsubscribe. The (onChange, onError)
// + unsubscribe contract is unchanged. A failed refresh reports through onError and the loop keeps its
// cadence; a NOT_ACTIVATED answer stops the loop (it will not change until an activation, and polling a
// refusal is noise).
export const WORK_ORDER_REFRESH_MS = 30_000;

function refreshLoop<T>(
  load: () => Promise<T>,
  onChange: (value: T) => void,
  onError: ((err: Error) => void) | undefined,
  intervalMs: number,
): Unsubscribe {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const stop = () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const value = await load();
      if (!stopped) onChange(value);
    } catch (err) {
      if (!stopped) {
        if (isWorkOrderNotActivated(err)) stop();
        onError?.(err as Error);
      }
    } finally {
      inFlight = false;
    }
  };
  void tick();
  if (intervalMs > 0) timer = setInterval(() => { void tick(); }, intervalMs);
  const offMutation = onWorkOrderMutation(() => { void tick(); });
  return () => {
    offMutation();
    stop();
  };
}

/**
 * The office Work Order list, refreshed. `filters` default to the bounded list (the server's default
 * page); callers that need a window or status set pass it.
 */
export function subscribeToWorkOrders(
  onChange: (workOrders: WorkOrder[]) => void,
  onError?: (err: Error) => void,
  options: { filters?: ListWorkOrdersFilters; intervalMs?: number; onTruncated?: (truncated: boolean) => void } = {},
): Unsubscribe {
  return refreshLoop(
    () => listWorkOrders({ limit: WORK_ORDER_LIST_MAX, ...(options.filters ?? {}) }),
    (res) => {
      options.onTruncated?.(res.truncated);
      onChange(res.items);
    },
    onError,
    options.intervalMs ?? WORK_ORDER_REFRESH_MS,
  );
}

/**
 * The signed-in person's own Work Orders, refreshed. No technician id is taken: the SERVER resolves
 * whose work it is (listMyAssignedWorkOrders), and the browser never compares identities.
 */
export function subscribeAssignedWorkOrders(
  onChange: (workOrders: WorkOrder[], meta: { employeeId: string | null }) => void,
  onError?: (error: Error) => void,
  options: { includeCompleted?: boolean; withDetail?: boolean; intervalMs?: number } = {},
): Unsubscribe {
  return refreshLoop(
    () => listMyAssignedWorkOrders({ includeCompleted: options.includeCompleted, withDetail: options.withDetail }),
    (res) => onChange(res.items, { employeeId: res.employeeId }),
    onError,
    options.intervalMs ?? WORK_ORDER_REFRESH_MS,
  );
}

// ─────────────────────────────────────── execution ───────────────────────────────────────

interface QtyUsedDelta {
  // The Part: the governed execution record keys usage by partId (the adapter puts partId in `sku`).
  sku: string;
  delta: number;
}

export interface UpdateWorkOrderExecutionDataResult {
  success: true;
  workOrderId: string;
  outcome: string;
  // NO_STOCK_MOVEMENT unless the usage was recorded FROM the technician's truck (consumeFrom), in which case it is
  // TRUCK_CONSUMPTION: the governed route posted WORK_ORDER_CONSUMPTION at that truck in the same transaction (OD-T4).
  inventoryBoundary: string;
}

export function makeExecutionIdempotencyKey(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `woexec_${c.randomUUID()}`;
  return `woexec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Record actual Part usage deltas and/or an execution note (recordWorkOrderExecution). Each call carries
 * an idempotency key -- pass one to make a retry replay rather than double-count.
 */
export async function updateWorkOrderExecutionData(
  workOrderId: string,
  updates: {
    qtyUsedUpdates?: QtyUsedDelta[]; executionNote?: string; idempotencyKey?: string;
    /** OD-T4 (2026-10-01): the technician's truck the parts came out of -- the usage then consumes truck stock, atomically. */
    consumeFrom?: { type: "MOBILE"; locationId: string } | null;
  },
): Promise<UpdateWorkOrderExecutionDataResult> {
  const input: Record<string, unknown> = {
    workOrderId,
    idempotencyKey: updates.idempotencyKey || makeExecutionIdempotencyKey(),
  };
  const usage = (updates.qtyUsedUpdates ?? []).filter((u) => u && typeof u.sku === "string" && u.sku !== "");
  if (usage.length > 0) input.partUsage = usage.map((u) => ({ partId: u.sku, qtyDelta: u.delta }));
  if (typeof updates.executionNote === "string" && updates.executionNote.trim()) input.note = updates.executionNote.trim();
  if (updates.consumeFrom && typeof updates.consumeFrom.locationId === "string" && usage.length > 0) {
    input.consumeFrom = { type: "MOBILE", locationId: updates.consumeFrom.locationId };
  }
  const result = await run<{ outcome: string; inventoryBoundary: string }>("recordWorkOrderExecution", input);
  return { success: true, workOrderId, outcome: result?.outcome ?? "RECORDED", inventoryBoundary: result?.inventoryBoundary ?? "NO_STOCK_MOVEMENT" };
}

// ─────────────────────────────────────── parts plan ───────────────────────────────────────

interface PartsPlanLineInput {
  partId: string;
  name?: string;
  qtyPlanned: number;
}

export interface SetWorkOrderPartsPlanResult {
  success: true;
  workOrderId: string;
  plannedCount: number;
}

/** Replace the Work Order's planned Parts (PLAN != RESERVE != USE). Only partId + qtyPlanned travel. */
export async function setWorkOrderPartsPlan(workOrderId: string, plan: PartsPlanLineInput[]): Promise<SetWorkOrderPartsPlanResult> {
  const lines = (plan ?? []).map((l) => ({ partId: l.partId, qtyPlanned: l.qtyPlanned }));
  const result = await run<{ plan?: unknown[] }>("setWorkOrderPartsPlan", { workOrderId, plan: lines });
  return { success: true, workOrderId, plannedCount: Array.isArray(result?.plan) ? result.plan.length : lines.length };
}

// ─────────────────────────────── planning estimate (ND-21) ───────────────────────────────

/**
 * Set (or clear with null) a Work Order's planning estimate in whole minutes (setWorkOrderEstimatedDuration,
 * workOrder.lifecycle.schedule). A terminal Work Order refuses WORK_ORDER_TERMINAL.
 */
export async function setWorkOrderEstimatedDuration(
  workOrderId: string, estimatedDurationMinutes: number | null,
): Promise<{ workOrderId: string; estimatedDurationMinutes: number | null }> {
  return run("setWorkOrderEstimatedDuration", { workOrderId, estimatedDurationMinutes });
}

// ─────────────────────────────── technician availability (DECISION 5) ───────────────────────────────
//
// The governed PostgreSQL availability authority, keyed by EMPLOYEE id (functions/src/eosOps/workOrderAvailability.ts).
// Working hours and unavailability are configured and read ONLY here -- there is no Firebase technician-availability
// callable left in the browser. A placement outside configured hours now REFUSES (AVAILABILITY_NOT_CONFIGURED /
// OUTSIDE_WORKING_HOURS / TECHNICIAN_UNAVAILABLE), superseding the Firebase ND-20 warnings.

export interface WeeklyHours { [weekday: string]: { start: string; end: string }[] }

export interface TechnicianAvailabilityView {
  employeeId: string;
  displayName: string | null;
  operatingCompanyId: string;
  availabilityState: "CONFIGURED" | "NOT_CONFIGURED";
  workingAvailability: { scheduleId: string; timeZone: string; weeklyHours: WeeklyHours; effectiveFrom: string;
    effectiveTo: string | null; operatingCompanyId: string | null } | null;
  workingIntervals: { startMillis: number; endMillis: number }[];
  notConfiguredIntervals: { startMillis: number; endMillis: number }[];
  blockedTime: { unavailabilityId: string; kind: string; startMillis: number; endMillis: number; ended: boolean; reason: string | null }[];
  availableMinutes: number | null;
}

/** Working hours + unavailability for a range (at most 31 days). Omit employeeIds for every schedulable technician. */
export async function readTechnicianAvailability(input: {
  start: number | string; end: number | string; employeeIds?: string[]; operatingCompanyId?: string;
}): Promise<{ startMillis: number; endMillis: number; technicians: TechnicianAvailabilityView[]; notFoundEmployeeIds: string[] }> {
  const body: Record<string, unknown> = { start: input.start, end: input.end };
  if (Array.isArray(input.employeeIds)) body.employeeIds = input.employeeIds;
  if (input.operatingCompanyId) body.operatingCompanyId = input.operatingCompanyId;
  return run("readTechnicianAvailability", body);
}

export async function setTechnicianWorkingHours(input: {
  employeeId: string; timeZone: string; weeklyHours: WeeklyHours | null; effectiveFrom?: string;
  operatingCompanyId?: string | null; reason?: string;
}): Promise<unknown> {
  return run("setTechnicianWorkingHours", { ...input });
}

export async function recordTechnicianUnavailability(input: {
  employeeId: string; kind: string; start: number | string; end: number | string; reason?: string;
}): Promise<{ unavailabilityId: string; overlappingWorkOrderIds: string[]; warnings: SchedulingWarning[] }> {
  return run("recordTechnicianUnavailability", { ...input });
}

export async function endTechnicianUnavailability(input: {
  unavailabilityId: string; reason: string; endAt?: number | string;
}): Promise<{ unavailabilityId: string; endedAt: string; withdrawn: boolean }> {
  return run("endTechnicianUnavailability", { ...input });
}

/** The self-scheduling FOUNDATION query (office use): candidate { employeeId, start, end } slots. */
export async function findAvailableTechnicianSlots(input: {
  operatingCompanyId: string; durationMinutes: number; earliestDate: string; timeZone: string; horizonDays?: number;
  workOrderType?: WorkOrderType; employeeIds?: string[]; slotIncrementMinutes?: number; limit?: number;
}): Promise<{ slots: { employeeId: string; displayName: string | null; start: string; end: string }[]; truncated: boolean;
  notConfiguredEmployeeIds: string[] }> {
  return run("findAvailableTechnicianSlots", { ...input });
}

// ─────────────────────────────────────── operational aggregates ───────────────────────────────────────
//
// The governed PostgreSQL aggregates over the ACTIVE Work Order set (functions/src/eosOps/workOrderAnalytics.ts).
// Technicians are EMPLOYEES; consumption is RECORDED EXECUTION ACTUALS, not stock movement.

export interface GovernedTechnicianExecutionStats {
  employeeId: string;
  displayName: string | null;
  totalWorkOrdersCompleted: number;
  totalPartsConsumed: number;
  averageCompletionTimeMs: number | null;
  completionEvidence: { valid: number; inverted: number; missing: number };
  workOrderVolumeByStatus: Record<string, number>;
}

/** One Employee's execution figures. No employeeId: the caller's OWN, through their Employee link. */
export async function readTechnicianExecutionStats(employeeId?: string | null): Promise<GovernedTechnicianExecutionStats> {
  return run<GovernedTechnicianExecutionStats>("readTechnicianExecutionStats", employeeId ? { employeeId } : {});
}

export interface GovernedConsumptionSnapshot {
  parts: { partId: string; totalQuantityUsed: number; frequency: number }[];
  mostConsumedPartId: string | null;
  basis: string;
}

/** Recorded actuals per Part across the active set, most-consumed first (office: workOrder.record.read). */
export async function readWorkOrderConsumptionSnapshot(): Promise<GovernedConsumptionSnapshot> {
  return run<GovernedConsumptionSnapshot>("readWorkOrderConsumptionSnapshot", {});
}

export interface GovernedTechnicianVolume {
  employeeId: string;
  displayName: string | null;
  activeCount: number;
  completedCount: number;
}

/** Completed vs not-completed Work Orders per assigned Employee, busiest first (office: workOrder.record.read). */
export async function readTechnicianVolumeBreakdown(): Promise<GovernedTechnicianVolume[]> {
  const result = await run<{ items?: GovernedTechnicianVolume[] }>("readTechnicianVolumeBreakdown", {});
  return Array.isArray(result?.items) ? result.items : [];
}
