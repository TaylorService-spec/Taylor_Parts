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
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
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

export type CreateCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "FORBIDDEN" | "UNAVAILABLE";

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
}

/** Fields a client may state. Anything else is a forgery attempt, not a mistake to tolerate. */
const ACCEPTED_INPUT = Object.freeze([
  "customerId", "locationId", "workOrderType", "priority", "equipmentId", "severity", "complaint", "salesOrderId",
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
  if (!NATIVE_WORK_ORDER_TYPES.includes(input.workOrderType)) {
    refuse("WORK_ORDER_TYPE_INVALID", "INVALID_INPUT",
      `'${String(input.workOrderType)}' is not a native Work Order type (${NATIVE_WORK_ORDER_TYPES.join(", ")}). `
      + "Legacy SERVICE was normalized for MIGRATION only and is not creatable.");
  }
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 4) {
    refuse("PRIORITY_INVALID", "INVALID_INPUT", "priority is a governed 1-4");
  }

  const now = (deps.now ?? (() => new Date()))();
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

    const allocated = await allocateWorkOrderNumber(client, actor.tenantId, now);
    const workOrderId = `wo_${randomUUID()}`;

    await client.query(
      `INSERT INTO ${SCHEMA}.work_orders
         (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
          severity, customer_id, location_id, equipment_id, sales_order_id, complaint,
          provenance, created_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::${SCHEMA}.ops_work_order_status,$6::${SCHEMA}.ops_work_order_type,$7,
               $8::${SCHEMA}.ops_work_order_severity,$9,$10,$11,$12,$13,'NATIVE',$14,$15,$15)`,
      [workOrderId, actor.tenantId, operatingCompanyKey, allocated.number, INITIAL_STATUS,
       input.workOrderType, input.priority, input.severity ?? null, input.customerId, input.locationId,
       input.equipmentId ?? null, input.salesOrderId ?? null, input.complaint ?? null,
       actor.principalId, now]);

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
      createdAt: now.toISOString(), transitionId,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}

export { WORK_ORDER_STATUSES };
