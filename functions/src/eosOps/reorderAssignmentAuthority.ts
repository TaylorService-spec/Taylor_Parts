// REORDER ASSIGNMENT IDENTITY -- the governed command that assigns a Reorder Request to an EMPLOYEE.
//
// ════════════════════ THE SEAM THIS CLOSES ════════════════════
//
// The legacy path stores a Firebase Auth uid in `assignedToUserId` and authorizes the assignee's later actions with
// `request.auth.uid == assignedToUserId`. That answers "who is logged in" where the business question is "which
// Employee is assigned this work". The governed model already separates the two:
//
//   external identity  ->  Principal  ->  Employee
//
// ASSIGNMENT BELONGS TO THE EMPLOYEE. Authentication and authorization belong to the Principal. So the assignee is
// an Employee id and the Principal appears only as the actor who performed the assignment -- two columns, because
// they are two concepts.
//
// ════════════════════ THE OWN-ASSIGNMENT COMPARISON ════════════════════
//
// `isCallerTheAssignedEmployee` compares EMPLOYEE IDENTITY TO EMPLOYEE IDENTITY, resolved server-side:
//
//   caller's Principal -> its ACTIVE governed Employee link -> caller's Employee id  ==  assigned Employee id
//
// It never compares a Firebase uid, a Principal id or an external subject to an Employee id. A Principal with no
// active Employee link is REFUSED rather than matched: "not linked" is not "everyone", and an Employee can never be
// inferred from a uid.
//
// IT NARROWS, NEVER GRANTS. The predicate answers only "is the caller the assignee". A caller must still hold the
// operation's own capability; being the assignee supplies none, and holding the capability does not satisfy an
// own-assignment condition where one is required. Same shape as the isOwnAssignment evaluator parity.
//
// ════════════════════ NOTHING HERE IS CALLER-SUPPLIED ════════════════════
//
// The command accepts a Reorder Request id and an Employee id. It accepts NO uid, NO Principal id as assignee, NO
// tenant, NO Security Role, NO operationalRoles, NO Job Role and no precomputed authorization result -- there is no
// input shaped like one, and `acceptOnly` refuses unknown fields rather than ignoring them. Tenant, actor and
// capability come from the resolved context.
//
// ════════════════════ INERT UNTIL ACTIVATED ════════════════════
//
// Building this authority is not cutting over to it. No client calls it yet, the Firestore path is still the live
// writer, and this module deliberately performs NO Firestore write -- introducing a dual write "for safety" is the
// one thing a migration must never do. Moving the writer, and the assignee-only actions that still read
// `assignedToUserId`, is a separate reviewed step.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/** The EXISTING capability for this action (access/permissionCatalog.ts). Not a new one invented for the seam. */
export const REORDER_REQUEST_ASSIGN = "reorder.request.assign";

/**
 * The Work Eligibility this business operation requires, fixed by the operation.
 *
 * Not a caller input and not configurable: a client that could choose the qualification could choose one nobody
 * needs. Parts/Warehouse assignment is CASE A, so no Operational Scope is required -- the proven workflow is not
 * warehouse-specific, and the authority supporting scope is not a reason to demand it.
 */
export const REORDER_ASSIGNMENT_QUALIFICATION = "WAREHOUSE_OPERATIONS";

/** Provenance of an assignment row, matching the eos_ops convention. A live command only ever writes NATIVE. */
export const NATIVE_ASSIGNMENT_PROVENANCE = "NATIVE";

/**
 * The statuses a Reorder Request may be assigned from.
 *
 * READY_FOR_PARTS_MANAGER is the first assignment; ASSIGNED_TO_PARTS_ASSOCIATE is a reassignment,
 * which is a real business action and not an error. Anything later is deliberately excluded --
 * reassigning work that is already ordered or received does not move the work, it rewrites history.
 */
export const ASSIGNABLE_REORDER_STATUSES = Object.freeze([
  "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE",
] as const);

export type ReorderAssignmentErrorCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "FAILED";

export class ReorderAssignmentError extends Error {
  constructor(readonly code: string, readonly category: ReorderAssignmentErrorCategory, message: string) {
    super(message);
    this.name = "ReorderAssignmentError";
  }
}
const refuse = (code: string, category: ReorderAssignmentErrorCategory, message: string): never => {
  throw new ReorderAssignmentError(code, category, message);
};

export interface ReorderAssignmentActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR, never the assignee. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input!).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return input!;
}

export interface ReorderAssignmentResult {
  readonly outcome: "ASSIGNED" | "REASSIGNED" | "NO_CHANGE";
  readonly reorderRequestId: string;
  readonly assignedEmployeeId: string;
  readonly assignmentId: string;
  readonly endedAssignmentId: string | null;
}

/**
 * Assign a Reorder Request to an Employee.
 *
 * ONE transaction: capability -> active Principal and membership -> lock the current assignment -> the Employee
 * must exist in the ACTOR's tenant and be currently assignable -> same Employee is NO_CHANGE -> end the prior
 * assignment -> insert the new one -> one audit event naming the EOS Principal -> commit. Any failure, the audit
 * insert included, rolls back every effect.
 */
export async function assignReorderRequestToEmployee(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReorderAssignmentActor,
  input: Record<string, unknown>,
): Promise<ReorderAssignmentResult> {
  let client: PoolClient | undefined;
  try {
    if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
      refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
    }
    if (!actor.capabilities.has(REORDER_REQUEST_ASSIGN)) {
      refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${REORDER_REQUEST_ASSIGN}`);
    }
    const i = acceptOnly(input, ["reorderRequestId", "employeeId", "reason"]);
    if (!ID_SHAPE(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
    if (!ID_SHAPE(i.employeeId)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
    const reason = i.reason === undefined || i.reason === null ? null : i.reason;
    if (reason !== null && (typeof reason !== "string" || reason.trim() === "" || reason.trim() !== reason || reason.length > 500)) {
      refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 500 characters");
    }
    const reorderRequestId = i.reorderRequestId as string;
    const employeeId = i.employeeId as string;

    client = await deps.pool.connect();
    await client.query("BEGIN");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");

    // The Employee must exist IN THE ACTOR'S TENANT. A foreign-tenant Employee, a Principal id or a uid passed here
    // is simply NOT_FOUND -- the tenant boundary is not something a caller can name its way across.
    const employee = await client.query(
      `SELECT employment_status::text AS status FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
      [actor.tenantId, employeeId],
    );
    if (employee.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
    // THE GOVERNED ASSIGNABILITY POLICY, ENFORCED HERE. The picker is a discovery experience; this command is the
    // business boundary. Both CONSUME the same single authority -- the read uses eos_workforce.employee_work_eligibility
    // to SHOW valid candidates, and this uses it to REFUSE an invalid submitted one. That is one authority with two
    // consumers, not two authorities: leaving the check to the picker would make a client the only enforcement, so a
    // caller holding reorder.request.assign could bypass it and submit any ACTIVE linked Employee.
    if (employee.rows[0].status !== "ACTIVE") {
      refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED", "only an ACTIVE Employee may be assigned work");
    }
    const linked = await client.query(
      `SELECT 1 FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`,
      [actor.tenantId, employeeId],
    );
    if (linked.rows.length === 0) {
      refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED", "the Employee has no active governed login and cannot be assigned work");
    }
    // QUALIFICATION. Fixed by the business operation, never selected by the caller: there is deliberately no
    // qualificationCode input, because "which qualification does Reorder assignment require" is not a client's
    // question. Parts/Warehouse assignment is CASE A, so warehouse scope is NOT required -- the currently proven
    // workflow is not warehouse-specific, and requiring scope here would narrow it.
    const qualified = await client.query(
      `SELECT 1 FROM eos_workforce.employee_work_eligibility
        WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL`,
      [actor.tenantId, employeeId, REORDER_ASSIGNMENT_QUALIFICATION],
    );
    if (qualified.rows.length === 0) {
      refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
        `the Employee does not currently hold the ${REORDER_ASSIGNMENT_QUALIFICATION} qualification`);
    }

    // ════════ THE REORDER OBJECT, NOW THAT POSTGRESQL OWNS IT ════════
    //
    // When this authority was built the Reorder lived in Firestore, so `reorder_request_id` was
    // necessarily opaque -- there was no row here to point at. The domain cutover moved the object,
    // and an assignment to a Reorder this tenant does not have is no longer a reference nobody can
    // check: it is simply wrong, so it is refused.
    //
    // Assigning also ADVANCES THE STATUS, in this same transaction. The legacy client did both in
    // one client-side write (inventoryReorderRequests.js set status and currentOwner alongside the
    // assignee), and splitting them across two commands would let a Reorder sit assigned-but-not-
    // advanced, which is a state the lifecycle has no name for.
    const target = await client.query(
      `SELECT status::text AS status FROM eos_ops.reorder_requests
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, reorderRequestId],
    );
    if (target.rows.length === 0) {
      refuse("REORDER_NOT_FOUND", "NOT_FOUND", "the Reorder Request does not exist in this tenant");
    }
    const targetStatus = target.rows[0].status as string;
    if (!(ASSIGNABLE_REORDER_STATUSES as readonly string[]).includes(targetStatus)) {
      refuse("REORDER_NOT_ASSIGNABLE", "PRECONDITION_FAILED",
        `a Reorder Request in ${targetStatus} is not awaiting assignment`);
    }

    const { rows } = await client.query(
      `SELECT id, assigned_employee_id FROM eos_ops.reorder_request_assignments
        WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL FOR UPDATE`,
      [actor.tenantId, reorderRequestId],
    );
    const current = rows[0] as { id: string; assigned_employee_id: string } | undefined;
    const at = deps.now?.() ?? new Date();
    if (current && current.assigned_employee_id === employeeId) {
      await client.query("COMMIT");
      return Object.freeze({ outcome: "NO_CHANGE" as const, reorderRequestId, assignedEmployeeId: employeeId, assignmentId: current.id, endedAssignmentId: null });
    }
    if (current) {
      await client.query(
        `UPDATE eos_ops.reorder_request_assignments SET effective_to = $3, ended_by_principal_id = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
        [actor.tenantId, current.id, at, actor.principalId],
      );
    }
    const id = `rra_${randomUUID()}`;
    await client.query(
      `INSERT INTO eos_ops.reorder_request_assignments
         (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, actor.tenantId, reorderRequestId, employeeId, at, NATIVE_ASSIGNMENT_PROVENANCE, actor.principalId, reason],
    );
    // The status moves with the assignment, and updated_by records the Principal who did it.
    await client.query(
      `UPDATE eos_ops.reorder_requests
          SET status = 'ASSIGNED_TO_PARTS_ASSOCIATE', updated_by = $3, updated_at = $4
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, reorderRequestId, actor.principalId, at],
    );
    await client.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, 'reorderRequest.assign', $3, 'reorderRequest', $4, $5, $6, $7, $8)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, reorderRequestId,
        current ? JSON.stringify({ assignedEmployeeId: current.assigned_employee_id, assignmentId: current.id }) : null,
        JSON.stringify({ assignedEmployeeId: employeeId, assignmentId: id }), at, reason],
    );
    await client.query("COMMIT");
    return Object.freeze({
      outcome: current ? ("REASSIGNED" as const) : ("ASSIGNED" as const),
      reorderRequestId, assignedEmployeeId: employeeId, assignmentId: id, endedAssignmentId: current?.id ?? null,
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof ReorderAssignmentError) throw err;
    if ((err as { code?: string })?.code === "23505") {
      throw new ReorderAssignmentError("REORDER_ASSIGNMENT_CONCURRENT_CHANGE", "CONFLICT", "the assignment changed concurrently; retry");
    }
    throw new ReorderAssignmentError("COMMAND_FAILED", "FAILED", "the command could not be completed");
  } finally {
    client?.release();
  }
}

export interface AssignedEmployeeRead {
  readonly reorderRequestId: string;
  readonly assignedEmployeeId: string | null;
}

/** Who is currently assigned. Null when nobody is -- an unassigned request is a real answer, not an error. */
export async function readAssignedEmployee(
  pool: Pool, tenantId: string, reorderRequestId: string,
): Promise<AssignedEmployeeRead> {
  const { rows } = await pool.query(
    `SELECT assigned_employee_id FROM eos_ops.reorder_request_assignments
      WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL`,
    [tenantId, reorderRequestId],
  );
  return Object.freeze({ reorderRequestId, assignedEmployeeId: (rows[0]?.assigned_employee_id as string | undefined) ?? null });
}

/**
 * Is the CALLER the assigned Employee?
 *
 * EMPLOYEE IDENTITY TO EMPLOYEE IDENTITY. The caller's Employee is resolved server-side from their Principal's
 * ACTIVE governed link; a Principal with no active link is refused rather than matched, and no uid, external
 * subject or Principal id is ever compared to an Employee id.
 *
 * It NARROWS an already-held capability and grants nothing on its own.
 */
export async function isCallerTheAssignedEmployee(
  // A Pool OR a PoolClient: an authorization decision made outside the transaction that acts on it
  // can be overtaken between the check and the write, so every caller inside a transaction passes
  // its own client and reads the same snapshot it is about to write against.
  pool: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  tenantId: string, callerPrincipalId: string, reorderRequestId: string,
): Promise<boolean> {
  if (!ID_SHAPE(tenantId) || !ID_SHAPE(callerPrincipalId) || !ID_SHAPE(reorderRequestId)) return false;
  const { rows } = await pool.query(
    `SELECT l.employee_id AS caller_employee_id, a.assigned_employee_id
       FROM eos_policy.employee_principal_links l
       JOIN eos_ops.reorder_request_assignments a
         ON a.tenant_id = l.tenant_id AND a.reorder_request_id = $3 AND a.effective_to IS NULL
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`,
    [tenantId, callerPrincipalId, reorderRequestId],
  );
  const row = rows[0];
  if (!row) return false;
  return row.caller_employee_id === row.assigned_employee_id;
}
