"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID_SHAPE = exports.refuse = exports.EmployeeCommandError = exports.EMPLOYEE_PROFILE_WRITE = void 0;
exports.requireId = requireId;
exports.optionalReason = optionalReason;
exports.acceptOnly = acceptOnly;
exports.runEmployeeCommand = runEmployeeCommand;
exports.lockEmployee = lockEmployee;
exports.appendEmployeeAudit = appendEmployeeAudit;
const node_crypto_1 = require("node:crypto");
exports.EMPLOYEE_PROFILE_WRITE = "admin.employeeProfile.write";
class EmployeeCommandError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "EmployeeCommandError";
    }
}
exports.EmployeeCommandError = EmployeeCommandError;
const refuse = (code, category, message) => {
    throw new EmployeeCommandError(code, category, message);
};
exports.refuse = refuse;
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
exports.ID_SHAPE = ID_SHAPE;
function requireId(value, field) {
    if (!(0, exports.ID_SHAPE)(value))
        (0, exports.refuse)("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", `${field} is required and must be a governed Employee id`);
    return value;
}
function optionalReason(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > 500) {
        (0, exports.refuse)("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 500 characters");
    }
    return value;
}
function acceptOnly(input, allowed) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        (0, exports.refuse)("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        (0, exports.refuse)("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
    return input;
}
/**
 * Run one command: actor + capability check, prepare (pure validation, before any connection), then BEGIN -> active
 * Principal + membership -> body -> COMMIT. A unique violation (23505) the body did not pre-empt is mapped by
 * `onUniqueViolation`; every other unexpected error is COMMAND_FAILED with no database detail.
 */
async function runEmployeeCommand(deps, actor, prepare, body, onUniqueViolation, requiredCapability = exports.EMPLOYEE_PROFILE_WRITE) {
    let client;
    try {
        if (!actor || !(0, exports.ID_SHAPE)(actor.tenantId) || !(0, exports.ID_SHAPE)(actor.principalId) || !(actor.capabilities instanceof Set)) {
            (0, exports.refuse)("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
        }
        if (!actor.capabilities.has(requiredCapability))
            (0, exports.refuse)("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${requiredCapability}`);
        const prepared = prepare();
        client = await deps.pool.connect();
        await client.query("BEGIN");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0)
            (0, exports.refuse)("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        const result = await body(client, prepared, deps.now?.() ?? new Date());
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof EmployeeCommandError)
            throw err;
        if (err?.code === "23505")
            throw onUniqueViolation(err);
        throw new EmployeeCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
    }
    finally {
        client?.release();
    }
}
/** Lock the Employee row in the ACTOR's tenant. A foreign-tenant, Principal or provider id is simply NOT_FOUND. */
async function lockEmployee(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, employeeId]);
    if (rows.length === 0)
        (0, exports.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}
async function appendEmployeeAudit(db, tenantId, principalId, action, employeeId, before, after, reason, at) {
    const id = `audit_${(0, node_crypto_1.randomUUID)()}`;
    await db.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'employee', $5, $6, $7, $8, $9)`, [id, tenantId, action, principalId, employeeId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at, reason]);
    return id;
}
//# sourceMappingURL=employeeCommandKernel.js.map