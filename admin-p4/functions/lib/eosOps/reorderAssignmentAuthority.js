"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReorderAssignmentError = exports.ASSIGNABLE_REORDER_STATUSES = exports.NATIVE_ASSIGNMENT_PROVENANCE = exports.REORDER_ASSIGNMENT_QUALIFICATION = exports.REORDER_REQUEST_ASSIGN = void 0;
exports.assignReorderRequestToEmployee = assignReorderRequestToEmployee;
exports.readAssignedEmployee = readAssignedEmployee;
exports.isCallerTheAssignedEmployee = isCallerTheAssignedEmployee;
exports.listReorderAssignmentTargets = listReorderAssignmentTargets;
const node_crypto_1 = require("node:crypto");
const contextualAuthorization_js_1 = require("./contextualAuthorization.js");
/** The EXISTING capability for this action (access/permissionCatalog.ts). Not a new one invented for the seam. */
exports.REORDER_REQUEST_ASSIGN = "reorder.request.assign";
/**
 * The Work Eligibility this business operation requires, fixed by the operation.
 *
 * PARTS_OPERATIONS, BY OWNER RULING. Reorder assignment is Parts/Reorder operational work, so the qualification that
 * governs it is the Parts one. The constant previously read WAREHOUSE_OPERATIONS, which was wrong in the one way a
 * qualification can be wrong: it named a DIFFERENT kind of work. The legacy picker this command replaces
 * (field-ops-app-vite/src/shared/reorder/ManagerQueuePanel.jsx:70) filters on the legacy operationalRole
 * PARTS_ASSOCIATE, whose governed replacement is PARTS_OPERATIONS -- registered in its own right by migration
 * 1761696000000 and, in that migration's own words, "NOT WAREHOUSE_OPERATIONS".
 *
 * NO ALIAS AND NO INFERENCE. WAREHOUSE_OPERATIONS and PARTS_OPERATIONS remain distinct codes in
 * eosWorkforce/workEligibilityVocabulary.ts, neither is derived from the other, and a warehouse Employee becomes
 * assignable Reorder work only by being independently granted PARTS_OPERATIONS through the governed writer.
 *
 * NOT THE QUEUE SCOPE EITHER. REORDER_QUEUE is an Operational Scope answering "which queue may they see"; this
 * answers "may they be given this category of work". The two are separate authorities and are never collapsed --
 * see the OPERATIONAL_SCOPE predicate in eosOps/contextualAuthorization.ts.
 *
 * Not a caller input and not configurable: a client that could choose the qualification could choose one nobody
 * needs. Assignment is CASE A, so no Operational Scope is required HERE -- the proven workflow is not
 * warehouse-specific, and the authority supporting scope is not a reason to demand it.
 */
exports.REORDER_ASSIGNMENT_QUALIFICATION = "PARTS_OPERATIONS";
/** Provenance of an assignment row, matching the eos_ops convention. A live command only ever writes NATIVE. */
exports.NATIVE_ASSIGNMENT_PROVENANCE = "NATIVE";
/**
 * The statuses a Reorder Request may be assigned from. EXACTLY ONE, and that is the legacy's answer.
 *
 * firestore.rules' Assign arm requires `resource.data.status == "READY_FOR_PARTS_MANAGER"` and
 * writes ASSIGNED_TO_PARTS_ASSOCIATE. Reassigning work already assigned, or already in purchasing,
 * is not a transition the legacy ever permitted.
 *
 * Allowing it here would WIDEN ACCESS on the way through a migration -- a mid-purchasing reassignment
 * would become reachable for the first time, and the caller who gained it would have gained it from
 * a database change rather than a decision. If the business wants reassignment, that is a new
 * transition for the Owner to rule on, not a side effect of moving the object.
 */
exports.ASSIGNABLE_REORDER_STATUSES = Object.freeze(["READY_FOR_PARTS_MANAGER"]);
class ReorderAssignmentError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "ReorderAssignmentError";
    }
}
exports.ReorderAssignmentError = ReorderAssignmentError;
const refuse = (code, category, message) => {
    throw new ReorderAssignmentError(code, category, message);
};
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
function acceptOnly(input, allowed) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
    return input;
}
/**
 * Assign a Reorder Request to an Employee.
 *
 * ONE transaction: capability -> active Principal and membership -> lock the current assignment -> the Employee
 * must exist in the ACTOR's tenant and be currently assignable -> same Employee is NO_CHANGE -> end the prior
 * assignment -> insert the new one -> one audit event naming the EOS Principal -> commit. Any failure, the audit
 * insert included, rolls back every effect.
 */
async function assignReorderRequestToEmployee(deps, actor, input) {
    let client;
    try {
        if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
            refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
        }
        if (!actor.capabilities.has(exports.REORDER_REQUEST_ASSIGN)) {
            refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${exports.REORDER_REQUEST_ASSIGN}`);
        }
        const i = acceptOnly(input, ["reorderRequestId", "employeeId", "reason"]);
        if (!ID_SHAPE(i.reorderRequestId))
            refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
        if (!ID_SHAPE(i.employeeId))
            refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
        const reason = i.reason === undefined || i.reason === null ? null : i.reason;
        if (reason !== null && (typeof reason !== "string" || reason.trim() === "" || reason.trim() !== reason || reason.length > 500)) {
            refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 500 characters");
        }
        const reorderRequestId = i.reorderRequestId;
        const employeeId = i.employeeId;
        client = await deps.pool.connect();
        await client.query("BEGIN");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0)
            refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        // The Employee must exist IN THE ACTOR'S TENANT. A foreign-tenant Employee, a Principal id or a uid passed here
        // is simply NOT_FOUND -- the tenant boundary is not something a caller can name its way across.
        const employee = await client.query(`SELECT employment_status::text AS status FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, employeeId]);
        if (employee.rows.length === 0)
            refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
        // THE GOVERNED ASSIGNABILITY POLICY, ENFORCED HERE. The picker is a discovery experience; this command is the
        // business boundary. Both CONSUME the same single authority -- the read uses eos_workforce.employee_work_eligibility
        // to SHOW valid candidates, and this uses it to REFUSE an invalid submitted one. That is one authority with two
        // consumers, not two authorities: leaving the check to the picker would make a client the only enforcement, so a
        // caller holding reorder.request.assign could bypass it and submit any ACTIVE linked Employee.
        if (employee.rows[0].status !== "ACTIVE") {
            refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED", "only an ACTIVE Employee may be assigned work");
        }
        const linked = await client.query(`SELECT 1 FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`, [actor.tenantId, employeeId]);
        if (linked.rows.length === 0) {
            refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED", "the Employee has no active governed login and cannot be assigned work");
        }
        // QUALIFICATION. Fixed by the business operation, never selected by the caller: there is deliberately no
        // qualificationCode input, because "which qualification does Reorder assignment require" is not a client's
        // question. It is PARTS_OPERATIONS -- Reorder assignment is Parts work, and holding WAREHOUSE_OPERATIONS
        // confers nothing here. No Operational Scope is required at this boundary (CASE A): the currently proven
        // workflow is not warehouse-specific, and REORDER_QUEUE visibility is a different authority answering a
        // different question.
        const qualified = await client.query(`SELECT 1 FROM eos_workforce.employee_work_eligibility
        WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL`, [actor.tenantId, employeeId, exports.REORDER_ASSIGNMENT_QUALIFICATION]);
        if (qualified.rows.length === 0) {
            refuse("EMPLOYEE_NOT_ASSIGNABLE", "PRECONDITION_FAILED", `the Employee does not currently hold the ${exports.REORDER_ASSIGNMENT_QUALIFICATION} qualification`);
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
        const target = await client.query(`SELECT status::text AS status, operating_company_key FROM eos_ops.reorder_requests
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, reorderRequestId]);
        if (target.rows.length === 0) {
            refuse("REORDER_NOT_FOUND", "NOT_FOUND", "the Reorder Request does not exist in this tenant");
        }
        // G8 (Controller 2026-10-01): assignment is a management decision, reachable only inside the caller's REORDER_QUEUE
        // Operational Scope for the request's own operating company -- the same queue scope review, cancel and void use.
        // Outside reach answers exactly as missing (no existence oracle).
        const reader = (0, contextualAuthorization_js_1.postgresPrincipalDimensionReader)(client);
        const actorEmployeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
        const reach = actorEmployeeId === null ? [] : (await reader.listOperationalScopes(actor.tenantId, actorEmployeeId))
            .filter((x) => x.scopeType === "REORDER_QUEUE").map((x) => x.scopeId);
        if (!reach.includes(String(target.rows[0].operating_company_key))) {
            refuse("REORDER_NOT_FOUND", "NOT_FOUND", "the Reorder Request does not exist in this tenant");
        }
        const targetStatus = target.rows[0].status;
        if (!exports.ASSIGNABLE_REORDER_STATUSES.includes(targetStatus)) {
            refuse("REORDER_NOT_ASSIGNABLE", "PRECONDITION_FAILED", `a Reorder Request in ${targetStatus} is not awaiting assignment`);
        }
        const { rows } = await client.query(`SELECT id, assigned_employee_id FROM eos_ops.reorder_request_assignments
        WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, reorderRequestId]);
        const current = rows[0];
        const at = deps.now?.() ?? new Date();
        if (current && current.assigned_employee_id === employeeId) {
            await client.query("COMMIT");
            return Object.freeze({ outcome: "NO_CHANGE", reorderRequestId, assignedEmployeeId: employeeId, assignmentId: current.id, endedAssignmentId: null });
        }
        if (current) {
            await client.query(`UPDATE eos_ops.reorder_request_assignments SET effective_to = $3, ended_by_principal_id = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [actor.tenantId, current.id, at, actor.principalId]);
        }
        const id = `rra_${(0, node_crypto_1.randomUUID)()}`;
        await client.query(`INSERT INTO eos_ops.reorder_request_assignments
         (id, tenant_id, reorder_request_id, assigned_employee_id, effective_from, provenance, assigned_by_principal_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, actor.tenantId, reorderRequestId, employeeId, at, exports.NATIVE_ASSIGNMENT_PROVENANCE, actor.principalId, reason]);
        // The status moves with the assignment, and updated_by records the Principal who did it.
        await client.query(`UPDATE eos_ops.reorder_requests
          SET status = 'ASSIGNED_TO_PARTS_ASSOCIATE', updated_by = $3, updated_at = $4
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, reorderRequestId, actor.principalId, at]);
        await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, 'reorderRequest.assign', $3, 'reorderRequest', $4, $5, $6, $7, $8)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, reorderRequestId,
            current ? JSON.stringify({ assignedEmployeeId: current.assigned_employee_id, assignmentId: current.id }) : null,
            JSON.stringify({ assignedEmployeeId: employeeId, assignmentId: id }), at, reason]);
        await client.query("COMMIT");
        return Object.freeze({
            outcome: current ? "REASSIGNED" : "ASSIGNED",
            reorderRequestId, assignedEmployeeId: employeeId, assignmentId: id, endedAssignmentId: current?.id ?? null,
        });
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof ReorderAssignmentError)
            throw err;
        if (err?.code === "23505") {
            throw new ReorderAssignmentError("REORDER_ASSIGNMENT_CONCURRENT_CHANGE", "CONFLICT", "the assignment changed concurrently; retry");
        }
        throw new ReorderAssignmentError("COMMAND_FAILED", "FAILED", "the command could not be completed");
    }
    finally {
        client?.release();
    }
}
/** Who is currently assigned. Null when nobody is -- an unassigned request is a real answer, not an error. */
async function readAssignedEmployee(pool, tenantId, reorderRequestId) {
    const { rows } = await pool.query(`SELECT assigned_employee_id FROM eos_ops.reorder_request_assignments
      WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL`, [tenantId, reorderRequestId]);
    return Object.freeze({ reorderRequestId, assignedEmployeeId: rows[0]?.assigned_employee_id ?? null });
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
async function isCallerTheAssignedEmployee(
// A Pool OR a PoolClient: an authorization decision made outside the transaction that acts on it
// can be overtaken between the check and the write, so every caller inside a transaction passes
// its own client and reads the same snapshot it is about to write against.
pool, tenantId, callerPrincipalId, reorderRequestId) {
    if (!ID_SHAPE(tenantId) || !ID_SHAPE(callerPrincipalId) || !ID_SHAPE(reorderRequestId))
        return false;
    const { rows } = await pool.query(`SELECT l.employee_id AS caller_employee_id, a.assigned_employee_id
       FROM eos_policy.employee_principal_links l
       JOIN eos_ops.reorder_request_assignments a
         ON a.tenant_id = l.tenant_id AND a.reorder_request_id = $3 AND a.effective_to IS NULL
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, callerPrincipalId, reorderRequestId]);
    const row = rows[0];
    if (!row)
        return false;
    return row.caller_employee_id === row.assigned_employee_id;
}
/**
 * WHO THE ASSIGN COMMAND WILL ACCEPT, offered to the Parts Manager's picker (Controller 2026-10-01: "Move the Reorder
 * assignment picker off Firestore employees ... Targets must satisfy existing eligibility"). It is the command's own
 * policy, read: an ACTIVE Employee of this tenant with an active governed login and the current PARTS_OPERATIONS Work
 * Eligibility -- the same three facts assignReorderRequestToEmployee refuses on. Gated by reorder.request.assign, because
 * only a caller who may assign needs to know who is assignable; no uid or external subject is ever returned.
 */
async function listReorderAssignmentTargets(deps, actor, input) {
    if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(exports.REORDER_REQUEST_ASSIGN)) {
        throw new ReorderAssignmentError("CAPABILITY_MISSING", "FORBIDDEN", `listing assignable Employees requires ${exports.REORDER_REQUEST_ASSIGN}`);
    }
    acceptOnly(input, []);
    const { rows } = await deps.pool.query(`SELECT e.id, e.display_name, e.operating_company_id FROM eos_workforce.employees e
      WHERE e.tenant_id = $1 AND e.employment_status::text = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active')
        AND EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility w WHERE w.tenant_id = e.tenant_id AND w.employee_id = e.id
                     AND w.qualification_code = $2 AND w.effective_to IS NULL)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT 500`, [actor.tenantId, exports.REORDER_ASSIGNMENT_QUALIFICATION]);
    return { items: rows.map((r) => ({ employeeId: r.id, displayName: r.display_name ?? null, operatingCompanyId: r.operating_company_id ?? null })) };
}
//# sourceMappingURL=reorderAssignmentAuthority.js.map