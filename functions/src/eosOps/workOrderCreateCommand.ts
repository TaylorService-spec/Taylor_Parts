// THE NATIVE POSTGRESQL WORK ORDER CREATE COMMAND.
//
// ════════════════════ WHAT A CALLER MAY STATE, AND WHAT IT MAY NOT ════════════════════
//
// The split is the whole design. A field existing in a request is not authority to write it, and the
// legacy path is the argument: createWorkOrder authorized on `caller.role` and identified technicians by
// `caller.technicianId`, so the client's own view of who it was decided what it could do.
//
//   CLIENT-SUPPLIED BUSINESS INPUT   customer, location, equipment, type, priority, severity,
//                                    complaint, scheduling intent, Sales Order lineage
//   SERVER-AUTHORED GOVERNED FACTS   id, work order number, tenant, operating company KEY, status,
//                                    provenance, createdBy Principal, timestamps, transition evidence
//
// Anything in the second list that arrives in a request is REFUSED -- not ignored. Ignoring teaches a
// caller that sending it is fine, and one day a code path reads it.
//
// ════════════════════ OPERATING COMPANY ════════════════════
//
// The company is stated by the authorized command context or inherited from a governed upstream that
// already carries one. It is NEVER inferred from the customer, the location, the creator, the tenant or
// the Work Order type -- each of those is a thing this Work Order is ABOUT, not a statement of which
// business performs it. The KEY then comes from the shared binding authority, never from the id.
//
// Ventana is ACTIVE for the tenant with no key binding today, so a native Ventana Work Order fails
// closed with OPERATING_COMPANY_KEY_NOT_BOUND. That is the model working, not a gap to paper over.
import { serviceProviderAuthorized } from "../eosCommercial/fulfillment/serviceProviderAuthorization";
import type { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { resolveOperatingCompanyKeyForCompany } from "./operatingCompanyBinding.js";
import { allocateWorkOrderNumber } from "./workOrderNumbering.js";
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from "./workOrderLifecycle.js";

const SCHEMA = "eos_ops";

/** Already in the catalog; this command invents no capability. */
export const WORK_ORDER_CREATE = "workOrder.create";

/** The NATIVE vocabulary. Legacy `SERVICE` is migration-only and is not a member. */
export const NATIVE_WORK_ORDER_TYPES: readonly string[] =
  Object.freeze(["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"]);

/** Every status a native Work Order may START in. Creation does not skip the lifecycle. */
export const INITIAL_STATUS: WorkOrderStatus = "CREATED";

export type CreateCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE";

export class WorkOrderCreateError extends Error {
  constructor(readonly code: string, readonly category: CreateCategory, message: string) {
    super(message);
    this.name = "WorkOrderCreateError";
  }
}
const refuse = (code: string, category: CreateCategory, message: string): never => {
  throw new WorkOrderCreateError(code, category, message);
};

export interface CreateActor {
  readonly tenantId: string;
  /** The EOS Principal id -- the audit actor. Never an Employee id, never a Firebase uid. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
  /**
   * The operating company this authorized context acts for. Governed input, not an inference: the
   * command refuses rather than deriving one from anything else it can see.
   */
  readonly operatingCompanyId: string;
}

export interface CreateWorkOrderInput {
  readonly customerId: string;
  readonly locationId: string;
  readonly workOrderType: string;
  readonly priority: number;
  readonly equipmentId?: string;
  readonly severity?: string;
  readonly complaint?: string;
  readonly salesOrderId?: string;
  /**
   * DQ-015 (DECISIONS #195): the Sales Order LINE NUMBERS this job fulfils -- explicit, so a completion can say exactly what
   * it fulfilled. Requires salesOrderId; validated against the governed Sales Order (company, customer, site, state, lines).
   */
  readonly salesOrderLines?: readonly number[];
  /** Optional: a retry carrying the same key replays the Work Order it already created (never a duplicate). */
  readonly idempotencyKey?: string;
}

/** Fields a client may state. Anything else is a forgery attempt, not a mistake to tolerate. */
const ACCEPTED_INPUT = Object.freeze([
  "customerId", "locationId", "workOrderType", "priority", "equipmentId", "severity", "complaint", "salesOrderId",
  "salesOrderLines", "idempotencyKey",
]);

/** Named so the refusal can say WHICH governed fact was being forged. */
const SERVER_AUTHORED = Object.freeze([
  "id", "workOrderId", "workOrderNumber", "woNumber", "tenantId", "operatingCompanyKey", "operatingCompanyId",
  "status", "provenance", "createdBy", "createdByPrincipalId", "createdAt", "updatedAt",
  "completedAt", "closedAt", "dispatchedAt", "acceptedAt", "enRouteAt", "arrivedAt",
]);

export interface CreatedWorkOrder {
  readonly workOrderId: string;
  readonly workOrderNumber: string;
  readonly status: WorkOrderStatus;
  readonly operatingCompanyId: string;
  readonly operatingCompanyKey: string;
  readonly provenance: "NATIVE";
  readonly createdByPrincipalId: string;
  readonly createdAt: string;
  readonly transitionId: string;
  /** True when an earlier create with the same idempotencyKey is returned instead of a new Work Order. */
  readonly replayed: boolean;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/**
 * Create a governed Work Order.
 *
 * ONE TRANSACTION. The Work Order, its number and its opening transition commit together or not at all:
 * a Work Order with no number, or with no history saying it was created, is not a valid record, and no
 * follow-up client call is required to make it one.
 *
 * IT IS CREATED UNASSIGNED, deliberately. The schema does not require an assignment and the business
 * schedules after creating, so inventing assignment as a prerequisite would be adding a rule nobody has.
 */
export async function createWorkOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: CreateActor,
  input: CreateWorkOrderInput,
): Promise<CreatedWorkOrder> {
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) {
    refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  }
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(WORK_ORDER_CREATE)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `creating a Work Order requires ${WORK_ORDER_CREATE}`);
  }
  if (!ID_SHAPE(actor.operatingCompanyId)) {
    refuse("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT",
      "the operating company is stated by the authorized context or inherited from a governed upstream. "
      + "It is never inferred from the customer, the location, the creator, the tenant or the Work Order type.");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  }
  // A forged governed fact is named, not ignored.
  const forged = Object.keys(input).filter((k) => SERVER_AUTHORED.includes(k));
  if (forged.length > 0) {
    refuse("SERVER_AUTHORED_FIELD_REJECTED", "INVALID_INPUT",
      `these are established by the server and may not be supplied: ${forged.sort().join(", ")}`);
  }
  const extra = Object.keys(input).filter((k) => !ACCEPTED_INPUT.includes(k));
  if (extra.length > 0) {
    refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  }
  if (!ID_SHAPE(input.customerId)) refuse("CUSTOMER_REQUIRED", "INVALID_INPUT", "a Work Order is for a customer");
  if (!ID_SHAPE(input.locationId)) refuse("LOCATION_REQUIRED", "INVALID_INPUT", "a Work Order happens somewhere");
  if (input.equipmentId !== undefined && !ID_SHAPE(input.equipmentId)) {
    refuse("EQUIPMENT_INVALID", "INVALID_INPUT", "equipmentId, when stated, is an id");
  }
  if (input.salesOrderId !== undefined && !ID_SHAPE(input.salesOrderId)) {
    refuse("SALES_ORDER_INVALID", "INVALID_INPUT", "salesOrderId, when stated, is an id");
  }
  if (input.salesOrderLines !== undefined) {
    const l = input.salesOrderLines;
    if (input.salesOrderId === undefined) refuse("SALES_ORDER_REQUIRED", "INVALID_INPUT", "salesOrderLines names lines of a stated salesOrderId");
    if (!Array.isArray(l) || l.length === 0 || l.length > 100 || !l.every((n) => Number.isSafeInteger(n) && n > 0) || new Set(l).size !== l.length) {
      refuse("SALES_ORDER_LINES_INVALID", "INVALID_INPUT", "salesOrderLines is a non-empty list of distinct Sales Order line numbers");
    }
  }
  if (!NATIVE_WORK_ORDER_TYPES.includes(input.workOrderType)) {
    refuse("WORK_ORDER_TYPE_INVALID", "INVALID_INPUT",
      `'${String(input.workOrderType)}' is not a native Work Order type (${NATIVE_WORK_ORDER_TYPES.join(", ")}). `
      + "Legacy SERVICE was normalized for MIGRATION only and is not creatable.");
  }
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 4) {
    refuse("PRIORITY_INVALID", "INVALID_INPUT", "priority is a governed 1-4");
  }

  const key = input.idempotencyKey === undefined ? null : input.idempotencyKey;
  if (key !== null && (typeof key !== "string" || key.trim() === "" || key.length > 150 || key.trim() !== key)) {
    refuse("IDEMPOTENCY_KEY_INVALID", "INVALID_INPUT", "idempotencyKey, when stated, is a trimmed string of at most 150 characters");
  }
  const { idempotencyKey: _ignored, ...business } = input;
  const fingerprint = key === null ? null : createHash("sha256")
    .update(JSON.stringify([actor.operatingCompanyId, ...ACCEPTED_INPUT.filter((k) => k !== "idempotencyKey")
      .map((k) => (business as Record<string, unknown>)[k] ?? null)]))
    .digest("hex");

  const now = (deps.now ?? (() => new Date()))();
  if (key !== null) {
    const replay = await findPriorCreate(deps.pool, actor, key, fingerprint as string);
    if (replay) return replay;
  }
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    // THE KEY COMES FROM THE BINDING, never from the company id. Ventana is ACTIVE and unkeyed today,
    // so a native Ventana Work Order fails closed right here.
    let operatingCompanyKey: string;
    try {
      operatingCompanyKey = await resolveOperatingCompanyKeyForCompany(client, actor.tenantId, actor.operatingCompanyId);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "OPERATING_COMPANY_KEY_NOT_BOUND" || code === "OPERATING_COMPANY_KEY_AMBIGUOUS") {
        refuse(code, "UNAVAILABLE",
          `operating company '${actor.operatingCompanyId}' has no ACTIVE eos_ops key binding for this tenant. `
          + "A company may be authorized without being keyed; nothing is inferred from the company id.");
      }
      throw err;
    }

    // THE EQUIPMENT IS PROVEN, NOT ACCEPTED (Controller EQUIPMENT ACTIVATION, 2026-10-01). A picker is not integrity:
    // the stated Equipment must exist in the PostgreSQL register, be ACTIVE, and belong to THIS Work Order's operating
    // company, customer and site. Read FOR SHARE so it cannot be retired or moved under the create.
    if (input.equipmentId !== undefined) {
      const { rows: eq } = await client.query(
        `SELECT status::text AS status, operating_company_key, account_id, customer_location_id
           FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
        [actor.tenantId, input.equipmentId]);
      if (eq.length === 0) refuse("EQUIPMENT_NOT_FOUND", "NOT_FOUND", "no such Equipment in this tenant");
      const e = eq[0];
      if (e.status !== "ACTIVE") refuse("EQUIPMENT_NOT_ACTIVE", "PRECONDITION_FAILED", `the Equipment is ${String(e.status)}`);
      if (e.operating_company_key !== operatingCompanyKey) {
        refuse("EQUIPMENT_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the Equipment belongs to another operating company");
      }
      if (e.account_id !== input.customerId) refuse("EQUIPMENT_CUSTOMER_MISMATCH", "PRECONDITION_FAILED", "the Equipment belongs to another customer");
      if (e.customer_location_id !== input.locationId) refuse("EQUIPMENT_SITE_MISMATCH", "PRECONDITION_FAILED", "the Equipment is at another site");
    }

    // THE SALES ORDER IS PROVEN, NOT ACCEPTED (DQ-015, DECISIONS #195): a stated Sales Order must exist in PostgreSQL
    // Commercial, be of THIS Work Order's operating company, customer and site, and still take fulfillment; every linked line
    // must exist on it. Read FOR SHARE. A Work Order referencing a Sales Order that cannot be proven is refused -- it could
    // never complete, so creating it would only defer the failure.
    if (input.salesOrderId !== undefined) {
      const { rows: so } = await client.query(
        `SELECT state::text AS state, operating_company_key, account_id, location_id FROM eos_commercial.sales_orders
          WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, input.salesOrderId]);
      if (so.length === 0) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no such Sales Order in this tenant");
      const o = so[0];
      // FBR-F2 (#206): another company's Sales Order only under the seller's ACTIVE service-provider authorization for this
      // company and Work Order type -- the seller stays the seller; this Work Order is the service-performing company's.
      if (o.operating_company_key !== operatingCompanyKey
          && !(await serviceProviderAuthorized(client, actor.tenantId, input.salesOrderId, operatingCompanyKey, input.workOrderType))) {
        refuse("SALES_ORDER_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the Sales Order belongs to another operating company");
      }
      if (o.account_id !== input.customerId) refuse("SALES_ORDER_CUSTOMER_MISMATCH", "PRECONDITION_FAILED", "the Sales Order is for another customer");
      if (o.location_id !== null && o.location_id !== input.locationId) refuse("SALES_ORDER_SITE_MISMATCH", "PRECONDITION_FAILED", "the Sales Order is for another site");
      if (!["CONFIRMED", "IN_FULFILLMENT"].includes(o.state)) refuse("SALES_ORDER_NOT_FULFILLABLE", "PRECONDITION_FAILED", `the Sales Order is ${String(o.state)}`);
      if (input.salesOrderLines !== undefined) {
        const { rows: found } = await client.query(
          `SELECT line_number FROM eos_commercial.sales_order_lines WHERE tenant_id = $1 AND sales_order_id = $2 AND line_number = ANY($3::int[])`,
          [actor.tenantId, input.salesOrderId, input.salesOrderLines]);
        if (found.length !== input.salesOrderLines.length) refuse("SALES_ORDER_LINE_NOT_FOUND", "PRECONDITION_FAILED", "a stated line is not on the Sales Order");
      }
    }

    const allocated = await allocateWorkOrderNumber(client, actor.tenantId, now);
    const workOrderId = `wo_${randomUUID()}`;

    await client.query(
      `INSERT INTO ${SCHEMA}.work_orders
         (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
          severity, customer_id, location_id, equipment_id, sales_order_id, complaint,
          provenance, created_by_principal_id, created_at, updated_at, create_idempotency_key, create_request_fingerprint)
       VALUES ($1,$2,$3,$4,$5::${SCHEMA}.ops_work_order_status,$6::${SCHEMA}.ops_work_order_type,$7,
               $8::${SCHEMA}.ops_work_order_severity,$9,$10,$11,$12,$13,'NATIVE',$14,$15,$15,$16,$17)`,
      [workOrderId, actor.tenantId, operatingCompanyKey, allocated.number, INITIAL_STATUS,
       input.workOrderType, input.priority, input.severity ?? null, input.customerId, input.locationId,
       input.equipmentId ?? null, input.salesOrderId ?? null, input.complaint ?? null,
       actor.principalId, now, key, fingerprint]);

    for (const lineNumber of input.salesOrderLines ?? []) {
      await client.query(
        `INSERT INTO ${SCHEMA}.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id) VALUES ($1,$2,$3,$4)`,
        [actor.tenantId, workOrderId, input.salesOrderId, String(lineNumber)]);
    }

    // THE OPENING TRANSITION. from_status is NULL because nothing preceded creation, and history that
    // began only at the first move could not answer "who created this".
    const transitionId = `wot_${randomUUID()}`;
    await client.query(
      `INSERT INTO ${SCHEMA}.work_order_transitions
         (id, tenant_id, work_order_id, from_status, to_status, action, occurred_at, actor_principal_id, provenance)
       VALUES ($1,$2,$3,NULL,$4::${SCHEMA}.ops_work_order_status,'create',$5,$6,'NATIVE')`,
      [transitionId, actor.tenantId, workOrderId, INITIAL_STATUS, now, actor.principalId]);

    await client.query("COMMIT");
    return Object.freeze({
      workOrderId, workOrderNumber: allocated.number, status: INITIAL_STATUS,
      operatingCompanyId: actor.operatingCompanyId, operatingCompanyKey,
      provenance: "NATIVE" as const, createdByPrincipalId: actor.principalId,
      createdAt: now.toISOString(), transitionId, replayed: false,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    // A concurrent create with the same key won the unique index: answer with ITS Work Order.
    if (key !== null && (err as { code?: string })?.code === "23505") {
      const replay = await findPriorCreate(deps.pool, actor, key, fingerprint as string);
      if (replay) return replay;
    }
    throw err;
  } finally {
    client.release();
  }
}

/** The Work Order this Principal already created under `key`, or null. A different request under the key refuses. */
async function findPriorCreate(pool: Pool, actor: CreateActor, key: string, fingerprint: string): Promise<CreatedWorkOrder | null> {
  const { rows } = await pool.query(
    `SELECT w.id, w.work_order_number, w.operating_company_key, w.created_at, w.create_request_fingerprint,
            (SELECT t.id FROM ${SCHEMA}.work_order_transitions t
              WHERE t.tenant_id = w.tenant_id AND t.work_order_id = w.id AND t.action = 'create' LIMIT 1) AS transition_id
       FROM ${SCHEMA}.work_orders w
      WHERE w.tenant_id = $1 AND w.created_by_principal_id = $2 AND w.create_idempotency_key = $3`,
    [actor.tenantId, actor.principalId, key]);
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.create_request_fingerprint !== fingerprint) {
    refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotencyKey already created a different Work Order request");
  }
  return Object.freeze({
    workOrderId: String(r.id), workOrderNumber: String(r.work_order_number), status: INITIAL_STATUS,
    operatingCompanyId: actor.operatingCompanyId, operatingCompanyKey: String(r.operating_company_key),
    provenance: "NATIVE" as const, createdByPrincipalId: actor.principalId,
    createdAt: new Date(r.created_at).toISOString(), transitionId: String(r.transition_id), replayed: true,
  });
}

export { WORK_ORDER_STATUSES };
