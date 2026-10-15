"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYMENT_STATUS_TRANSITIONS = exports.OPERATING_COMPANY_CHANGE_ACTION = exports.EMPLOYMENT_STATUS_CHANGE_ACTION = void 0;
exports.changeEmploymentStatus = changeEmploymentStatus;
exports.changeOperatingCompany = changeOperatingCompany;
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const employeeAuthority_1 = require("../../employeeIdentity/employeeAuthority");
exports.EMPLOYMENT_STATUS_CHANGE_ACTION = "employee.employmentStatus.change";
exports.OPERATING_COMPANY_CHANGE_ACTION = "employee.operatingCompany.change";
/** from -> allowed targets. Owner ruling (a), LEGACY PARITY: every canonical status to every other canonical status. */
exports.EMPLOYMENT_STATUS_TRANSITIONS = Object.freeze(Object.fromEntries(employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.map((from) => [from, Object.freeze(employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.filter((to) => to !== from))])));
const isStatus = (v) => typeof v === "string" && employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.includes(v);
async function lockedLifecycle(db, tenantId, employeeId) {
    await (0, employeeCommandKernel_1.lockEmployee)(db, tenantId, employeeId);
    const { rows } = await db.query(`SELECT employment_status::text AS employment_status, operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    return rows[0];
}
const COMPANY_ID_SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;
const noUniqueConstraint = () => new employeeCommandKernel_1.EmployeeCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
/** Change an Employee's employment status along an allowed transition. */
function changeEmploymentStatus(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "employmentStatus", "reason"]);
        if (!isStatus(i.employmentStatus)) {
            (0, employeeCommandKernel_1.refuse)("EMPLOYMENT_STATUS_INVALID", "INVALID_INPUT", `employmentStatus must be one of ${employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.join(", ")}`);
        }
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), status: i.employmentStatus, reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        const current = await lockedLifecycle(db, actor.tenantId, p.employeeId);
        const from = current.employment_status;
        if (from === p.status)
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, previous: from, current: from, auditEventId: null };
        if (!exports.EMPLOYMENT_STATUS_TRANSITIONS[from]?.includes(p.status)) {
            (0, employeeCommandKernel_1.refuse)("EMPLOYMENT_STATUS_TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED", `${from} -> ${p.status} is not an allowed employment status transition`);
        }
        await db.query(`UPDATE eos_workforce.employees SET employment_status = $3::eos_workforce.workforce_employment_status, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.employeeId, p.status, at]);
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, exports.EMPLOYMENT_STATUS_CHANGE_ACTION, p.employeeId, { employmentStatus: from }, { employmentStatus: p.status }, p.reason, at);
        return { outcome: "CHANGED", employeeId: p.employeeId, previous: from, current: p.status, auditEventId };
    }, noUniqueConstraint);
}
/** Move an Employee to a governed, active operating company. */
function changeOperatingCompany(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "operatingCompanyId", "reason"]);
        if (typeof i.operatingCompanyId !== "string" || !COMPANY_ID_SHAPE.test(i.operatingCompanyId)) {
            (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_INVALID", "INVALID_INPUT", "operatingCompanyId must be a well-formed operating company id");
        }
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), companyId: i.operatingCompanyId, reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        const current = await lockedLifecycle(db, actor.tenantId, p.employeeId);
        const link = await db.query(`SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR SHARE`, [actor.tenantId, p.companyId]);
        if (link.rows.length === 0) {
            (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT", "PRECONDITION_FAILED", "the operating company is not authorized for this tenant");
        }
        if (link.rows[0].status !== "ACTIVE")
            (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_INACTIVE", "PRECONDITION_FAILED", "the operating company is inactive for this tenant");
        const from = current.operating_company_id;
        if (from === p.companyId)
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, previous: from, current: from, auditEventId: null };
        await db.query(`UPDATE eos_workforce.employees SET operating_company_id = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, p.employeeId, p.companyId, at]);
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, exports.OPERATING_COMPANY_CHANGE_ACTION, p.employeeId, { operatingCompanyId: from }, { operatingCompanyId: p.companyId }, p.reason, at);
        return { outcome: "CHANGED", employeeId: p.employeeId, previous: from, current: p.companyId, auditEventId };
    }, noUniqueConstraint);
}
//# sourceMappingURL=employeeLifecycleCommand.js.map