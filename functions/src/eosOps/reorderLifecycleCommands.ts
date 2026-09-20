// THE GOVERNED REORDER LIFECYCLE -- the commands that make PostgreSQL the Reorder authority.
//
// Every command is ONE transaction: capability -> actor -> lock the record -> status precondition ->
// (where the action is the assignee's) the governed Employee assignment predicate -> write -> audit
// -> commit. Any failure, the audit insert included, rolls back every effect.
//
// ════════════════════ THE ASSIGNEE IS AN EMPLOYEE, AND THE ACTOR IS A PRINCIPAL ════════════════════
//
// Three actions belong to whoever the work was assigned to: starting purchasing, posting purchasing
// progress, and closing out a receipt. The legacy client decided that by comparing a Firebase uid to
// `assignedToUserId`. Here it is decided by `isCallerTheAssignedEmployee`, which resolves the CALLER
// to an Employee through an ACTIVE employee_principal_link and compares Employee to Employee. No uid
// and no Principal id is ever compared to an Employee id.
//
// That predicate NARROWS an already-held capability. It grants nothing: a caller who is the assignee
// but holds no capability is still refused, and in that order.
//
// ════════════════════ NO CAPABILITY IS INVENTED HERE ════════════════════
//
// Every key below already exists in access/permissionCatalog.ts and is already held by the Roles
// that should hold it. Migration 036 registers them in the PostgreSQL vocabulary; registration is
// not a grant.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isCallerTheAssignedEmployee } from "./reorderAssignmentAuthority.js";
import { NATIVE_REORDER_PROVENANCE } from "./purchasingRepository.js";
import { deriveReorderCurrentOwner } from "./migration/reorderObjectMigration.js";

export const REORDER_CREATE_MANUAL = "reorder.request.create.manual";
export const REORDER_CREATE_SYSTEM = "reorder.request.create.system";
export const REORDER_APPROVE = "reorder.request.approve";
export const REORDER_REJECT = "reorder.request.reject";
export const REORDER_START_PURCHASING = "reorder.request.startPurchasing";
export const REORDER_POST_UPDATE = "reorder.request.postPurchasingUpdate";
export const REORDER_MARK_RECEIVED = "reorder.request.markReceived";
export const REORDER_CANCEL = "reorder.request.cancel";
export const REORDER_READ_QUEUE = "reorder.request.read.queue";
export const REORDER_READ_OWN = "reorder.request.read.own";
/** Already registered by migration 1760140800000's sibling catalog; a void is the PO's business. */
export const REORDER_PO_VOID = "reorder.purchaseOrder.void";

/** Pre-ORDERED statuses a Reorder may be cancelled from. ORDERED is VOIDED's business, not this one. */
export const CANCELLABLE_STATUSES = Object.freeze([
  "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS",
] as const);

export type ReorderLifecycleCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "FAILED";

export class ReorderLifecycleError extends Error {
  constructor(readonly code: string, readonly category: ReorderLifecycleCategory, message: string) {
    super(message);
    this.name = "ReorderLifecycleError";
  }
}
const refuse = (code: string, category: ReorderLifecycleCategory, message: string): never => {
  throw new ReorderLifecycleError(code, category, message);
};

export interface ReorderActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR -- never the assignee, never a Firebase uid. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  }
  const extra = Object.keys(input!).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  }
  return input!;
}

function requireActor(actor: ReorderActor, capability: string): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(capability)) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${capability}`);
  }
}

const optionalText = (v: unknown, field: string, max = 2000): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.trim() === "" || v.trim() !== v || v.length > max) {
    refuse(`${field.toUpperCase()}_INVALID`, "INVALID_INPUT", `${field} must be a trimmed, non-empty string of at most ${max} characters`);
  }
  return v as string;
};

interface LockedReorder {
  readonly id: string;
  readonly status: string;
  readonly operatingCompanyKey: string;
}

/** Lock the record and prove it belongs to the actor's tenant. Everything downstream reads this. */
async function lockReorder(client: PoolClient, tenantId: string, id: string): Promise<LockedReorder> {
  const { rows } = await client.query(
    `SELECT id, status::text AS status, operating_company_key
       FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, id],
  );
  if (rows.length === 0) refuse("REORDER_NOT_FOUND", "NOT_FOUND", `no Reorder Request ${id} in this tenant`);
  return { id: rows[0].id, status: rows[0].status, operatingCompanyKey: rows[0].operating_company_key };
}

async function audit(
  client: PoolClient, tenantId: string, action: string, actorPrincipalId: string,
  targetId: string, after: unknown, at: Date, reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'reorder_request', $5, NULL, $6::jsonb, $7, $8)`,
    [`audit_${randomUUID()}`, tenantId, action, actorPrincipalId, targetId, JSON.stringify(after), at, reason],
  );
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The assignee gate.
 *
 * Read INSIDE the transaction that is about to write, against the same locked record -- an
 * authorization decision taken outside it could be overtaken by a reassignment before the write.
 */
async function requireAssignee(
  client: PoolClient, actor: ReorderActor, reorderRequestId: string,
): Promise<void> {
  const isAssignee = await isCallerTheAssignedEmployee(client, actor.tenantId, actor.principalId, reorderRequestId);
  if (!isAssignee) {
    refuse("NOT_THE_ASSIGNEE", "FORBIDDEN",
      "this action belongs to the Employee the Reorder Request is assigned to");
  }
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

export interface CreateGovernedReorderResult {
  readonly reorderRequestId: string;
  readonly status: string;
}

/**
 * Raise a Reorder Request.
 *
 * RULING 3 AT THE CREATION BOUNDARY: the warehouse must exist in this tenant and its governed
 * operating company must agree with the Reorder's. Validated ONCE, here -- nothing re-derives it
 * afterwards, so a warehouse later changing hands never restates a historical Reorder.
 *
 * The company is read FROM THE WAREHOUSE rather than accepted from the caller: a caller-supplied
 * company is not company authority, which is the whole point of the ruling.
 */
export async function createGovernedReorderRequest(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<CreateGovernedReorderResult> {
  const i = acceptOnly(input, [
    "partId", "warehouseId", "requestedQuantity", "recommendedQuantity",
    "recommendationStatus", "quantitySource", "urgency", "workOrderId", "manual",
  ]);
  const manual = i.manual !== false;
  requireActor(actor, manual ? REORDER_CREATE_MANUAL : REORDER_CREATE_SYSTEM);

  if (!ID_SHAPE(i.partId)) refuse("PART_ID_REQUIRED", "INVALID_INPUT", "partId is required");
  if (!ID_SHAPE(i.warehouseId)) {
    // Deliberately no default and no fallback: not the first warehouse, not the only warehouse, not
    // one derived from the part, the user or the page.
    refuse("WAREHOUSE_REQUIRED", "INVALID_INPUT", "a warehouse is required -- a reorder replenishes a specific warehouse");
  }
  const requested = i.requestedQuantity;
  if (!Number.isSafeInteger(requested) || (requested as number) < 0) {
    refuse("QUANTITY_INVALID", "INVALID_INPUT", "requestedQuantity must be a whole number of at least zero");
  }
  // The stricter manual rule, kept where it already lived: a hand-entered quantity says something.
  if (manual && (requested as number) <= 0) {
    refuse("QUANTITY_INVALID", "INVALID_INPUT", "a manually entered requestedQuantity must be greater than zero");
  }
  const recommended = i.recommendedQuantity;
  if (recommended !== undefined && recommended !== null && !Number.isSafeInteger(recommended)) {
    refuse("QUANTITY_INVALID", "INVALID_INPUT", "recommendedQuantity, when present, must be a whole number");
  }
  const recommendationStatus = optionalText(i.recommendationStatus, "recommendationStatus", 100);
  if (recommendationStatus === null) refuse("RECOMMENDATION_STATUS_REQUIRED", "INVALID_INPUT", "recommendationStatus is required");
  const quantitySource = optionalText(i.quantitySource, "quantitySource", 100);
  if (quantitySource === null) refuse("QUANTITY_SOURCE_REQUIRED", "INVALID_INPUT", "quantitySource is required");
  const urgency = optionalText(i.urgency, "urgency", 100);
  const workOrderId = i.workOrderId === undefined || i.workOrderId === null ? null : i.workOrderId;
  if (workOrderId !== null && !ID_SHAPE(workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "workOrderId must be a governed id");

  return inTransaction(deps.pool, async (client) => {
    const { rows } = await client.query(
      `SELECT operating_company_key, status::text AS status FROM eos_ops.warehouses
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, i.warehouseId],
    );
    if (rows.length === 0) {
      refuse("WAREHOUSE_NOT_IN_TENANT", "NOT_FOUND", `warehouseId "${String(i.warehouseId)}" names no warehouse in this tenant`);
    }
    if (rows[0].status !== "ACTIVE") {
      refuse("WAREHOUSE_NOT_ACTIVE", "PRECONDITION_FAILED", "a reorder may only be raised against an ACTIVE warehouse");
    }
    const companyKey = rows[0].operating_company_key as string;
    if (typeof companyKey !== "string" || companyKey.trim() === "") {
      refuse("WAREHOUSE_NO_COMPANY", "PRECONDITION_FAILED",
        "the warehouse carries no governed operating company, so a reorder against it has no owner");
    }

    const id = `rr_${randomUUID()}`;
    const at = deps.now?.() ?? new Date();
    await client.query(
      `INSERT INTO eos_ops.reorder_requests
         (id, tenant_id, operating_company_key, part_id, warehouse_id, status,
          requested_quantity, recommended_quantity, work_order_id,
          requested_by, updated_by, provenance, created_at, updated_at,
          recommendation_status, quantity_source, urgency)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', $6, $7, $8, $9, $9, $10, $11, $11, $12, $13, $14)`,
      [id, actor.tenantId, companyKey, i.partId, i.warehouseId,
        requested, recommended ?? null, workOrderId,
        actor.principalId, NATIVE_REORDER_PROVENANCE, at,
        recommendationStatus, quantitySource, urgency],
    );
    await audit(client, actor.tenantId, "reorder.request.create", actor.principalId, id,
      { partId: i.partId, warehouseId: i.warehouseId, requestedQuantity: requested, manual }, at,
      manual ? "manual reorder request" : "system reorder request");
    return { reorderRequestId: id, status: "PENDING_REVIEW" };
  });
}

// ---------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------

export interface ReorderTransitionResult {
  readonly reorderRequestId: string;
  readonly status: string;
}

/** Approve or reject a Reorder Request under review. Two capabilities, one transition point. */
export async function reviewReorderRequest(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  const i = acceptOnly(input, ["reorderRequestId", "decision", "reviewNotes"]);
  if (i.decision !== "APPROVED" && i.decision !== "REJECTED") {
    refuse("DECISION_INVALID", "INVALID_INPUT", "decision must be APPROVED or REJECTED");
  }
  requireActor(actor, i.decision === "APPROVED" ? REORDER_APPROVE : REORDER_REJECT);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const reviewNotes = optionalText(i.reviewNotes, "reviewNotes");
  // A REJECTION STATES WHY. firestore.rules requires it (`status != "REJECTED" || reviewNotes is
  // string && size() > 0`) and an approval does not, so the asymmetry is preserved rather than
  // smoothed into "notes are always optional" on the way across.
  if (i.decision === "REJECTED" && reviewNotes === null) {
    refuse("REVIEW_NOTES_REQUIRED", "INVALID_INPUT", "a rejection states why");
  }

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    if (current.status !== "PENDING_REVIEW") {
      refuse("STATUS_NOT_REVIEWABLE", "PRECONDITION_FAILED", `a Reorder Request in ${current.status} is not under review`);
    }
    // APPROVED advances to READY_FOR_PARTS_MANAGER rather than resting at APPROVED: the approval is
    // the decision, and the status says whose queue it is now in.
    const status = i.decision === "APPROVED" ? "READY_FOR_PARTS_MANAGER" : "REJECTED";
    const at = deps.now?.() ?? new Date();
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET status = $3, review_decision = $4, review_notes = $5, reviewed_at = $6,
              reviewed_by_principal_id = $7, updated_by = $7, updated_at = $6
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current.id, status, i.decision, reviewNotes, at, actor.principalId],
    );
    await audit(client, actor.tenantId, "reorder.request.review", actor.principalId, current.id,
      { decision: i.decision, status }, at, "reorder request reviewed");
    return { reorderRequestId: current.id, status };
  });
}

// ---------------------------------------------------------------------------------------------
// The assignee's three actions
// ---------------------------------------------------------------------------------------------

/** Begin purchasing. ASSIGNEE ONLY, and only from the assigned state. */
export async function startPurchasingOnReorder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  requireActor(actor, REORDER_START_PURCHASING);
  const i = acceptOnly(input, ["reorderRequestId", "purchasingNotes"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const notes = optionalText(i.purchasingNotes, "purchasingNotes");

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    await requireAssignee(client, actor, current.id);
    if (current.status !== "ASSIGNED_TO_PARTS_ASSOCIATE") {
      refuse("STATUS_NOT_STARTABLE", "PRECONDITION_FAILED",
        `purchasing starts from ASSIGNED_TO_PARTS_ASSOCIATE, not ${current.status}`);
    }
    const at = deps.now?.() ?? new Date();
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET status = 'PURCHASING_IN_PROGRESS', purchasing_started_at = $3,
              purchasing_started_by_principal_id = $4, purchasing_notes = COALESCE($5, purchasing_notes),
              updated_by = $4, updated_at = $3
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current.id, at, actor.principalId, notes],
    );
    await audit(client, actor.tenantId, "reorder.request.startPurchasing", actor.principalId, current.id,
      { status: "PURCHASING_IN_PROGRESS" }, at, "purchasing started by the assigned Employee");
    return { reorderRequestId: current.id, status: "PURCHASING_IN_PROGRESS" };
  });
}

/** Record purchasing progress. ASSIGNEE ONLY. Does not move the status. */
export async function postPurchasingUpdate(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  requireActor(actor, REORDER_POST_UPDATE);
  const i = acceptOnly(input, ["reorderRequestId", "purchasingNotes", "vendorContacted", "expectedAvailabilityDate"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const notes = optionalText(i.purchasingNotes, "purchasingNotes");
  if (i.vendorContacted !== undefined && i.vendorContacted !== null && typeof i.vendorContacted !== "boolean") {
    refuse("VENDOR_CONTACTED_INVALID", "INVALID_INPUT", "vendorContacted must be a boolean when present");
  }
  const expected = i.expectedAvailabilityDate;
  if (expected !== undefined && expected !== null && !(typeof expected === "string" && ISO_DAY.test(expected))) {
    // Never parsed by a locale-dependent Date constructor that would read "03/04/2026" by mood.
    refuse("EXPECTED_DATE_INVALID", "INVALID_INPUT", "expectedAvailabilityDate must be an ISO calendar day");
  }

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    await requireAssignee(client, actor, current.id);
    if (current.status !== "PURCHASING_IN_PROGRESS") {
      refuse("STATUS_NOT_UPDATABLE", "PRECONDITION_FAILED",
        `purchasing progress is recorded while PURCHASING_IN_PROGRESS, not in ${current.status}`);
    }
    const at = deps.now?.() ?? new Date();
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET purchasing_notes = COALESCE($3, purchasing_notes),
              vendor_contacted = COALESCE($4, vendor_contacted),
              expected_availability_date = COALESCE($5::date, expected_availability_date),
              last_purchasing_update_at = $6, last_purchasing_update_by_principal_id = $7,
              updated_by = $7, updated_at = $6
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current.id, notes, i.vendorContacted ?? null, expected ?? null, at, actor.principalId],
    );
    await audit(client, actor.tenantId, "reorder.request.postPurchasingUpdate", actor.principalId, current.id,
      { vendorContacted: i.vendorContacted ?? null }, at, "purchasing progress recorded by the assigned Employee");
    return { reorderRequestId: current.id, status: current.status };
  });
}

/** Close out as received. ASSIGNEE ONLY, and only from ORDERED. */
export async function markReorderReceived(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  requireActor(actor, REORDER_MARK_RECEIVED);
  const i = acceptOnly(input, ["reorderRequestId"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    await requireAssignee(client, actor, current.id);
    if (current.status !== "ORDERED") {
      refuse("STATUS_NOT_RECEIVABLE", "PRECONDITION_FAILED", `a Reorder Request in ${current.status} has not been ordered`);
    }
    const at = deps.now?.() ?? new Date();
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET status = 'RECEIVED', received_at = $3, received_by_principal_id = $4,
              updated_by = $4, updated_at = $3
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current.id, at, actor.principalId],
    );
    await audit(client, actor.tenantId, "reorder.request.markReceived", actor.principalId, current.id,
      { status: "RECEIVED" }, at, "receipt closed out by the assigned Employee");
    return { reorderRequestId: current.id, status: "RECEIVED" };
  });
}

// ---------------------------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------------------------

/**
 * Cancel a Reorder Request.
 *
 * NOT assignee-scoped: cancellation is a management action, and the legacy Rules did not restrict it
 * to the assignee either. Only reachable before ORDERED -- past that point the answer is a void,
 * which is the purchase order's business and has its own append-only record.
 */
export async function cancelReorderRequest(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  requireActor(actor, REORDER_CANCEL);
  const i = acceptOnly(input, ["reorderRequestId", "cancellationReason"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const maybeReason = optionalText(i.cancellationReason, "cancellationReason");
  if (maybeReason === null) refuse("CANCELLATION_REASON_REQUIRED", "INVALID_INPUT", "a cancellation states why");
  const reason: string = maybeReason as string;

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(current.status)) {
      refuse("STATUS_NOT_CANCELLABLE", "PRECONDITION_FAILED",
        `a Reorder Request in ${current.status} cannot be cancelled; an ORDERED request is voided instead`);
    }
    const at = deps.now?.() ?? new Date();
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET status = 'CANCELLED', cancelled_at = $3, cancelled_by_principal_id = $4,
              cancellation_reason = $5, updated_by = $4, updated_at = $3
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, current.id, at, actor.principalId, reason],
    );
    await audit(client, actor.tenantId, "reorder.request.cancel", actor.principalId, current.id,
      { status: "CANCELLED" }, at, reason);
    return { reorderRequestId: current.id, status: "CANCELLED" };
  });
}

// ---------------------------------------------------------------------------------------------
// Void the purchase order
// ---------------------------------------------------------------------------------------------

export interface VoidResult {
  readonly reorderRequestId: string;
  readonly status: string;
  /** The Principal recorded on the void. The repository states it; this does not restate it. */
  readonly voidedBy: string;
  readonly reason: string;
}

/**
 * Void a Reorder's purchase order. ASSIGNEE ONLY, matching the legacy restriction exactly.
 *
 * The legacy client enforced this inside a Firestore transaction with
 * `reorderRequest.assignedToUserId !== auth.currentUser.uid`. The restriction is kept; the identity
 * model is not. The void RECORD itself is written by purchasingRepository.voidPurchaseOrder, which
 * copies the company and part from the purchase order it voids and never touches that order --
 * this command adds the authorization the repository deliberately does not own.
 *
 * THE ASSIGNEE CHECK RUNS FIRST AND IN ITS OWN TRANSACTION. That is a real, stated limitation: the
 * repository opens its own transaction, so a reassignment landing in between would not be seen.
 * Assignment fires only from READY_FOR_PARTS_MANAGER and this fires only from ORDERED, so the two
 * cannot race through governed commands -- the window exists only against a direct database write.
 */
export async function voidReorderPurchaseOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date; readonly voidPurchaseOrder?: typeof import("./purchasingRepository.js").voidPurchaseOrder },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<VoidResult> {
  requireActor(actor, REORDER_PO_VOID);
  const i = acceptOnly(input, ["reorderRequestId", "voidReason"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const maybe = optionalText(i.voidReason, "voidReason");
  if (maybe === null) refuse("VOID_REASON_REQUIRED", "INVALID_INPUT", "a void records why, or it records nothing");
  const reason: string = maybe as string;
  const reorderRequestId = i.reorderRequestId as string;

  const isAssignee = await isCallerTheAssignedEmployee(deps.pool, actor.tenantId, actor.principalId, reorderRequestId);
  if (!isAssignee) {
    refuse("NOT_THE_ASSIGNEE", "FORBIDDEN",
      "only the Employee the Reorder Request is assigned to may void its purchase order");
  }
  const run = deps.voidPurchaseOrder
    ?? (await import("./purchasingRepository.js")).voidPurchaseOrder;
  const record = await run(deps.pool, actor.tenantId, actor.principalId, reorderRequestId, reason);
  return { reorderRequestId, status: "VOIDED", voidedBy: record.voidedBy, reason: record.reason };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export interface ReorderQueueItem {
  readonly reorderRequestId: string;
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly requestedQuantity: number;
  readonly assignedEmployeeId: string | null;
  readonly currentOwner: string | null;
  /**
   * Is the CALLER the assigned Employee?
   *
   * Answered here, server side, so no screen has to compute it. The legacy client computed
   * `user.uid === request.assignedToUserId`, which made every rendering surface a place the identity
   * model could be got wrong independently.
   */
  readonly isAssignee: boolean;
}

const QUEUE_SELECT = `
  SELECT r.id, r.part_id, r.warehouse_id, r.status::text AS status, r.requested_quantity,
         a.assigned_employee_id
    FROM eos_ops.reorder_requests r
    LEFT JOIN eos_ops.reorder_request_assignments a
      ON a.tenant_id = r.tenant_id AND a.reorder_request_id = r.id AND a.effective_to IS NULL`;

const toItem = (
  r: Record<string, unknown>, currentOwner: string | null, callerEmployeeId: string | null,
): ReorderQueueItem => Object.freeze({
  reorderRequestId: r.id as string,
  partId: r.part_id as string,
  warehouseId: r.warehouse_id as string,
  status: r.status as string,
  requestedQuantity: Number(r.requested_quantity),
  assignedEmployeeId: (r.assigned_employee_id as string | null) ?? null,
  currentOwner,
  // Employee compared to Employee. A null caller Employee (an unlinked Principal) is never the
  // assignee, and a null assignment is nobody's.
  isAssignee: callerEmployeeId !== null && r.assigned_employee_id === callerEmployeeId,
});

/** The caller's Employee, through an ACTIVE link. Null when the Principal is not a linked Employee. */
async function callerEmployee(pool: Pool, tenantId: string, principalId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT employee_id FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`,
    [tenantId, principalId]);
  // A UNIQUE index (employee_principal_links_one_active_per_principal) already makes more than one
  // active link impossible, so this cannot currently fire. It is written as a refusal rather than a
  // `rows[0]` anyway: if that index is ever relaxed, the failure should be "nobody" and not
  // whichever row the planner returned first.
  return rows.length === 1 ? (rows[0].employee_id as string) : null;
}

/** The whole queue. Requires the queue capability, which is a different question from "my work". */
export async function readReorderQueue(
  deps: { readonly pool: Pool }, actor: ReorderActor,
): Promise<readonly ReorderQueueItem[]> {
  requireActor(actor, REORDER_READ_QUEUE);
  const [{ rows }, mine] = await Promise.all([
    deps.pool.query(`${QUEUE_SELECT} WHERE r.tenant_id = $1 ORDER BY r.created_at DESC, r.id`, [actor.tenantId]),
    callerEmployee(deps.pool, actor.tenantId, actor.principalId),
  ]);
  return Object.freeze(rows.map((r) => toItem(r, deriveReorderCurrentOwner(String(r.status)), mine)));
}

/**
 * "My assigned work."
 *
 * THE SEAM THIS CUTOVER EXISTS TO CLOSE. The legacy read was
 * `where(assignedToUserId == user.uid)` -- a Firestore query scoped by a Firebase uid. Here the
 * caller resolves to an EMPLOYEE through an ACTIVE employee_principal_link, and the scope is the
 * governed assignment. A caller with no active link sees nothing, which is the honest answer: an
 * unlinked Principal is not an Employee and has no assigned work.
 */
export async function readMyAssignedReorders(
  deps: { readonly pool: Pool }, actor: ReorderActor,
): Promise<readonly ReorderQueueItem[]> {
  requireActor(actor, REORDER_READ_OWN);
  const { rows } = await deps.pool.query(
    `${QUEUE_SELECT}
      JOIN eos_policy.employee_principal_links l
        ON l.tenant_id = r.tenant_id AND l.employee_id = a.assigned_employee_id AND l.status = 'active'
     WHERE r.tenant_id = $1 AND l.principal_id = $2
     ORDER BY r.created_at DESC, r.id`,
    [actor.tenantId, actor.principalId]);
  // Every row here IS the caller's by construction, but the flag is computed the same way rather
  // than asserted -- one definition of "is the assignee", not two that could drift apart.
  const mine = await callerEmployee(deps.pool, actor.tenantId, actor.principalId);
  return Object.freeze(rows.map((r) => toItem(r, deriveReorderCurrentOwner(String(r.status)), mine)));
}
