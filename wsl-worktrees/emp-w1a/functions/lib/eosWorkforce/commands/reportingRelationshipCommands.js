"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeCommandError = exports.EMPLOYEE_PROFILE_WRITE = void 0;
exports.establishReportingRelationship = establishReportingRelationship;
exports.endReportingRelationship = endReportingRelationship;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
var employeeCommandKernel_2 = require("./employeeCommandKernel");
Object.defineProperty(exports, "EMPLOYEE_PROFILE_WRITE", { enumerable: true, get: function () { return employeeCommandKernel_2.EMPLOYEE_PROFILE_WRITE; } });
Object.defineProperty(exports, "EmployeeCommandError", { enumerable: true, get: function () { return employeeCommandKernel_2.EmployeeCommandError; } });
const concurrentChange = () => new employeeCommandKernel_1.EmployeeCommandError("REPORTING_CONCURRENT_CHANGE", "CONFLICT", "the reporting relationship changed concurrently; retry");
async function currentRelationship(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT id, manager_employee_id FROM eos_workforce.employee_reporting_relationships
      WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL FOR UPDATE`, [tenantId, employeeId]);
    return rows[0];
}
async function endRow(db, tenantId, id, principalId, at) {
    await db.query(`UPDATE eos_workforce.employee_reporting_relationships SET effective_to = $3, ended_by = $4, ended_at = $3
      WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [tenantId, id, at, principalId]);
}
/** Make `managerEmployeeId` the CURRENT manager of `employeeId`, ending any different current relationship. */
function establishReportingRelationship(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "managerEmployeeId", "reason"]);
        const employeeId = (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId");
        const managerEmployeeId = (0, employeeCommandKernel_1.requireId)(i.managerEmployeeId, "managerEmployeeId");
        if (employeeId === managerEmployeeId)
            (0, employeeCommandKernel_1.refuse)("REPORTING_SELF_MANAGER", "INVALID_INPUT", "an Employee cannot be their own manager");
        return { employeeId, managerEmployeeId, reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const manager = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, p.managerEmployeeId]);
        if (manager.rows.length === 0)
            (0, employeeCommandKernel_1.refuse)("MANAGER_NOT_FOUND", "NOT_FOUND", "the manager is not an Employee of this tenant");
        const current = await currentRelationship(db, actor.tenantId, p.employeeId);
        if (current && current.manager_employee_id === p.managerEmployeeId) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, managerEmployeeId: p.managerEmployeeId, relationshipId: current.id, endedRelationshipId: null };
        }
        if (current)
            await endRow(db, actor.tenantId, current.id, actor.principalId, at);
        const id = `err_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.employee_reporting_relationships
           (id, tenant_id, employee_id, manager_employee_id, effective_from, established_by, established_at, source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $5, 'GOVERNED_COMMAND', $7)`, [id, actor.tenantId, p.employeeId, p.managerEmployeeId, at, actor.principalId, p.reason]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, "employee.reportingRelationship.establish", p.employeeId, current ? { managerEmployeeId: current.manager_employee_id, relationshipId: current.id } : null, { managerEmployeeId: p.managerEmployeeId, relationshipId: id }, p.reason, at);
        return { outcome: current ? "CHANGED" : "ESTABLISHED", employeeId: p.employeeId, managerEmployeeId: p.managerEmployeeId, relationshipId: id, endedRelationshipId: current?.id ?? null };
    }, concurrentChange);
}
/** End the CURRENT reporting relationship of `employeeId`. The row stays, with effective_to set. */
function endReportingRelationship(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "reason"]);
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const current = await currentRelationship(db, actor.tenantId, p.employeeId);
        if (!current)
            (0, employeeCommandKernel_1.refuse)("REPORTING_RELATIONSHIP_NOT_FOUND", "NOT_FOUND", "the Employee has no current reporting relationship");
        await endRow(db, actor.tenantId, current.id, actor.principalId, at);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, "employee.reportingRelationship.end", p.employeeId, { managerEmployeeId: current.manager_employee_id, relationshipId: current.id }, null, p.reason, at);
        return { outcome: "ENDED", employeeId: p.employeeId, managerEmployeeId: null, relationshipId: null, endedRelationshipId: current.id };
    }, concurrentChange);
}
//# sourceMappingURL=reportingRelationshipCommands.js.map