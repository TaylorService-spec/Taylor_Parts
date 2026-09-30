// THE GOVERNED WORK ORDER ASSIGNMENT AUTHORITY.
//
// ONE transaction per command: capability -> actor is an active Principal and tenant member -> lock
// the Work Order -> lifecycle precondition -> the Employee is assignable -> close the current
// interval -> open the new one -> record the transition -> commit. Any failure rolls back every
// effect, the transition row included.
//
// ════════════════════ WHAT THE ASSIGNEE IS, AND WHAT IT IS NOT ════════════════════
//
// THE ASSIGNEE IS AN EMPLOYEE. Not a `fieldops_technicians` document id, not a Firebase uid, not a
// Principal, and not a Security Role. The legacy model identified the technician by how they logged
// in (`users/{uid}.technicianId`), which made the business fact "who is doing this job" depend on a
// credential -- so re-provisioning someone's login silently changed who the work belonged to.
//
// THE ACTOR IS A PRINCIPAL, and it is never the assignee. Assigning work to yourself is a legitimate
// action, and it is still two identities in one transaction.
//
// ════════════════════ ELIGIBILITY IS WORK ELIGIBILITY, AND NOTHING ELSE ════════════════════
//
// A technician is eligible because they hold the SERVICE_TECHNICIAN Work Eligibility qualification.
// NOT because of a Job Role, NOT because of a Security Role, NOT because of a legacy
// `operationalRoles` string, and NOT because a `fieldops_technicians` document says `available`.
//
// Those four are different authorities answering different questions:
//   Security Role      what may this PRINCIPAL do in the system
//   Job Role           what is this EMPLOYEE'S position in the business
//   Work Eligibility   what kind of work may this EMPLOYEE be given
//   Operational Scope  where may they do it
//
// Assignment asks only the third. Using any of the others would make a permission decide a business
// fact, or a business fact decide a permission.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { OperatingCompanyBindingError, resolveActiveOperatingCompanyId } from "./operatingCompanyBinding";
import { isQuarantined, WORK_ORDER_QUARANTINED, WORK_ORDER_QUARANTINED_MESSAGE } from "./workOrderQuarantine";

/** Already in the Role catalog; this command does not invent a capability. */
export const WORK_ORDER_ASSIGN = "workOrder.lifecycle.dispatch";
/** The one qualification Work Order assignment asks for. Fixed by the operation, never by the caller. */
export const WORK_ORDER_ASSIGNMENT_QUALIFICATION = "SERVICE_TECHNICIAN";
export const NATIVE_PROVENANCE = "NATIVE";

/**
 * The employment statuses a Work Order may be assigned to (Controller rulings DQ-007 / DQ-012,
 * 2026-09-28): ACTIVE and CONTRACTOR, and nothing else. A CONTRACTOR technician is assignable when every
 * other prerequisite holds -- active governed login, SERVICE_TECHNICIAN eligibility, the Work Order's
 * operating company. Status is never the only disqualification of a contractor.
 */
export const WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES = Object.freeze(["ACTIVE", "CONTRACTOR"] as const);

/**
 * The statuses a Work Order may be assigned from.
 *
 * Schedule (from READY_TO_DISPATCH) and re-assignment of an already scheduled job. Deliberately NOT
 * the executing statuses: moving a job someone has already travelled to or started is not a
 * reassignment, it is a different business action nobody has ruled on.
 */
export const ASSIGNABLE_WORK_ORDER_STATUSES = Object.freeze([
  "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED",
] as const);

export type WorkOrderAssignmentCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "FAILED";

export class WorkOrderAssignmentError extends Error {
  constructor(readonly code: string, readonly category: WorkOrderAssignmentCategory, message: string) {
    super(message);
    this.name = "WorkOrderAssignmentError";
  }
}
const refuse = (code: string, category: WorkOrderAssignmentCategory, message: string): never => {
  throw new WorkOrderAssignmentError(code, category, message);
};

export interface WorkOrderActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR, never the assignee. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

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

export type AssignmentSource = "SCHEDULE" | "DISPATCH_REASSIGN" | "RESCHEDULE" | "REASSIGN_SCHEDULED";

export interface WorkOrderAssignmentResult {
  readonly outcome: "ASSIGNED" | "REASSIGNED" | "NO_CHANGE";
  readonly workOrderId: string;
  readonly assigneeEmployeeId: string;
  readonly assignmentId: string;
  readonly endedAssignmentId: string | null;
}

/**
 * Assign (or reassign) a Work Order to an Employee.
 *
 * A reassignment to the SAME Employee is NO_CHANGE: it writes nothing and ends nothing, because an
 * interval that closed and reopened on the same person would be a history of an event that did not
 * happen.
 */
export async function assignWorkOrderToEmployee(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: WorkOrderActor,
  input: Record<string, unknown>,
): Promise<WorkOrderAssignmentResult> {
  let client: PoolClient | undefined;
  try {
    if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
      refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
    }
    if (!actor.capabilities.has(WORK_ORDER_ASSIGN)) {
      refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${WORK_ORDER_ASSIGN}`);
    }
    const i = acceptOnly(input, ["workOrderId", "employeeId", "source", "reason"]);
    if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
    if (!ID_SHAPE(i.employeeId)) {
      refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
    }
    const source = i.source as AssignmentSource;
    if (!["SCHEDULE", "DISPATCH_REASSIGN", "RESCHEDULE", "REASSIGN_SCHEDULED"].includes(source)) {
      refuse("SOURCE_INVALID", "INVALID_INPUT", "source must name the governed command that caused this assignment");
    }
    const reason = i.reason === undefined || i.reason === null ? null : i.reason;
    if (reason !== null && (typeof reason !== "string" || reason.trim() === "" || reason.length > 500)) {
      refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a non-empty string of at most 500 characters");
    }
    // A REASSIGNMENT STATES WHY; a first assignment need not. The schema requires it too, and a
    // constraint violation would report a constraint name rather than the reason.
    if (source !== "SCHEDULE" && reason === null) {
      refuse("REASON_REQUIRED", "INVALID_INPUT", "a reassignment states why");
    }

    const workOrderId = i.workOrderId as string;
    const employeeId = i.employeeId as string;

    client = await deps.pool.connect();
    await client.query("BEGIN");
    const result = await assignWithinTransaction(client, actor,
      { workOrderId, employeeId, source, reason: reason as string | null }, deps.now?.() ?? new Date());
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof WorkOrderAssignmentError) throw err;
    if ((err as { code?: string })?.code === "23505") {
      throw new WorkOrderAssignmentError("WORK_ORDER_ASSIGNMENT_CONCURRENT_CHANGE", "CONFLICT",
        "the assignment changed concurrently; retry");
    }
    throw new WorkOrderAssignmentError("COMMAND_FAILED", "FAILED", "the command could not be completed");
  } finally {
    client?.release();
  }
}

/**
 * The assignment itself, INSIDE a transaction the caller owns. The capability is the CALLER's check: the
 * governed Schedule command assigns under workOrder.lifecycle.schedule and Dispatch under
 * workOrder.lifecycle.dispatch, and each composes this into the one transaction that also moves the status,
 * so the placement, the assignee and the transition commit together or not at all. Every other rule --
 * tenant membership, the Work Order's assignable status, DQ-007/DQ-012/DQ-013 Employee eligibility, one
 * current interval -- is enforced here and nowhere else, so no path can assign by a weaker rule.
 */
export async function assignWithinTransaction(
  client: PoolClient,
  actor: WorkOrderActor,
  input: { readonly workOrderId: string; readonly employeeId: string; readonly source: AssignmentSource; readonly reason: string | null },
  at: Date,
): Promise<WorkOrderAssignmentResult> {
  const { workOrderId, employeeId, source, reason } = input;

  const member = await client.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
    [actor.tenantId, actor.principalId],
  );
  if (member.rows.length === 0) {
    refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
  }

  // LOCK THE WORK ORDER FIRST. Everything downstream decides against this row, and a concurrent
  // transition must not be able to move the lifecycle out from under the assignment.
  const wo = await client.query(
    `SELECT status::text AS status, operating_company_key FROM eos_ops.work_orders
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [actor.tenantId, workOrderId],
  );
  if (wo.rows.length === 0) {
    refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
  }
  if (await isQuarantined(client, actor.tenantId, workOrderId)) {
    refuse(WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", WORK_ORDER_QUARANTINED_MESSAGE);
  }
  const status = wo.rows[0].status as string;
  if (!(ASSIGNABLE_WORK_ORDER_STATUSES as readonly string[]).includes(status)) {
    refuse("WORK_ORDER_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
      `a Work Order in ${status} is not awaiting assignment`);
  }

  // The Employee must exist IN THE ACTOR'S TENANT. A foreign-tenant Employee, a Principal id, a
  // uid or a technician id passed here is simply NOT_FOUND -- the tenant boundary is not something
  // a caller can name its way across.
  await assertEmployeeAssignable(client, actor.tenantId, employeeId, wo.rows[0].operating_company_key);

  const { rows } = await client.query(
    `SELECT id, assignee_employee_id FROM eos_ops.work_order_assignments
      WHERE tenant_id = $1 AND work_order_id = $2 AND effective_to IS NULL FOR UPDATE`,
    [actor.tenantId, workOrderId],
  );
  const current = rows[0] as { id: string; assignee_employee_id: string } | undefined;

  if (current && current.assignee_employee_id === employeeId) {
    // Nothing happened, so nothing is recorded. An interval that closed and reopened on the same
    // person would be a history of an event nobody performed.
    return Object.freeze({
      outcome: "NO_CHANGE" as const, workOrderId, assigneeEmployeeId: employeeId,
      assignmentId: current.id, endedAssignmentId: null,
    });
  }

  if (current) {
    await client.query(
      `UPDATE eos_ops.work_order_assignments
          SET effective_to = $3, end_source = $4, end_reason = $5, ended_by_principal_id = $6
        WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
      [actor.tenantId, current.id, at, source, reason, actor.principalId],
    );
  }

  const id = `woa_${randomUUID()}`;
  await client.query(
    `INSERT INTO eos_ops.work_order_assignments
       (id, tenant_id, work_order_id, assignee_employee_id, source, reason, effective_from,
        assigned_by_principal_id, provenance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, actor.tenantId, workOrderId, employeeId, source, reason, at, actor.principalId, NATIVE_PROVENANCE],
  );

  // The assignment IS the history, so there is no separate audit event to write. What the
  // transition log records is the LIFECYCLE, and assignment does not move the lifecycle by itself.
  await client.query(
    `UPDATE eos_ops.work_orders SET updated_by_principal_id = $3, updated_at = $4
      WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, workOrderId, actor.principalId, at],
  );

  return Object.freeze({
    outcome: current ? ("REASSIGNED" as const) : ("ASSIGNED" as const),
    workOrderId, assigneeEmployeeId: employeeId, assignmentId: id,
    endedAssignmentId: current?.id ?? null,
  });
}

/**
 * Is this Employee assignable to a Work Order of this operating company RIGHT NOW? Employment status
 * (DQ-007 / DQ-012), the Work Order's governed company (DQ-013), an active governed login, and the current
 * SERVICE_TECHNICIAN Work Eligibility. Dispatch re-asks it of the Employee already assigned, because a
 * status can change between Schedule and Dispatch.
 */
export async function assertEmployeeAssignable(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  workOrderCompanyKey: string,
): Promise<void> {
  const employee = await client.query(
    `SELECT employment_status::text AS status, operating_company_id FROM eos_workforce.employees
      WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
    [tenantId, employeeId],
  );
  if (employee.rows.length === 0) {
    refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
  }
  if (!(WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES as readonly string[]).includes(employee.rows[0].status)) {
    refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
      "only an ACTIVE or CONTRACTOR Employee may be assigned work");
  }

  // THE WORK ORDER'S OPERATING COMPANY (Controller ruling DQ-013). The assignee must be eligible for the
  // company that performs this Work Order. The company is READ from the governed key binding of the Work
  // Order's own operating_company_key -- never inferred from the customer, the actor or the Employee, and
  // never rewritten. An unbound or inactive key fails closed; so does a mismatch.
  let workOrderCompanyId: string;
  try {
    workOrderCompanyId = await resolveActiveOperatingCompanyId(client, tenantId, workOrderCompanyKey);
  } catch (err) {
    if (err instanceof OperatingCompanyBindingError) {
      refuse("WORK_ORDER_OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED",
        "the Work Order's operating company is not bound to an ACTIVE governed company; nothing is inferred");
    }
    throw err;
  }
  if (employee.rows[0].operating_company_id !== workOrderCompanyId!) {
    refuse("EMPLOYEE_NOT_ELIGIBLE_FOR_OPERATING_COMPANY", "PRECONDITION_FAILED",
      "the Employee is not eligible for the Work Order's operating company");
  }

  // THE ACCOUNT PREDICATE: work is assigned only to an Employee with an ACTIVE governed login. It is
  // the third of the three governed assignability predicates (lifecycle, qualification, account --
  // the governed assignable-Employee read, assignableEmployeeReads.ts), and Reorder assignment enforces it at its own
  // command boundary for the same reason this one does: a picker is discovery, not enforcement.
  // Without it a caller holding the capability could assign a job to an Employee who can never sign
  // in to accept it -- RECORD_ASSIGNMENT would then refuse the technician with EMPLOYEE_LINK_REQUIRED
  // forever, and the job would sit on a schedule nobody can act on. A REVOKED link is not a login.
  const linked = await client.query(
    `SELECT 1 FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`,
    [tenantId, employeeId],
  );
  if (linked.rows.length === 0) {
    refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
      "the Employee has no active governed login and cannot be assigned work");
  }

  // THE QUALIFICATION, ENFORCED BY THE COMMAND. Not by the picker: a picker is a discovery
  // experience, and leaving the check there would make a client the only enforcement, so a caller
  // holding the capability could submit any ACTIVE Employee.
  const qualified = await client.query(
    `SELECT 1 FROM eos_workforce.employee_work_eligibility
      WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL`,
    [tenantId, employeeId, WORK_ORDER_ASSIGNMENT_QUALIFICATION],
  );
  if (qualified.rows.length === 0) {
    refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
      `the Employee does not currently hold the ${WORK_ORDER_ASSIGNMENT_QUALIFICATION} qualification`);
  }

}

/**
 * Is the CALLER the Employee this Work Order is assigned to?
 *
 * EMPLOYEE COMPARED TO EMPLOYEE. The caller resolves to an Employee through an ACTIVE
 * employee_principal_link; no uid, technician id or Principal id is ever compared to an Employee id.
 *
 * It NARROWS an already-held capability and grants nothing on its own.
 */
export async function isCallerTheAssignedEmployee(
  pool: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  tenantId: string, callerPrincipalId: string, workOrderId: string,
): Promise<boolean> {
  if (!ID_SHAPE(tenantId) || !ID_SHAPE(callerPrincipalId) || !ID_SHAPE(workOrderId)) return false;
  const { rows } = await pool.query(
    `SELECT l.employee_id AS caller_employee_id, a.assignee_employee_id
       FROM eos_policy.employee_principal_links l
       JOIN eos_ops.work_order_assignments a
         ON a.tenant_id = l.tenant_id AND a.work_order_id = $3 AND a.effective_to IS NULL
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`,
    [tenantId, callerPrincipalId, workOrderId],
  );
  const row = rows[0];
  if (!row) return false;
  return row.caller_employee_id === row.assignee_employee_id;
}
