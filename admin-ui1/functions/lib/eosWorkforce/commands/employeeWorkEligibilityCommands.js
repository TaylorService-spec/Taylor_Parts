"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignEmployeeWorkEligibility = assignEmployeeWorkEligibility;
exports.endEmployeeWorkEligibility = endEmployeeWorkEligibility;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const workEligibilityVocabulary_1 = require("../workEligibilityVocabulary");
function requireQualificationCode(value) {
    if (!(0, workEligibilityVocabulary_1.isWorkEligibilityCode)(value)) {
        (0, employeeCommandKernel_1.refuse)("WORK_ELIGIBILITY_CODE_INVALID", "INVALID_INPUT", `qualificationCode must be one of ${workEligibilityVocabulary_1.WORK_ELIGIBILITY_CODES.join(", ")}`);
    }
    return value;
}
/**
 * The partial unique index is the last line of defence against two concurrent assignments of the SAME code. The
 * command pre-empts it by locking the current row, so reaching here means a genuine race, not a duplicate request.
 */
/** The tenant governance lock (postgresPolicyRepository.beginAdministrationCommand's key), as the link commands take it. */
async function takeGovernanceLock(db, tenantId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
}
/**
 * NO SELF-ASSIGNMENT (Pass 10 P10-1; the Pass 9 S4 / Functional Role rule applied to this fact). A Work Eligibility
 * qualification is a narrowing conjunct (the WORK_ELIGIBILITY grant-condition kind, assignability), so granting one to
 * the ACTOR's own linked Employee would let an administrator satisfy it for themselves. Refused under the governance
 * lock the link commands take; ending one's own is allowed (it only narrows). The link commands refuse the mirror
 * image (WORK_ELIGIBILITY_SELF_LINK).
 */
async function refuseSelfEligibility(db, actor, employeeId) {
    const linked = await db.query(`SELECT 1 FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND principal_id = $2 AND employee_id = $3 AND status = 'active'`, [actor.tenantId, actor.principalId, employeeId]);
    if (linked.rows.length > 0) {
        (0, employeeCommandKernel_1.refuse)("WORK_ELIGIBILITY_SELF", "FORBIDDEN", "a Work Eligibility qualification cannot be assigned to your own Employee record; another administrator must do it");
    }
}
const eligibilityConflict = (_err) => new employeeCommandKernel_1.EmployeeCommandError("WORK_ELIGIBILITY_CONCURRENT_CHANGE", "CONFLICT", "the Employee's qualifications changed concurrently; retry");
/**
 * Open a CURRENT qualification for the Employee. Already holding it currently is NO_CHANGE. A previously ended
 * qualification is never reopened -- a new row is appended, so the history keeps both periods.
 */
function assignEmployeeWorkEligibility(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "qualificationCode", "reason"]);
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), code: requireQualificationCode(i.qualificationCode), reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, actor.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        await refuseSelfEligibility(db, actor, p.employeeId);
        const { rows } = await db.query(`SELECT id FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, p.employeeId, p.code]);
        const current = rows[0];
        if (current)
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: current.id };
        const id = `ewe_${(0, node_crypto_1.randomUUID)()}`;
        await db.query(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, actor.tenantId, p.employeeId, p.code, at, actor.principalId, p.reason]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, workEligibilityVocabulary_1.WORK_ELIGIBILITY_ASSIGN_ACTION, p.employeeId, null, { qualificationCode: p.code, qualificationId: id }, p.reason, at);
        return { outcome: "ASSIGNED", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: id };
    }, eligibilityConflict, workEligibilityVocabulary_1.EMPLOYEE_WORK_ELIGIBILITY_WRITE);
}
/**
 * End the Employee's CURRENT qualification for a code. Not currently holding it is NO_CHANGE -- ending is idempotent,
 * and it never deletes: the ended row stays as history, immutable from then on.
 */
function endEmployeeWorkEligibility(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "qualificationCode", "reason"]);
        return { employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"), code: requireQualificationCode(i.qualificationCode), reason: (0, employeeCommandKernel_1.optionalReason)(i.reason) };
    }, async (db, p, at) => {
        await (0, employeeCommandKernel_1.lockEmployee)(db, actor.tenantId, p.employeeId);
        const { rows } = await db.query(`SELECT id FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL FOR UPDATE`, [actor.tenantId, p.employeeId, p.code]);
        const current = rows[0];
        if (!current)
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: "" };
        await db.query(`UPDATE eos_workforce.employee_work_eligibility SET effective_to = $3, ended_by = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`, [actor.tenantId, current.id, at, actor.principalId]);
        await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, actor.tenantId, actor.principalId, workEligibilityVocabulary_1.WORK_ELIGIBILITY_END_ACTION, p.employeeId, { qualificationCode: p.code, qualificationId: current.id }, null, p.reason, at);
        return { outcome: "ENDED", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: current.id };
    }, eligibilityConflict, workEligibilityVocabulary_1.EMPLOYEE_WORK_ELIGIBILITY_WRITE);
}
//# sourceMappingURL=employeeWorkEligibilityCommands.js.map