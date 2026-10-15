"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOB_ROLE_CATALOG_UPDATE_ACTION = exports.JOB_ROLE_CATALOG_CREATE_ACTION = exports.JOB_ROLE_ASSIGN_ACTION = exports.JOB_ROLE_STATUSES = exports.EMPLOYEE_JOB_ROLE_WRITE = void 0;
exports.createJobRole = createJobRole;
exports.updateJobRole = updateJobRole;
exports.assignEmployeeJobRole = assignEmployeeJobRole;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
// The supersession half of the canonical Job Role vocabulary. Pure data, no I/O -- see below for what is read from it
// and, more importantly, what is NOT.
const jobRoleVocabulary_1 = require("../jobRoleVocabulary");
/** The Job Role catalog and assignment capability. Separate from admin.employeeProfile.write by Owner ruling. */
exports.EMPLOYEE_JOB_ROLE_WRITE = "admin.employeeJobRole.write";
exports.JOB_ROLE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);
exports.JOB_ROLE_ASSIGN_ACTION = "employee.jobRole.assign";
exports.JOB_ROLE_CATALOG_CREATE_ACTION = "jobRole.catalog.create";
exports.JOB_ROLE_CATALOG_UPDATE_ACTION = "jobRole.catalog.update";
const JOB_ROLE_ID_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;
const MAX_DISPLAY_NAME = 100;
function requireJobRoleId(value) {
    if (typeof value !== "string" || !JOB_ROLE_ID_SHAPE.test(value)) {
        (0, employeeCommandKernel_1.refuse)("JOB_ROLE_ID_INVALID", "INVALID_INPUT", "jobRoleId must be a stable Job Role id (lowercase letters, digits and hyphens)");
    }
    return value;
}
/**
 * A RETIRED POSITION MAY NOT BE RE-CREATED (Owner ruling 2026-09-25).
 *
 * THE TENANT CATALOG STAYS OPEN. This is deliberately NOT a check that `jobRoleId` is one of the canonical sixteen:
 * the Owner ruled that EOS supports governed tenant-created business positions, so a tenant minting `field-trainer`
 * through this command is correct and stays allowed. The canonical sixteen govern the SEED, the Taylor default
 * catalog, the P01-P16 acceptance mapping and reconciliation expectations -- not the set a tenant may ever create.
 *
 * WHAT IS CLOSED is the narrow hole underneath that: the ids the ruling RETIRED. `owner`, `parts-warehouse` and
 * `accounting` were withdrawn because each named Security authority, a department, or four positions fused into one
 * (SUPERSEDED_JOB_ROLE_IDS records which, and why). Every one of them is a well-shaped id that passes
 * requireJobRoleId and, once the canonical seed has run, collides with nothing -- so before this check a caller
 * could simply create `owner` again and put the Security Role name back in the business-position vocabulary, with
 * no refusal anywhere. A ruling that only changed what the seed writes would have been a ruling about one script.
 *
 * DERIVED FROM THE MAP, NOT RETYPED (Owner instruction). The refused set is exactly the KEYS of
 * SUPERSEDED_JOB_ROLE_IDS, so retiring a position in the future closes it here with no second edit, and the message
 * names the map's own `replacedBy` -- which is the thing the caller actually needs in order to proceed.
 *
 * AN INPUT VALIDATION, AND ONLY AT CREATION. It grants nothing, alters no capability and adds no authority: the
 * command still gates on admin.employeeJobRole.write exactly as before. It is also deliberately NOT applied to
 * updateJobRole or assignEmployeeJobRole. The seed is add-only and never removes an entry, which is the whole reason
 * SUPERSEDED_JOB_ROLE_IDS exists -- if a pre-ruling revision already created `accounting` in some tenant, that row
 * must stay renameable, deactivatable, readable in history and assignable-in-place. Refusing creation stops the
 * vocabulary regrowing; refusing an update would strand a row nobody could then tidy up.
 */
function refuseSupersededJobRoleId(jobRoleId) {
    const superseded = Object.prototype.hasOwnProperty.call(jobRoleVocabulary_1.SUPERSEDED_JOB_ROLE_IDS, jobRoleId)
        ? jobRoleVocabulary_1.SUPERSEDED_JOB_ROLE_IDS[jobRoleId]
        : undefined;
    if (superseded === undefined)
        return;
    (0, employeeCommandKernel_1.refuse)("JOB_ROLE_ID_SUPERSEDED", "INVALID_INPUT", `the Job Role '${jobRoleId}' was retired by the canonical Job Role ruling and may not be created again; use ${superseded.replacedBy.join(" or ")} instead`);
}
function requireDisplayName(value) {
    if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > MAX_DISPLAY_NAME) {
        (0, employeeCommandKernel_1.refuse)("JOB_ROLE_DISPLAY_NAME_INVALID", "INVALID_INPUT", `displayName must be a trimmed, non-empty name of at most ${MAX_DISPLAY_NAME} characters`);
    }
    return value;
}
async function auditCatalog(db, actor, action, jobRoleId, before, after, at) {
    await db.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'jobRole', $5, $6, $7, $8, NULL)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, action, actor.principalId, jobRoleId, before === null ? null : JSON.stringify(before), JSON.stringify(after), at]);
}
const jobRoleConflict = (err) => err.constraint === "employee_job_role_one_current_per_employee"
    ? new employeeCommandKernel_1.EmployeeCommandError("JOB_ROLE_CONCURRENT_CHANGE", "CONFLICT", "the Employee's Job Role changed concurrently; retry")
    : err.constraint === "job_roles_display_name_unique_per_tenant"
        ? new employeeCommandKernel_1.EmployeeCommandError("JOB_ROLE_DISPLAY_NAME_TAKEN", "CONFLICT", "another Job Role of this tenant has that name")
        : new employeeCommandKernel_1.EmployeeCommandError("JOB_ROLE_ALREADY_EXISTS", "CONFLICT", "a Job Role with that id already exists in this tenant");
/**
 * Add an ACTIVE Job Role to the actor's tenant catalog.
 *
 * A NEW POSITION, AND NOTHING ELSE. It writes one eos_workforce.job_roles row and one catalog audit event. It creates
 * no Security Role, grants no capability, writes no Work Eligibility or Operational Scope, confers no workflow
 * authority, and assigns the position to NO Employee -- a catalog entry is a vocabulary row, and an Employee holds it
 * only once assignEmployeeJobRole says so.
 */
function createJobRole(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["jobRoleId", "displayName"]);
        const jobRoleId = requireJobRoleId(i.jobRoleId);
        // AFTER the shape check, so a retired id is refused for BEING RETIRED rather than for looking malformed --
        // every retired id is perfectly well-shaped, which is exactly why this check has to exist.
        refuseSupersededJobRoleId(jobRoleId);
        return { jobRoleId, displayName: requireDisplayName(i.displayName) };
    }, async (db, p, at) => {
        await db.query(`INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $4, $5)`, [actor.tenantId, p.jobRoleId, p.displayName, actor.principalId, at]);
        const jobRole = { jobRoleId: p.jobRoleId, displayName: p.displayName, status: "ACTIVE" };
        await auditCatalog(db, actor, exports.JOB_ROLE_CATALOG_CREATE_ACTION, p.jobRoleId, null, jobRole, at);
        return { outcome: "CREATED", jobRole };
    }, jobRoleConflict, exports.EMPLOYEE_JOB_ROLE_WRITE);
}
/** Rename a Job Role, or move it between ACTIVE and INACTIVE. Never deletes; history keeps naming it. */
function updateJobRole(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["jobRoleId", "displayName", "status"]);
        const displayName = i.displayName === undefined ? null : requireDisplayName(i.displayName);
        if (i.status !== undefined && !exports.JOB_ROLE_STATUSES.includes(i.status)) {
            (0, employeeCommandKernel_1.refuse)("JOB_ROLE_STATUS_INVALID", "INVALID_INPUT", `status must be one of ${exports.JOB_ROLE_STATUSES.join(", ")}`);
        }
        if (displayName === null && i.status === undefined)
            (0, employeeCommandKernel_1.refuse)("NO_CHANGES_REQUESTED", "INVALID_INPUT", "name displayName and/or status");
        return { jobRoleId: requireJobRoleId(i.jobRoleId), displayName, status: i.status ?? null };
    }, async (db, p, at) => {
        const { rows } = await db.query(`SELECT id, display_name, status FROM eos_workforce.job_roles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, p.jobRoleId]);
        if (rows.length === 0)
            (0, employeeCommandKernel_1.refuse)("JOB_ROLE_NOT_FOUND", "NOT_FOUND", "the Job Role does not exist in this tenant");
        const before = { jobRoleId: rows[0].id, displayName: rows[0].display_name, status: rows[0].status };
        const after = { jobRoleId: before.jobRoleId, displayName: p.displayName ?? before.displayName, status: p.status ?? before.status };
        if (after.displayName === before.displayName && after.status === before.status)
            return { outcome: "NO_CHANGE", jobRole: before };
        await db.query(`UPDATE eos_workforce.job_roles SET display_name = $3, status = $4, updated_by = $5, updated_at = $6 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.jobRoleId, after.displayName, after.status, actor.principalId, at]);
        await auditCatalog(db, actor, exports.JOB_ROLE_CATALOG_UPDATE_ACTION, p.jobRoleId, before, after, at);
        return { outcome: "UPDATED", jobRole: after };
    }, jobRoleConflict, exports.EMPLOYEE_JOB_ROLE_WRITE);
}
/** Make `jobRoleId` the Employee's one current primary Job Role, ending any different current assignment. */
function assignEmployeeJobRole(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "jobRoleId", "reason"]);
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), jobRoleId: requireJobRoleId(i.jobRoleId), reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const role = await db.query(`SELECT status FROM eos_workforce.job_roles WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, p.jobRoleId]);
        if (role.rows.length === 0)
            (0, employeeCommandKernel_1.refuse)("JOB_ROLE_NOT_FOUND", "NOT_FOUND", "the Job Role does not exist in this tenant");
        if (role.rows[0].status !== "ACTIVE")
            (0, employeeCommandKernel_1.refuse)("JOB_ROLE_INACTIVE", "PRECONDITION_FAILED", "an inactive Job Role cannot receive a new assignment");
        const { rows } = await db.query(`SELECT id, job_role_id FROM eos_workforce.employee_job_role_assignments
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, p.employeeId]);
        const current = rows[0];
        if (current && current.job_role_id === p.jobRoleId) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, jobRoleId: p.jobRoleId, assignmentId: current.id, endedAssignmentId: null };
        }
        if (current) {
            await db.query(`UPDATE eos_workforce.employee_job_role_assignments SET effective_to = $3, ended_by = $4, ended_at = $3
            WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [actor.tenantId, current.id, at, actor.principalId]);
        }
        const id = `ejr_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.employee_job_role_assignments (id, tenant_id, employee_id, job_role_id, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, actor.tenantId, p.employeeId, p.jobRoleId, at, actor.principalId, p.reason]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, exports.JOB_ROLE_ASSIGN_ACTION, p.employeeId, current ? { jobRoleId: current.job_role_id, assignmentId: current.id } : null, { jobRoleId: p.jobRoleId, assignmentId: id }, p.reason, at);
        return { outcome: current ? "CHANGED" : "ASSIGNED", employeeId: p.employeeId, jobRoleId: p.jobRoleId, assignmentId: id, endedAssignmentId: current?.id ?? null };
    }, jobRoleConflict, exports.EMPLOYEE_JOB_ROLE_WRITE);
}
//# sourceMappingURL=employeeJobRoleCommands.js.map