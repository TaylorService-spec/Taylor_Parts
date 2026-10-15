"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEmployeeWorkEligibility = listEmployeeWorkEligibility;
exports.listEmployeeWorkEligibilityHistory = listEmployeeWorkEligibilityHistory;
// Step C: the governed PostgreSQL WORK ELIGIBILITY reads.
//
// Visibility reuses employee.record.read -- reading which kinds of work an Employee is qualified for is the same
// business visibility as reading the Employee record, so no extra read capability is invented (the Owner ruling
// already settled this for Job Role). Every read is a READ ONLY snapshot through the shared Employee read kernel.
//
//   listEmployeeWorkEligibility         one Employee's CURRENT qualifications (the Administration surface's list)
//   listEmployeeWorkEligibilityHistory  one Employee's full history, newest first; open rows are `current`
//
// A qualification read returns qualification facts ONLY. It names no Security Role, capability, permission, Job Role,
// ownership, assignment, manager or operating-company authority, and it infers nothing -- an Employee with no
// qualifications reads as an empty list, never as a code derived from Job Role, title or a legacy operationalRole.
const employeeReadKernel_1 = require("./employeeReadKernel");
const employeeDirectoryReads_1 = require("./employeeDirectoryReads");
const workEligibilityVocabulary_1 = require("../workEligibilityVocabulary");
const MAX_HISTORY = 100;
const itemOf = (r) => ({
    qualificationId: r.id,
    qualificationCode: r.qualification_code,
    label: workEligibilityVocabulary_1.WORK_ELIGIBILITY_LABEL[r.qualification_code],
    current: r.effective_to === null,
    effectiveFrom: (0, employeeReadKernel_1.isoOf)(r.effective_from),
    effectiveTo: (0, employeeReadKernel_1.isoOf)(r.effective_to),
    reason: r.reason ?? null,
});
async function requireEmployee(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    if (rows.length === 0)
        (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}
/**
 * The Employee's CURRENT qualifications. An Employee may hold several at once, or none -- both are ordinary, and an
 * empty list is a real answer, never a reason to fall back to any other authority.
 */
function listEmployeeWorkEligibility(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        await requireEmployee(db, tenantId, employeeId);
        const { rows } = await db.query(`SELECT id, qualification_code, effective_from, effective_to, reason
           FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL
          ORDER BY qualification_code`, [tenantId, employeeId]);
        return { employeeId, items: rows.map(itemOf) };
    });
}
/** The Employee's full qualification history, newest first. Ended periods are kept: the table refuses DELETE. */
function listEmployeeWorkEligibilityHistory(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        await requireEmployee(db, tenantId, employeeId);
        const { rows } = await db.query(`SELECT id, qualification_code, effective_from, effective_to, reason
           FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2
          ORDER BY effective_from DESC, id DESC
          LIMIT $3`, [tenantId, employeeId, MAX_HISTORY + 1]);
        const items = rows.slice(0, MAX_HISTORY).map(itemOf);
        return { employeeId, current: items.filter((i) => i.current), items, truncated: rows.length > MAX_HISTORY };
    });
}
//# sourceMappingURL=workEligibilityReads.js.map