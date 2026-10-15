"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignEmployeeOperationalScope = assignEmployeeOperationalScope;
exports.endEmployeeOperationalScope = endEmployeeOperationalScope;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const operationalScopeVocabulary_1 = require("../operationalScopeVocabulary");
function requireScopeType(value) {
    if (!(0, operationalScopeVocabulary_1.isOperationalScopeType)(value)) {
        (0, employeeCommandKernel_1.refuse)("OPERATIONAL_SCOPE_TYPE_INVALID", "INVALID_INPUT", `scopeType must be one of ${operationalScopeVocabulary_1.OPERATIONAL_SCOPE_TYPES.join(", ")}`);
    }
    return value;
}
/** The tenant governance lock (postgresPolicyRepository.beginAdministrationCommand's key), as the link commands take it. */
async function takeGovernanceLock(db, tenantId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
}
/** Pass 10 P10-1: the actor may not scope the Employee its own Principal is actively linked to. */
async function refuseSelfScope(db, actor, employeeId) {
    const linked = await db.query(`SELECT 1 FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND principal_id = $2 AND employee_id = $3 AND status = 'active'`, [actor.tenantId, actor.principalId, employeeId]);
    if (linked.rows.length > 0) {
        (0, employeeCommandKernel_1.refuse)("OPERATIONAL_SCOPE_SELF", "FORBIDDEN", "an Operational Scope cannot be assigned to your own Employee record; another administrator must do it");
    }
}
const scopeConflict = (_err) => new employeeCommandKernel_1.EmployeeCommandError("OPERATIONAL_SCOPE_CONCURRENT_CHANGE", "CONFLICT", "the Employee's operational scopes changed concurrently; retry");
/**
 * Resolve the scope target in the ACTOR's tenant and require it to be governed and ACTIVE.
 *
 * An unknown id and another tenant's id are the SAME refusal on purpose: confirming that a foreign warehouse exists
 * would leak across the tenant boundary. Each scope type has its ONE governed source (lane GA; the same source
 * listOperationalScopeTargets offers, and the same one migration 1761696000000's trigger checks):
 *   WAREHOUSE       eos_ops.warehouses
 *   REORDER_QUEUE   eos_policy.tenant_operating_company_keys (the queue is a company's queue, keyed by its eos_ops key)
 */
async function requireActiveScopeTarget(db, tenantId, scopeType, scopeId, employeeId) {
    if (scopeType === "REORDER_QUEUE") {
        const { rows } = await db.query(`SELECT status FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 FOR SHARE`, [tenantId, scopeId]);
        if (rows.length === 0)
            (0, employeeCommandKernel_1.refuse)("REORDER_QUEUE_NOT_FOUND", "NOT_FOUND", "no governed operating company key names this queue in this tenant");
        if (rows[0].status !== "ACTIVE")
            (0, employeeCommandKernel_1.refuse)("REORDER_QUEUE_INACTIVE", "PRECONDITION_FAILED", "an inactive operating company key cannot receive a new queue scope");
        return;
    }
    if (scopeType === "MOBILE") {
        // OD-T1: the truck's MOBILE location -- ACTIVE, of the Employee's own operating company (a technician never gains a truck
        // of another company), and not the location of an inactive truck.
        const { rows } = await db.query(`SELECT m.active, m.operating_company_key,
              (SELECT t.active FROM eos_ops.trucks t WHERE t.tenant_id = m.tenant_id AND t.mobile_location_type = 'MOBILE' AND t.mobile_location_id = m.location_id) AS truck_active
         FROM eos_ops.mobile_locations m WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND m.location_id = $2 FOR SHARE OF m`, [tenantId, scopeId]);
        if (rows.length === 0)
            (0, employeeCommandKernel_1.refuse)("MOBILE_LOCATION_NOT_FOUND", "NOT_FOUND", "the truck location does not exist in this tenant");
        if (rows[0].active !== true)
            (0, employeeCommandKernel_1.refuse)("MOBILE_LOCATION_INACTIVE", "PRECONDITION_FAILED", "an inactive truck location cannot receive a new operational scope");
        if (rows[0].truck_active === false)
            (0, employeeCommandKernel_1.refuse)("TRUCK_INACTIVE", "PRECONDITION_FAILED", "the truck linked to this location is inactive");
        const company = await db.query(`SELECT 1 FROM eos_workforce.employees e
         JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id AND k.status = 'ACTIVE'
        WHERE e.tenant_id = $1 AND e.id = $2 AND k.operating_company_key = $3`, [tenantId, employeeId, rows[0].operating_company_key]);
        if (company.rows.length === 0) {
            (0, employeeCommandKernel_1.refuse)("MOBILE_LOCATION_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the truck belongs to another operating company than the Employee");
        }
        return;
    }
    if (scopeType !== "WAREHOUSE")
        (0, employeeCommandKernel_1.refuse)("OPERATIONAL_SCOPE_TYPE_INVALID", "INVALID_INPUT", `scopeType must be one of ${operationalScopeVocabulary_1.OPERATIONAL_SCOPE_TYPES.join(", ")}`);
    const { rows } = await db.query(`SELECT status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, scopeId]);
    if (rows.length === 0)
        (0, employeeCommandKernel_1.refuse)("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "the warehouse does not exist in this tenant");
    if (rows[0].status !== "ACTIVE")
        (0, employeeCommandKernel_1.refuse)("WAREHOUSE_INACTIVE", "PRECONDITION_FAILED", "an inactive warehouse cannot receive a new operational scope");
}
/** Open a CURRENT warehouse scope. Already covering it currently is NO_CHANGE; an ended scope is never reopened. */
function assignEmployeeOperationalScope(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "scopeType", "scopeId", "reason"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            scopeType: requireScopeType(i.scopeType),
            scopeId: (0, employeeCommandKernel_1.requireId)(i.scopeId, "scopeId"),
            reason: (0, employeeCommandKernel_1.optionalReason)(i.reason),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        await refuseSelfScope(db, actor, p.employeeId);
        await requireActiveScopeTarget(db, actor.tenantId, p.scopeType, p.scopeId, p.employeeId);
        const { rows } = await db.query(`SELECT id FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND scope_id = $4 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, p.employeeId, p.scopeType, p.scopeId]);
        const current = rows[0];
        if (current) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id };
        }
        const id = `eos_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, actor.tenantId, p.employeeId, p.scopeType, p.scopeId, at, actor.principalId, p.reason]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, operationalScopeVocabulary_1.OPERATIONAL_SCOPE_ASSIGN_ACTION, p.employeeId, null, { scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: id }, p.reason, at);
        return { outcome: "ASSIGNED", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: id };
    }, scopeConflict, operationalScopeVocabulary_1.EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
}
/**
 * End the Employee's CURRENT scope for a target. Not currently covering it is NO_CHANGE.
 *
 * Deliberately NOT status-checked: a warehouse that has since gone INACTIVE must still be REMOVABLE from an
 * Employee's scope. Requiring ACTIVE here would strand exactly the scopes most in need of ending.
 */
function endEmployeeOperationalScope(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "scopeType", "scopeId", "reason"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            scopeType: requireScopeType(i.scopeType),
            scopeId: (0, employeeCommandKernel_1.requireId)(i.scopeId, "scopeId"),
            reason: (0, employeeCommandKernel_1.optionalReason)(i.reason),
        };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const { rows } = await db.query(`SELECT id FROM eos_workforce.employee_operational_scopes
          WHERE tenant_id = $1 AND employee_id = $2 AND scope_type = $3 AND scope_id = $4 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, p.employeeId, p.scopeType, p.scopeId]);
        const current = rows[0];
        if (!current) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: "" };
        }
        await db.query(`UPDATE eos_workforce.employee_operational_scopes SET effective_to = $3, ended_by = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [actor.tenantId, current.id, at, actor.principalId]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, operationalScopeVocabulary_1.OPERATIONAL_SCOPE_END_ACTION, p.employeeId, { scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id }, null, p.reason, at);
        return { outcome: "ENDED", employeeId: p.employeeId, scopeType: p.scopeType, scopeId: p.scopeId, operationalScopeId: current.id };
    }, scopeConflict, operationalScopeVocabulary_1.EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
}
//# sourceMappingURL=employeeOperationalScopeCommands.js.map