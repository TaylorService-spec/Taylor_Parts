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
import { postgresPrincipalDimensionReader } from "./contextualAuthorization.js";
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
// READ (Controller ruling 6, 2026-09-28): ONE current capability, reorder.request.read, whose REACH is decided by the
// governed context -- the REORDER_QUEUE Operational Scope reaches the shared queue, an active record assignment
// reaches the caller's own requests. #1961's separate read.queue / read.own keys are not recreated.
export const REORDER_READ = "reorder.request.read";
export const REORDER_QUEUE_SCOPE = "REORDER_QUEUE";
/** Already registered by migration 1760140800000's sibling catalog; a void is the PO's business. */
export const REORDER_PO_VOID = "reorder.purchaseOrder.void";
/** Also already in the Role catalog; recording the PO is what moves a Reorder to ORDERED. */
export const REORDER_RECORD_PO = "reorder.request.recordPurchaseOrder";

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

/**
 * The QUEUE reach of reorder.request.read: the operating-company keys whose REORDER_QUEUE Operational Scope the caller's
 * Employee currently holds. The scope is COMPANY-KEYED (migration 1761696000000: "a queue is always some company's
 * queue"), so reach is a set of keys, never a yes/no -- a scope for one company never reaches another's queue. Read
 * through the governed dimension reader (eosOps/contextualAuthorization.ts), the one module that knows the scope table.
 * A caller with no linked Employee reaches no queue.
 */
async function queueReachKeys(db: Pick<PoolClient, "query">, actor: ReorderActor): Promise<readonly string[]> {
  const reader = postgresPrincipalDimensionReader(db);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  if (employeeId === null) return [];
  return (await reader.listOperationalScopes(actor.tenantId, employeeId))
    .filter((x) => x.scopeType === REORDER_QUEUE_SCOPE).map((x) => x.scopeId);
}

async function requireQueueReach(db: Pick<PoolClient, "query">, actor: ReorderActor): Promise<readonly string[]> {
  const keys = await queueReachKeys(db, actor);
  if (keys.length === 0) {
    refuse("OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN", "reading the Reorder queue requires the REORDER_QUEUE Operational Scope");
  }
  return keys;
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
    // RULING 2 AT THE CREATION BOUNDARY. A non-empty key is not operating-company authority: the key
    // must be BOUND, for this tenant, to a company the tenant is authorized to operate as, and both
    // the company and the binding must be ACTIVE. Read here rather than trusted from the warehouse
    // row, so a warehouse carrying a key nobody governs cannot raise a Reorder.
    const bound = await client.query(
      `SELECT 1 FROM eos_policy.tenant_operating_company_keys b
         JOIN eos_policy.tenant_operating_companies c
           ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
        WHERE b.tenant_id = $1 AND b.operating_company_key = $2
          AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
      [actor.tenantId, companyKey],
    );
    if (bound.rows.length === 0) {
      refuse("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED",
        `the warehouse's operating company key "${companyKey}" is not bound to an ACTIVE operating `
        + "company this tenant is authorized to operate as");
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

/**
 * RECEIVING ACTIVATION BOUNDARY -- Owner Ruling R2.
 *
 * Once the PostgreSQL Receiving authority is active there must NOT remain a separately callable path
 * capable of moving a Reorder to RECEIVED without the receipt that moved the stock. A standalone
 * closeout would let the order say the goods arrived while no inventory movement, no serialized
 * custody and no acquisition-cost evidence exists anywhere -- the books would be closed on a receipt
 * that never happened.
 *
 * This flag is the boundary, and it is a single constant rather than an environment variable on
 * purpose: activation is a code decision that is reviewed, tested and deployed as one change, not a
 * runtime setting whose value has to be discovered from a dashboard to know what the system does.
 *
 * FALSE today, because the PostgreSQL receipt is built but the cutover is not active, and the
 * deployed operation must keep answering until it is. Flipping it to true retires `markReorderReceived`
 * at exactly the same boundary, without removing the operation from the transport first -- so an
 * external caller gets an explicit refusal that names the replacement, rather than a 404 it might
 * read as a transient outage.
 */
// ACTIVATED with the PostgreSQL Reorder authority (window step 19; Owner ruling R2): ORDERED -> RECEIVED is now the
// governed receipt's consequence, and markReorderReceived answers only with its explicit refusal.
export const RECEIVING_POSTGRES_ACTIVE = true;

/**
 * THE POSTGRESQL REORDER AUTHORITY'S ACTIVATION BOUNDARY (Controller ruling 2026-09-28, activation window step 19).
 *
 * FALSE until the Reorder COPY is verified and the ruled Administration grants are applied. While false, the Render
 * operations transport refuses every Reorder read and command (eosOpsHttp.ts), so no governed Reorder can be written
 * between the integration deploy and the verified COPY -- a native row there would be a population the snapshot does
 * not contain. A code constant, like RECEIVING_POSTGRES_ACTIVE and the Catalog writer state: activation is a reviewed,
 * tested, deployed change, never a runtime setting.
 */
// ACTIVATED by window step 19, after the Reorder COPY is verified and the ruled Administration grants are applied.
export const REORDER_POSTGRES_ACTIVE = true;

export interface ReorderCloseoutInput {
  readonly tenantId: string;
  /** The EOS Principal performing the ACTION. For a receipt this is the receiver, not the assignee. */
  readonly actorPrincipalId: string;
  readonly reorderRequestId: string;
  /** The governed business event time. For a receipt, the receipt's own `received_at`. */
  readonly receivedAt: Date;
  readonly reason: string;
}

/**
 * ORDERED -> RECEIVED, INSIDE THE CALLER'S TRANSACTION.
 *
 * Extracted from `markReorderReceived` so the receipt command can close the Reorder out in the SAME
 * transaction that writes the receipt, the movements, the custody and the cost evidence. It opens no
 * transaction of its own and takes no pool: the caller owns BEGIN and COMMIT, which is what makes
 * "no Reorder RECEIVED without the receipt" structural rather than a convention.
 *
 * It performs NO capability check and NO assignee check. Those belong to the command that calls it,
 * and they differ: a receipt is authorized by `inventory.stock.receive` held by whoever receives the
 * goods, while the standalone operation below is the assignee's. Putting either check here would
 * force one answer on both callers.
 *
 * The row must already be LOCKED by the caller. The status is re-asserted here anyway -- the caller
 * may have read it before making other decisions, and the assertion is what guarantees the write
 * moves a Reorder that is still ORDERED at the moment it happens.
 */
export async function closeOutReorderAsReceived(
  client: PoolClient,
  input: ReorderCloseoutInput,
): Promise<ReorderTransitionResult> {
  const { rowCount } = await client.query(
    `UPDATE eos_ops.reorder_requests
        SET status = 'RECEIVED', received_at = $3, received_by_principal_id = $4,
            updated_by = $4, updated_at = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'ORDERED'`,
    [input.tenantId, input.reorderRequestId, input.receivedAt, input.actorPrincipalId],
  );
  if (rowCount !== 1) {
    // `AND status = 'ORDERED'` re-asserts, at write time, the status the caller read. A concurrent
    // closeout finds no row, throws, and rolls the whole receipt back with it.
    refuse("STATUS_NOT_RECEIVABLE", "PRECONDITION_FAILED",
      "the Reorder Request was no longer ORDERED when the closeout committed");
  }
  await audit(client, input.tenantId, "reorder.request.markReceived", input.actorPrincipalId,
    input.reorderRequestId, { status: "RECEIVED" }, input.receivedAt, input.reason);
  return { reorderRequestId: input.reorderRequestId, status: "RECEIVED" };
}

/**
 * Close out as received. ASSIGNEE ONLY, and only from ORDERED.
 *
 * RETIRED AT THE RECEIVING ACTIVATION BOUNDARY (Ruling R2). While the PostgreSQL receipt is inert
 * this remains the governed closeout. The moment receiving is active, closing a Reorder is the
 * receipt's business and this operation refuses -- it is kept callable only so that the refusal
 * itself is explicit.
 */
export async function markReorderReceived(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<ReorderTransitionResult> {
  if (RECEIVING_POSTGRES_ACTIVE) {
    refuse("CLOSEOUT_REQUIRES_RECEIPT", "PRECONDITION_FAILED",
      "a Reorder is closed out by receiving the stock: use the governed receipt, which records the inventory movement, the custody and the cost evidence in the same transaction");
  }
  requireActor(actor, REORDER_MARK_RECEIVED);
  const i = acceptOnly(input, ["reorderRequestId"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");

  return inTransaction(deps.pool, async (client) => {
    const current = await lockReorder(client, actor.tenantId, i.reorderRequestId as string);
    await requireAssignee(client, actor, current.id);
    if (current.status !== "ORDERED") {
      refuse("STATUS_NOT_RECEIVABLE", "PRECONDITION_FAILED", `a Reorder Request in ${current.status} has not been ordered`);
    }
    return closeOutReorderAsReceived(client, {
      tenantId: actor.tenantId,
      actorPrincipalId: actor.principalId,
      reorderRequestId: current.id,
      receivedAt: deps.now?.() ?? new Date(),
      reason: "receipt closed out by the assigned Employee",
    });
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
// Record the purchase order
// ---------------------------------------------------------------------------------------------

/**
 * Record the purchase order, which is what moves a Reorder to ORDERED.
 *
 * This was a Firebase callable performing both writes in one Admin-SDK transaction. The atomicity
 * has not weakened -- purchasingRepository.recordPurchaseOrder does the same two writes in one
 * PostgreSQL transaction -- but the authority has moved, and the callable is no longer part of it.
 *
 * NOT assignee-scoped: the legacy did not restrict it to the assignee either, and inventing a
 * restriction on the way across narrows access as surely as dropping one widens it.
 *
 * partId is deliberately not an input. The repository reads it from the request inside the
 * transaction, so a purchase order cannot be recorded against a part the request never named.
 */
export async function recordReorderPurchaseOrder(
  deps: { readonly pool: Pool; readonly recordPurchaseOrder?: typeof import("./purchasingRepository.js").recordPurchaseOrder },
  actor: ReorderActor,
  input: Record<string, unknown>,
): Promise<{ readonly reorderRequestId: string; readonly status: string; readonly purchaseOrderId: string }> {
  requireActor(actor, REORDER_RECORD_PO);
  const i = acceptOnly(input, ["reorderRequestId", "supplierName", "externalPoNumber", "orderedQuantity",
    "orderedDate", "expectedArrivalDate", "unitPriceMinor", "currency"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const supplierName = optionalText(i.supplierName, "supplierName", 200);
  if (supplierName === null) refuse("SUPPLIER_REQUIRED", "INVALID_INPUT", "supplierName is required");
  const externalPoNumber = optionalText(i.externalPoNumber, "externalPoNumber", 100);
  if (externalPoNumber === null) refuse("PO_NUMBER_REQUIRED", "INVALID_INPUT", "externalPoNumber is required");
  if (!Number.isSafeInteger(i.orderedQuantity) || (i.orderedQuantity as number) <= 0) {
    refuse("QUANTITY_INVALID", "INVALID_INPUT", "orderedQuantity must be a whole number greater than zero");
  }
  for (const [field, value] of [["orderedDate", i.orderedDate], ["expectedArrivalDate", i.expectedArrivalDate]] as const) {
    if (value === undefined || value === null) {
      if (field === "orderedDate") refuse("ORDERED_DATE_REQUIRED", "INVALID_INPUT", "orderedDate is required");
      continue;
    }
    // An ISO calendar day, never a locale string handed to a Date constructor.
    if (typeof value !== "string" || !ISO_DAY.test(value)) {
      refuse("DATE_INVALID", "INVALID_INPUT", `${field} must be an ISO calendar day`);
    }
  }
  // An amount without a currency, or a currency without an amount, is not a price.
  const hasAmount = i.unitPriceMinor !== undefined && i.unitPriceMinor !== null;
  const hasCurrency = i.currency !== undefined && i.currency !== null;
  if (hasAmount !== hasCurrency) {
    refuse("PRICE_INVALID", "INVALID_INPUT", "a price states both an amount and its currency, or neither");
  }
  if (hasAmount && !Number.isSafeInteger(i.unitPriceMinor)) {
    refuse("PRICE_INVALID", "INVALID_INPUT", "unitPriceMinor must be a whole number of minor units");
  }
  if (hasCurrency && !(typeof i.currency === "string" && /^[A-Z]{3}$/.test(i.currency))) {
    refuse("PRICE_INVALID", "INVALID_INPUT", "currency must be a three-letter code");
  }

  // ASSIGNEE ONLY (Controller ruling 4): recording the purchase order placed for a Reorder Request belongs to the Employee
  // it is assigned to -- capability AND the governed record assignment. The repository owns its own transaction, so the
  // check precedes it. (The void is deliberately different: a management exception authorized by scope, not assignment.)
  if (!(await isCallerTheAssignedEmployee(deps.pool, actor.tenantId, actor.principalId, i.reorderRequestId as string))) {
    refuse("NOT_THE_ASSIGNEE", "FORBIDDEN", "only the Employee the Reorder Request is assigned to may record its purchase order");
  }
  const repository = await import("./purchasingRepository.js");
  const run = deps.recordPurchaseOrder ?? repository.recordPurchaseOrder;
  // The repository's governed refusals ARE answers (XLF 2026-09-30): a replay onto an ORDERED request, a second PO, or an
  // unknown request keep the repository's own code and are reported in the lifecycle's categories -- never a 500.
  const REPOSITORY_CATEGORY: Readonly<Record<string, ReorderLifecycleCategory>> = Object.freeze({
    REQUEST_STATE_INVALID: "PRECONDITION_FAILED", PO_ALREADY_EXISTS: "CONFLICT", REQUEST_NOT_FOUND: "NOT_FOUND",
  });
  const record = await run(deps.pool, actor.tenantId, actor.principalId, i.reorderRequestId as string, {
    supplierName: supplierName as string, externalPoNumber: externalPoNumber as string,
    orderedQuantity: i.orderedQuantity as number,
    orderedDate: i.orderedDate as string,
    expectedArrivalDate: (i.expectedArrivalDate as string | null) ?? null,
    unitPriceMinor: hasAmount ? (i.unitPriceMinor as number) : null,
    currency: hasCurrency ? (i.currency as string) : null,
  }).catch((err: unknown) => {
    const category = err instanceof repository.PurchasingRepositoryError ? REPOSITORY_CATEGORY[err.code] : undefined;
    if (category !== undefined) refuse((err as InstanceType<typeof repository.PurchasingRepositoryError>).code, category, (err as Error).message);
    throw err;
  });
  // The purchase order's identity IS the request's (ruling R-16); it is returned rather than
  // restated so no caller can come to believe there are two ids.
  return { reorderRequestId: i.reorderRequestId as string, status: "ORDERED", purchaseOrderId: record.purchaseOrderId };
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

  // A MANAGEMENT EXCEPTION, NOT AN ASSIGNEE ACTION (Controller ruling 2026-09-28). The void is authorized by
  // reorder.purchaseOrder.void (above) and by governed company scope: the caller's Employee must hold the
  // REORDER_QUEUE Operational Scope for the Purchase Order's own operating company. Being the purchasing assignee
  // neither grants nor is required for it. The lifecycle state (ORDERED only), the stated reason, the single void
  // and the audit event are the repository's, in its one transaction. A Purchase Order this caller cannot reach and
  // one that does not exist are refused identically, so the command is no existence oracle.
  const { rows: poRows } = await deps.pool.query(
    `SELECT operating_company_key FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, reorderRequestId]);
  const reachKeys = await queueReachKeys(deps.pool, actor);
  if (poRows.length === 0 || !reachKeys.includes(String(poRows[0].operating_company_key))) {
    refuse("OUTSIDE_VOID_REACH", "FORBIDDEN",
      "voiding requires the REORDER_QUEUE Operational Scope for this Purchase Order's operating company");
  }
  const run = deps.voidPurchaseOrder
    ?? (await import("./purchasingRepository.js")).voidPurchaseOrder;
  const record = await run(deps.pool, actor.tenantId, actor.principalId, reorderRequestId, reason);
  return { reorderRequestId, status: "VOIDED", voidedBy: record.voidedBy, reason: record.reason };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * A governed Reorder, as the screens read it.
 *
 * This is the whole business record, not a thin queue projection: the screens render urgency,
 * review notes, purchasing progress and the cancellation reason, and a read that answered less
 * would send them back to Firestore for the rest -- which is the dual-read this cutover exists to
 * prevent.
 *
 * `id` is present ALONGSIDE `reorderRequestId` on purpose. The client has always keyed a Reorder by
 * `.id`, and renaming that in the same change that moves the authority would mix a cosmetic churn
 * into a migration, making a reviewer check every render site for a reason unrelated to identity.
 */
/** The same three answers the legacy callable gave. Collapsing them would lie to the picker. */
export type ReorderWarehouseReason =
  "GOVERNED_ASSIGNMENT" | "NO_GOVERNED_WAREHOUSE_AUTHORITY" | "AUTHORITY_UNRESOLVED";

export interface ReorderWarehouseOption {
  readonly warehouseId: string;
  readonly label: string;
}

export interface ReorderQueueItem {
  readonly id: string;
  readonly reorderRequestId: string;
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly requestedQty: number;
  readonly recommendedQty: number | null;
  readonly recommendationStatus: string | null;
  readonly quantitySource: string | null;
  readonly urgency: string | null;
  readonly workOrderId: string | null;
  readonly reorderRequestNumber: string | null;
  readonly createdAt: string | null;
  readonly reviewDecision: string | null;
  readonly reviewNotes: string | null;
  readonly reviewedAt: string | null;
  readonly purchasingStartedAt: string | null;
  readonly purchasingNotes: string | null;
  readonly vendorContacted: boolean | null;
  readonly expectedAvailabilityDate: string | null;
  readonly lastPurchasingUpdateAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly receivedAt: string | null;
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
         r.recommended_quantity, r.recommendation_status, r.quantity_source, r.urgency,
         r.work_order_id, r.reorder_request_number, r.created_at,
         r.review_decision, r.review_notes, r.reviewed_at,
         r.purchasing_started_at, r.purchasing_notes, r.vendor_contacted,
         r.expected_availability_date, r.last_purchasing_update_at,
         r.cancelled_at, r.cancellation_reason, r.received_at,
         r.operating_company_key, a.assigned_employee_id, a.assigned_by_principal_id
    FROM eos_ops.reorder_requests r
    LEFT JOIN eos_ops.reorder_request_assignments a
      ON a.tenant_id = r.tenant_id AND a.reorder_request_id = r.id AND a.effective_to IS NULL`;

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : (v === null || v === undefined ? null : String(v));
/** A DATE column, kept as the calendar day it is -- never widened into an instant with a timezone. */
const day = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : (v === null || v === undefined ? null : String(v));

const toItem = (
  r: Record<string, unknown>, currentOwner: string | null, callerEmployeeId: string | null,
): ReorderQueueItem => Object.freeze({
  id: r.id as string,
  reorderRequestId: r.id as string,
  partId: r.part_id as string,
  warehouseId: r.warehouse_id as string,
  status: r.status as string,
  requestedQty: Number(r.requested_quantity),
  recommendedQty: r.recommended_quantity === null || r.recommended_quantity === undefined
    ? null : Number(r.recommended_quantity),
  recommendationStatus: (r.recommendation_status as string | null) ?? null,
  quantitySource: (r.quantity_source as string | null) ?? null,
  urgency: (r.urgency as string | null) ?? null,
  workOrderId: (r.work_order_id as string | null) ?? null,
  reorderRequestNumber: (r.reorder_request_number as string | null) ?? null,
  createdAt: iso(r.created_at),
  reviewDecision: (r.review_decision as string | null) ?? null,
  reviewNotes: (r.review_notes as string | null) ?? null,
  reviewedAt: iso(r.reviewed_at),
  purchasingStartedAt: iso(r.purchasing_started_at),
  purchasingNotes: (r.purchasing_notes as string | null) ?? null,
  vendorContacted: r.vendor_contacted === null || r.vendor_contacted === undefined
    ? null : Boolean(r.vendor_contacted),
  expectedAvailabilityDate: day(r.expected_availability_date),
  lastPurchasingUpdateAt: iso(r.last_purchasing_update_at),
  cancelledAt: iso(r.cancelled_at),
  cancellationReason: (r.cancellation_reason as string | null) ?? null,
  receivedAt: iso(r.received_at),
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

/**
 * The queue. Requires reorder.request.read with the QUEUE reach -- a different question from "my work" -- and returns
 * only the companies whose REORDER_QUEUE scope the caller holds.
 *
 * The filters replace the Firestore `where()` clauses the client used to build for itself --
 * by status, by several statuses, and by part. They NARROW a read the caller may already perform,
 * so none of them is an authorization decision; the capability above is.
 */
export async function readReorderQueue(
  deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown> = {},
): Promise<readonly ReorderQueueItem[]> {
  requireActor(actor, REORDER_READ);
  const reachKeys = await requireQueueReach(deps.pool, actor);
  const i = acceptOnly(input, ["statuses", "partId", "limit", "beforeCreatedAt", "beforeId"]);

  let statuses: string[] | null = null;
  if (i.statuses !== undefined && i.statuses !== null) {
    if (!Array.isArray(i.statuses) || i.statuses.some((x) => !ID_SHAPE(x))) {
      refuse("STATUSES_INVALID", "INVALID_INPUT", "statuses must be an array of status names");
    }
    statuses = i.statuses as string[];
  }
  if (i.partId !== undefined && i.partId !== null && !ID_SHAPE(i.partId)) {
    refuse("PART_ID_INVALID", "INVALID_INPUT", "partId must be a governed Part id");
  }
  const limit = i.limit === undefined || i.limit === null ? null : i.limit;
  if (limit !== null && (!Number.isSafeInteger(limit) || (limit as number) <= 0 || (limit as number) > 500)) {
    refuse("LIMIT_INVALID", "INVALID_INPUT", "limit must be a whole number between 1 and 500");
  }
  // A KEYSET cursor on the exact sort key, not an offset. Offset paging silently repeats or skips
  // rows when the underlying set changes between pages, and a "Load More" that quietly drops a
  // Reorder is worse than one that refuses.
  const beforeCreatedAt = i.beforeCreatedAt ?? null;
  const beforeId = i.beforeId ?? null;
  if ((beforeCreatedAt === null) !== (beforeId === null)) {
    refuse("CURSOR_INVALID", "INVALID_INPUT", "a cursor states both beforeCreatedAt and beforeId, or neither");
  }
  if (beforeCreatedAt !== null && (typeof beforeCreatedAt !== "string" || Number.isNaN(Date.parse(beforeCreatedAt)))) {
    refuse("CURSOR_INVALID", "INVALID_INPUT", "beforeCreatedAt must be an ISO instant");
  }
  if (beforeId !== null && !ID_SHAPE(beforeId)) {
    refuse("CURSOR_INVALID", "INVALID_INPUT", "beforeId must be a Reorder Request id");
  }

  const [{ rows }, mine] = await Promise.all([
    deps.pool.query(
      `${QUEUE_SELECT}
        WHERE r.tenant_id = $1
          AND ($2::text[] IS NULL OR r.status::text = ANY($2::text[]))
          AND ($3::text IS NULL OR r.part_id = $3)
          AND ($5::timestamptz IS NULL
               OR (r.created_at, r.id) < ($5::timestamptz, $6::text))
          AND r.operating_company_key = ANY($7::text[])
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT COALESCE($4::int, 500)`,
      [actor.tenantId, statuses, i.partId ?? null, limit, beforeCreatedAt, beforeId, reachKeys]),
    callerEmployee(deps.pool, actor.tenantId, actor.principalId),
  ]);
  return Object.freeze(rows.map((r) => toItem(r, deriveReorderCurrentOwner(String(r.status)), mine)));
}

/** One Reorder Request, by id. Same capability as the queue it is a row of. */
export async function readReorderRequest(
  deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>,
): Promise<ReorderQueueItem | null> {
  requireActor(actor, REORDER_READ);
  const i = acceptOnly(input, ["reorderRequestId"]);
  if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  const [{ rows }, mine, reachKeys] = await Promise.all([
    deps.pool.query(`${QUEUE_SELECT} WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, i.reorderRequestId]),
    callerEmployee(deps.pool, actor.tenantId, actor.principalId),
    queueReachKeys(deps.pool, actor),
  ]);
  const row = rows[0];
  // Two governed paths to one record: the queue scope for ITS company, or an active assignment of THIS record to the
  // caller. Neither -> refused, and refused identically whether or not the record exists, so the read is no oracle.
  const inQueueReach = row !== undefined && reachKeys.includes(String(row.operating_company_key));
  if (!inQueueReach
      && !(await isCallerTheAssignedEmployee(deps.pool, actor.tenantId, actor.principalId, i.reorderRequestId as string))) {
    refuse("OUTSIDE_READ_REACH", "FORBIDDEN", "this Reorder Request is neither in the caller's queue reach nor assigned to them");
  }
  return row ? toItem(row, deriveReorderCurrentOwner(String(row.status)), mine) : null;
}

/** The most Reorder Purchase Orders one read may name. A page of the queue, never "all of them". */
export const REORDER_PURCHASE_ORDER_READ_MAX_IDS = 100;

/**
 * A Reorder Purchase Order, with its append-only void record when it has one, as the screens read it.
 *
 * The field names are the ones the screens already render (supplierName, externalPoNumber,
 * orderedQuantity, orderedDate, expectedArrivalDate), so moving the read changes the SOURCE and not
 * the vocabulary. `status` is the record's own, immutable status -- ORDERED, the only value a Reorder
 * Purchase Order has ever carried -- because the lifecycle (RECEIVED, VOIDED) lives on the Reorder
 * Request and on the void record, never on the purchase order itself.
 */
export interface ReorderPurchaseOrderView {
  readonly id: string;
  readonly reorderRequestId: string;
  readonly purchaseOrderId: string;
  readonly partId: string;
  readonly status: "ORDERED";
  readonly supplierName: string;
  readonly externalPoNumber: string;
  readonly orderedQuantity: number;
  readonly orderedDate: string;
  readonly expectedArrivalDate: string | null;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  readonly createdBy: string;
  readonly createdAt: string | null;
  readonly void: null | {
    readonly reorderPurchaseOrderId: string;
    readonly reason: string;
    readonly voidedBy: string;
    readonly createdAt: string | null;
  };
}

/**
 * The Reorder Purchase Orders (and their void records) of the Reorder Requests the caller names.
 *
 * THE GOVERNED REPLACEMENT for the browser's Firestore reads of `reorder_purchase_orders` and
 * `reorder_purchase_order_voids`. Once PostgreSQL is the Reorder authority, those collections are a
 * frozen snapshot, and a screen that kept reading them would present a purchase order the governed
 * receipt or void has since moved on from as current truth.
 *
 * SAME AUTHORIZATION AS readReorderRequest, applied to EVERY id: reorder.request.read, and for each
 * named Reorder Request either the REORDER_QUEUE scope for its operating company or an active
 * assignment of that record to the caller's Employee. A purchase order's company IS its request's
 * (inherited at recording), so reaching the request is reaching its purchase order.
 *
 * FAIL CLOSED, WHOLE. One id the caller cannot reach refuses the read -- it is never silently dropped
 * from the answer, which would render as "no purchase order recorded" -- and a Reorder Request that
 * does not exist is refused exactly like one out of reach, so the read is no existence oracle. A
 * reachable request that simply has no purchase order is ABSENT from the answer: that is a real fact
 * (the ORPHAN case the screens surface), not a refusal.
 */
export async function readReorderPurchaseOrders(
  deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>,
): Promise<{ readonly purchaseOrders: readonly ReorderPurchaseOrderView[] }> {
  requireActor(actor, REORDER_READ);
  const i = acceptOnly(input, ["reorderRequestIds"]);
  const raw = i.reorderRequestIds;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > REORDER_PURCHASE_ORDER_READ_MAX_IDS
      || raw.some((x) => !ID_SHAPE(x))) {
    refuse("REORDER_REQUEST_IDS_INVALID", "INVALID_INPUT",
      `reorderRequestIds must name between 1 and ${REORDER_PURCHASE_ORDER_READ_MAX_IDS} Reorder Request ids`);
  }
  const ids = [...new Set(raw as string[])];

  const [{ rows: requestRows }, reachKeys] = await Promise.all([
    deps.pool.query(
      `SELECT id, operating_company_key FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [actor.tenantId, ids]),
    queueReachKeys(deps.pool, actor),
  ]);
  const companyById = new Map(requestRows.map((r) => [r.id as string, String(r.operating_company_key)]));
  for (const id of ids) {
    const company = companyById.get(id);
    const inQueueReach = company !== undefined && reachKeys.includes(company);
    if (!inQueueReach && !(await isCallerTheAssignedEmployee(deps.pool, actor.tenantId, actor.principalId, id))) {
      refuse("OUTSIDE_READ_REACH", "FORBIDDEN",
        "a named Reorder Request is neither in the caller's queue reach nor assigned to them");
    }
  }

  const { rows } = await deps.pool.query(
    `SELECT p.id, p.part_id, p.supplier_name, p.external_po_number, p.ordered_quantity,
            to_char(p.ordered_date, 'YYYY-MM-DD') AS ordered_date,
            to_char(p.expected_arrival_date, 'YYYY-MM-DD') AS expected_arrival_date,
            p.unit_price_minor, p.currency, p.created_by, p.created_at,
            v.purchase_order_id AS void_id, v.reason AS void_reason, v.voided_by, v.voided_at
       FROM eos_ops.purchase_orders p
       LEFT JOIN eos_ops.purchase_order_voids v
         ON v.tenant_id = p.tenant_id AND v.purchase_order_id = p.id
      WHERE p.tenant_id = $1 AND p.id = ANY($2::text[])
      ORDER BY p.id`,
    [actor.tenantId, ids]);
  return Object.freeze({
    purchaseOrders: Object.freeze(rows.map((r) => Object.freeze({
      id: r.id as string,
      reorderRequestId: r.id as string,
      purchaseOrderId: r.id as string,
      partId: r.part_id as string,
      status: "ORDERED" as const,
      supplierName: r.supplier_name as string,
      externalPoNumber: r.external_po_number as string,
      orderedQuantity: Number(r.ordered_quantity),
      orderedDate: r.ordered_date as string,
      expectedArrivalDate: (r.expected_arrival_date as string | null) ?? null,
      // BIGINT arrives as a string from `pg`; converted once, here.
      unitPriceMinor: r.unit_price_minor === null || r.unit_price_minor === undefined ? null : Number(r.unit_price_minor),
      currency: (r.currency as string | null) ?? null,
      createdBy: r.created_by as string,
      createdAt: iso(r.created_at),
      void: r.void_id === null || r.void_id === undefined ? null : Object.freeze({
        reorderPurchaseOrderId: r.void_id as string,
        reason: r.void_reason as string,
        voidedBy: r.voided_by as string,
        createdAt: iso(r.voided_at),
      }),
    }))),
  });
}

/**
 * WHICH WAREHOUSES MAY THIS CALLER RAISE A REORDER FOR?
 *
 * The governed replacement for the `listReorderWarehouseOptions` Firebase callable. Same question,
 * same authorizing capability as the create it serves -- if you may not raise a reorder, there is
 * no reorder warehouse list for you to see -- and the same three-way answer, because "you may not
 * do this", "you may, but no warehouse is governed to you" and "a read failed" are three different
 * sentences and a picker that collapses them lies to the person using it.
 *
 * The scope is the caller's governed WAREHOUSE operational scope (employee_operational_scopes),
 * resolved through their Employee. There is no operational-role fallback and no Firestore read.
 *
 * A warehouse is offered only when it is ACTIVE and its operating company key is BOUND to an ACTIVE
 * company this tenant may operate as -- the same Ruling 2 check the create itself applies, so the
 * picker cannot offer a warehouse the create would then refuse.
 */
export async function listReorderWarehouseOptions(
  deps: { readonly pool: Pool }, actor: ReorderActor,
): Promise<{ readonly options: readonly ReorderWarehouseOption[]; readonly reason: ReorderWarehouseReason }> {
  requireActor(actor, REORDER_CREATE_MANUAL);
  const employeeId = await callerEmployee(deps.pool, actor.tenantId, actor.principalId);
  if (employeeId === null) {
    // Not "no warehouses": this caller resolves to no Employee, so their scope cannot be read at
    // all. Fail closed, and say which of the three answers this is.
    return { options: Object.freeze([]), reason: "AUTHORITY_UNRESOLVED" };
  }
  const { rows } = await deps.pool.query(
    `SELECT w.id, w.name, w.site_label
       FROM eos_ops.warehouses w
       JOIN eos_workforce.employee_operational_scopes s
         ON s.tenant_id = w.tenant_id AND s.scope_id = w.id
        AND s.scope_type = 'WAREHOUSE' AND s.effective_to IS NULL
       JOIN eos_policy.tenant_operating_company_keys b
         ON b.tenant_id = w.tenant_id AND b.operating_company_key = w.operating_company_key
        AND b.status = 'ACTIVE'
       JOIN eos_policy.tenant_operating_companies c
         ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
        AND c.status = 'ACTIVE'
      WHERE w.tenant_id = $1 AND s.employee_id = $2 AND w.status = 'ACTIVE'
      ORDER BY w.name, w.id`,
    [actor.tenantId, employeeId]);
  const options = Object.freeze(rows.map((r) => Object.freeze({
    warehouseId: r.id as string,
    label: `${r.name as string} (${r.site_label as string})`,
  })));
  return {
    options,
    reason: options.length > 0 ? "GOVERNED_ASSIGNMENT" : "NO_GOVERNED_WAREHOUSE_AUTHORITY",
  };
}

/**
 * "Requests I personally reviewed or assigned."
 *
 * ANOTHER UID SEAM, CLOSED THE SAME WAY. The legacy read was two Firestore queries,
 * `where("reviewedBy","==",uid)` and `where("assignedBy","==",uid)`, so a caller named the identity
 * whose history it wanted. Here the caller names nothing: the scope is the caller's own Principal.
 *
 * It requires the QUEUE reach (reorder.request.read + REORDER_QUEUE scope) rather than the OWN reach, and that is
 * deliberate -- a caller with queue reach may already read every one of these rows, so narrowing to their own actions
 * grants nothing new. The own reach would have stretched "assigned to me" to mean "acted on by me".
 */
export async function readMyReorderHistory(
  deps: { readonly pool: Pool }, actor: ReorderActor,
): Promise<readonly ReorderQueueItem[]> {
  requireActor(actor, REORDER_READ);
  const reachKeys = await requireQueueReach(deps.pool, actor);
  const [{ rows }, mine] = await Promise.all([
    deps.pool.query(
      `${QUEUE_SELECT}
        WHERE r.tenant_id = $1
          AND (r.reviewed_by_principal_id = $2 OR a.assigned_by_principal_id = $2)
          AND r.operating_company_key = ANY($3::text[])
        ORDER BY r.created_at DESC, r.id`,
      [actor.tenantId, actor.principalId, reachKeys]),
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
  // The OWN reach: this read returns only records actively assigned to the caller's Employee (below).
  requireActor(actor, REORDER_READ);
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
