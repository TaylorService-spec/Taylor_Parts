"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFunctionalRole = createFunctionalRole;
exports.updateFunctionalRoleMetadata = updateFunctionalRoleMetadata;
exports.setFunctionalRoleStatus = setFunctionalRoleStatus;
exports.assignEmployeeFunctionalRole = assignEmployeeFunctionalRole;
exports.endEmployeeFunctionalRoleAssignment = endEmployeeFunctionalRoleAssignment;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const functionalRoleVocabulary_1 = require("../functionalRoleVocabulary");
/** A clock difference between the caller and the database this small is "now", not a backdated assertion. */
const CLOCK_SKEW_MS = 60_000;
function requireFunctionalRoleKey(value) {
    if (typeof value !== "string" || !functionalRoleVocabulary_1.FUNCTIONAL_ROLE_KEY_SHAPE.test(value)) {
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_KEY_INVALID", "INVALID_INPUT", "key must be a stable Functional Role key (lowercase letters, digits and hyphens, 2-63 characters)");
    }
    return value;
}
function requireFunctionalRoleId(value) {
    if (typeof value !== "string" || !functionalRoleVocabulary_1.FUNCTIONAL_ROLE_ID_SHAPE.test(value)) {
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_ID_INVALID", "INVALID_INPUT", "functionalRoleId must be a governed Functional Role id");
    }
    return value;
}
function requireName(value) {
    if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_NAME) {
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_NAME_INVALID", "INVALID_INPUT", `name must be a trimmed, non-empty name of at most ${functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_NAME} characters`);
    }
    return value;
}
/** undefined = not stated; null = clear it. */
function optionalDescription(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_DESCRIPTION) {
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_DESCRIPTION_INVALID", "INVALID_INPUT", `description must be a trimmed, non-empty text of at most ${functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_DESCRIPTION} characters, or null`);
    }
    return value;
}
function requireReason(value) {
    if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > 500) {
        (0, employeeCommandKernel_1.refuse)("REASON_REQUIRED", "INVALID_INPUT", "a reason is required: a trimmed, non-empty statement of at most 500 characters");
    }
    return value;
}
function optionalReason(value) {
    return value === undefined || value === null ? null : requireReason(value);
}
function optionalInstant(value, field) {
    if (value === undefined || value === null)
        return null;
    const at = typeof value === "string" ? new Date(value) : null;
    if (!at || Number.isNaN(at.getTime()))
        (0, employeeCommandKernel_1.refuse)("EFFECTIVE_DATE_INVALID", "INVALID_INPUT", `${field} must be an ISO-8601 instant`);
    return at;
}
/**
 * An effective instant stated by the caller, bounded: never in the past (a fact that already governed workflow
 * decisions is never rewritten), never more than MAX_FUNCTIONAL_ROLE_SCHEDULE_DAYS ahead. Absent = now.
 */
function effectiveInstant(stated, at, field) {
    if (stated === null)
        return at;
    if (stated.getTime() < at.getTime() - CLOCK_SKEW_MS) {
        (0, employeeCommandKernel_1.refuse)("EFFECTIVE_DATE_IN_PAST", "INVALID_INPUT", `${field} may not be in the past; a recorded fact is never backdated`);
    }
    if (stated.getTime() > at.getTime() + functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_SCHEDULE_DAYS * 86_400_000) {
        (0, employeeCommandKernel_1.refuse)("EFFECTIVE_DATE_TOO_FAR", "INVALID_INPUT", `${field} may be scheduled at most ${functionalRoleVocabulary_1.MAX_FUNCTIONAL_ROLE_SCHEDULE_DAYS} days ahead`);
    }
    return stated.getTime() < at.getTime() ? at : stated;
}
/** The tenant governance lock (postgresPolicyRepository.beginAdministrationCommand's key). */
async function takeGovernanceLock(db, tenantId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
}
async function auditCatalog(db, actor, action, functionalRoleId, before, after, reason, at) {
    await db.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, action, actor.principalId, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_AUDIT_TARGET_KIND, functionalRoleId,
        before === null ? null : JSON.stringify(before), JSON.stringify(after), at, reason]);
}
/** A unique violation the command did not pre-empt: a genuine race, never a duplicate request. */
const functionalRoleConflict = (err) => {
    switch (err.constraint) {
        case "functional_roles_key_unique_per_tenant":
        case "functional_roles_key_norm_unique_per_tenant":
            return new employeeCommandKernel_1.EmployeeCommandError("FUNCTIONAL_ROLE_KEY_TAKEN", "CONFLICT", "another Functional Role of this tenant has that key");
        case "functional_roles_name_unique_per_tenant":
            return new employeeCommandKernel_1.EmployeeCommandError("FUNCTIONAL_ROLE_NAME_TAKEN", "CONFLICT", "another Functional Role of this tenant has that name");
        default:
            return new employeeCommandKernel_1.EmployeeCommandError("FUNCTIONAL_ROLE_CONCURRENT_CHANGE", "CONFLICT", "the Functional Roles changed concurrently; retry");
    }
};
const entryOf = (r) => ({ functionalRoleId: r.id, key: r.key, name: r.name, description: r.description ?? null, status: r.status });
async function lockFunctionalRole(db, tenantId, functionalRoleId, mode) {
    const { rows } = await db.query(`SELECT id, key, name, description, status FROM eos_workforce.functional_roles WHERE tenant_id = $1 AND id = $2 FOR ${mode}`, [tenantId, functionalRoleId]);
    if (rows.length === 0)
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_NOT_FOUND", "NOT_FOUND", "the Functional Role does not exist in this tenant");
    return entryOf(rows[0]);
}
/**
 * Add an ACTIVE Functional Role to the actor's tenant catalog. A vocabulary row and nothing else: it assigns the
 * responsibility to NO Employee, grants nothing and binds no workflow.
 */
function createFunctionalRole(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["key", "name", "description", "reason"]);
        const key = requireFunctionalRoleKey(i.key);
        const code = (0, functionalRoleVocabulary_1.collidingEligibilityCode)(key);
        if (code)
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_KEY_COLLISION", "CONFLICT", `"${key}" collides with the Work Eligibility code ${code}; a Functional Role is not a qualification`);
        return { key, name: requireName(i.name), description: optionalDescription(i.description) ?? null, reason: optionalReason(i.reason) };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        const norm = (0, functionalRoleVocabulary_1.normalizeFunctionalRoleKey)(p.key);
        const roles = await db.query(`SELECT key FROM eos_policy.roles WHERE tenant_id = $1`, [actor.tenantId]);
        const clash = roles.rows.find((r) => (0, functionalRoleVocabulary_1.normalizeFunctionalRoleKey)(String(r.key)) === norm);
        if (clash) {
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_KEY_COLLISION", "CONFLICT", `"${p.key}" collides with the Security Role "${clash.key}"; a Functional Role is not a Security Role`);
        }
        const id = `fr_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.functional_roles (tenant_id, id, key, name, description, status, created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, $6, $7)`, [actor.tenantId, id, p.key, p.name, p.description, actor.principalId, at]);
        const functionalRole = entryOf({ id, key: p.key, name: p.name, description: p.description, status: "ACTIVE" });
        await auditCatalog(db, actor, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION, id, null, functionalRole, p.reason, at);
        return { outcome: "CREATED", functionalRole };
    }, functionalRoleConflict, functionalRoleVocabulary_1.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
}
/** Rename or re-describe a Functional Role. The key and id never change; status has its own command. */
function updateFunctionalRoleMetadata(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["functionalRoleId", "name", "description", "reason"]);
        const name = i.name === undefined ? undefined : requireName(i.name);
        const description = optionalDescription(i.description);
        if (name === undefined && description === undefined)
            (0, employeeCommandKernel_1.refuse)("NO_CHANGES_REQUESTED", "INVALID_INPUT", "name name and/or description");
        return { functionalRoleId: requireFunctionalRoleId(i.functionalRoleId), name, description, reason: optionalReason(i.reason) };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        const before = await lockFunctionalRole(db, actor.tenantId, p.functionalRoleId, "UPDATE");
        const after = {
            ...before,
            name: p.name ?? before.name,
            description: p.description === undefined ? before.description : p.description,
        };
        if (after.name === before.name && after.description === before.description)
            return { outcome: "NO_CHANGE", functionalRole: before };
        await db.query(`UPDATE eos_workforce.functional_roles SET name = $3, description = $4, updated_by = $5, updated_at = $6 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.functionalRoleId, after.name, after.description, actor.principalId, at]);
        await auditCatalog(db, actor, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION, p.functionalRoleId, before, after, p.reason, at);
        return { outcome: "UPDATED", functionalRole: after };
    }, functionalRoleConflict, functionalRoleVocabulary_1.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
}
/**
 * Activate or deactivate. Deactivation FAILS CLOSED: refused while any Employee currently holds (or is scheduled to
 * hold) the Functional Role, and while an ACTIVE workflow version binds it. Nothing is ended implicitly.
 */
function setFunctionalRoleStatus(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["functionalRoleId", "status", "reason"]);
        if (!functionalRoleVocabulary_1.FUNCTIONAL_ROLE_STATUSES.includes(i.status)) {
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_STATUS_INVALID", "INVALID_INPUT", `status must be one of ${functionalRoleVocabulary_1.FUNCTIONAL_ROLE_STATUSES.join(", ")}`);
        }
        return { functionalRoleId: requireFunctionalRoleId(i.functionalRoleId), status: i.status, reason: requireReason(i.reason) };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        const before = await lockFunctionalRole(db, actor.tenantId, p.functionalRoleId, "UPDATE");
        if (before.status === p.status)
            return { outcome: "NO_CHANGE", functionalRole: before };
        if (p.status === "INACTIVE") {
            const holders = (await db.query(`SELECT count(*)::int AS n FROM eos_workforce.employee_functional_role_assignments
            WHERE tenant_id = $1 AND functional_role_id = $2
              AND (effective_to IS NULL OR (effective_to > $3 AND effective_to > effective_from))`, [actor.tenantId, p.functionalRoleId, at])).rows[0].n;
            if (holders > 0) {
                (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS", "CONFLICT", `${holders} current or scheduled assignment(s) must be ended before this Functional Role can be deactivated`);
            }
            const bound = (await db.query(`SELECT count(*)::int AS n FROM eos_policy.workflow_role_bindings b
             JOIN eos_policy.workflows w ON w.tenant_id = b.tenant_id AND w.active_version_id = b.workflow_version_id
            WHERE b.tenant_id = $1 AND b.functional_role_id = $2`, [actor.tenantId, p.functionalRoleId])).rows[0].n;
            if (bound > 0) {
                (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_BOUND_TO_ACTIVE_WORKFLOW", "CONFLICT", `${bound} binding(s) in an ACTIVE workflow version name this Functional Role; activate a version without them first`);
            }
        }
        await db.query(`UPDATE eos_workforce.functional_roles SET status = $3, updated_by = $4, updated_at = $5 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.functionalRoleId, p.status, actor.principalId, at]);
        const after = { ...before, status: p.status };
        await auditCatalog(db, actor, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_STATUS_ACTION, p.functionalRoleId, before, after, p.reason, at);
        return { outcome: "UPDATED", functionalRole: after };
    }, functionalRoleConflict, functionalRoleVocabulary_1.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
}
/**
 * Give the Employee a Functional Role, from now or from a scheduled instant. Already holding it (an open assignment)
 * is NO_CHANGE; an overlapping scheduled period is refused. A previously ended assignment is never reopened -- a new
 * row is appended, so the history keeps both periods.
 */
function assignEmployeeFunctionalRole(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "functionalRoleId", "reason", "effectiveFrom"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            functionalRoleId: requireFunctionalRoleId(i.functionalRoleId),
            reason: requireReason(i.reason),
            effectiveFrom: optionalInstant(i.effectiveFrom, "effectiveFrom"),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const linked = await db.query(`SELECT 1 FROM eos_policy.employee_principal_links
          WHERE tenant_id = $1 AND principal_id = $2 AND employee_id = $3 AND status = 'active'`, [actor.tenantId, actor.principalId, p.employeeId]);
        if (linked.rows.length > 0) {
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_SELF_ASSIGNMENT", "FORBIDDEN", "a Functional Role cannot be assigned to your own Employee record; another administrator must do it");
        }
        const role = await lockFunctionalRole(db, actor.tenantId, p.functionalRoleId, "SHARE");
        if (role.status !== "ACTIVE")
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_INACTIVE", "PRECONDITION_FAILED", "an inactive Functional Role cannot receive a new assignment");
        const from = effectiveInstant(p.effectiveFrom, at, "effectiveFrom");
        const { rows } = await db.query(`SELECT id, effective_from, effective_to FROM eos_workforce.employee_functional_role_assignments
          WHERE tenant_id = $1 AND employee_id = $2 AND functional_role_id = $3
            AND (effective_to IS NULL OR (effective_to > $4 AND effective_to > effective_from))
          ORDER BY effective_from FOR UPDATE`, [actor.tenantId, p.employeeId, p.functionalRoleId, from]);
        const open = rows.find((r) => r.effective_to === null);
        if (open) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, functionalRoleId: p.functionalRoleId, assignmentId: open.id,
                effectiveFrom: open.effective_from.toISOString(), effectiveTo: null };
        }
        if (rows.length > 0) {
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_ASSIGNMENT_OVERLAP", "CONFLICT", "the Employee already holds this Functional Role for an overlapping period");
        }
        const id = `efr_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.employee_functional_role_assignments
           (id, tenant_id, employee_id, functional_role_id, effective_from, assignment_source, assigned_by, assigned_at, reason)
         VALUES ($1, $2, $3, $4, $5, 'ADMINISTRATION', $6, $7, $8)`, [id, actor.tenantId, p.employeeId, p.functionalRoleId, from, actor.principalId, at, p.reason]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_ASSIGN_ACTION, p.employeeId, null, { functionalRoleId: role.functionalRoleId, functionalRoleKey: role.key, assignmentId: id, effectiveFrom: from.toISOString() }, p.reason, at);
        return { outcome: "ASSIGNED", employeeId: p.employeeId, functionalRoleId: p.functionalRoleId, assignmentId: id,
            effectiveFrom: from.toISOString(), effectiveTo: null };
    }, functionalRoleConflict, functionalRoleVocabulary_1.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
}
/**
 * End one of the Employee's assignments, now or at a scheduled instant. Already ended is NO_CHANGE. An assignment that
 * has not started yet is CANCELLED (ended at its own start: a zero-length period that was never current). It never
 * deletes: the ended row stays as history, immutable from then on.
 */
function endEmployeeFunctionalRoleAssignment(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "assignmentId", "reason", "effectiveTo"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            assignmentId: (0, employeeCommandKernel_1.requireId)(i.assignmentId, "assignmentId"),
            reason: requireReason(i.reason),
            effectiveTo: optionalInstant(i.effectiveTo, "effectiveTo"),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const { rows } = await db.query(`SELECT a.id, a.functional_role_id, a.effective_from, a.effective_to, r.key
           FROM eos_workforce.employee_functional_role_assignments a
           JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
          WHERE a.tenant_id = $1 AND a.employee_id = $2 AND a.id = $3 FOR UPDATE OF a`, [actor.tenantId, p.employeeId, p.assignmentId]);
        const row = rows[0];
        if (!row)
            (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_ASSIGNMENT_NOT_FOUND", "NOT_FOUND", "the assignment does not exist for this Employee in this tenant");
        const found = row;
        if (found.effective_to !== null) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, functionalRoleId: found.functional_role_id, assignmentId: found.id,
                effectiveFrom: found.effective_from.toISOString(), effectiveTo: found.effective_to.toISOString() };
        }
        const requested = effectiveInstant(p.effectiveTo, at, "effectiveTo");
        const to = requested.getTime() < found.effective_from.getTime() ? found.effective_from : requested;
        await db.query(`UPDATE eos_workforce.employee_functional_role_assignments
            SET effective_to = $3, ended_by = $4, ended_at = $5, end_reason = $6
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [actor.tenantId, found.id, to, actor.principalId, at, p.reason]);
        const identity = { functionalRoleId: found.functional_role_id, functionalRoleKey: found.key, assignmentId: found.id };
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_END_ACTION, p.employeeId, { ...identity, effectiveFrom: found.effective_from.toISOString() }, { ...identity, effectiveTo: to.toISOString() }, p.reason, at);
        return { outcome: "ENDED", employeeId: p.employeeId, functionalRoleId: found.functional_role_id, assignmentId: found.id,
            effectiveFrom: found.effective_from.toISOString(), effectiveTo: to.toISOString() };
    }, functionalRoleConflict, functionalRoleVocabulary_1.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
}
//# sourceMappingURL=employeeFunctionalRoleCommands.js.map