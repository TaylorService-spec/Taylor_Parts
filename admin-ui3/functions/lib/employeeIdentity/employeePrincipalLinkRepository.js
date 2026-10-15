"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeePrincipalLinkConflict = void 0;
exports.establishLink = establishLink;
exports.readActiveLinkForEmployee = readActiveLinkForEmployee;
exports.readActiveLinkForPrincipal = readActiveLinkForPrincipal;
exports.resolveEmployeeIdForPrincipal = resolveEmployeeIdForPrincipal;
exports.revokeLinkForEmployee = revokeLinkForEmployee;
exports.listLinkHistoryForEmployee = listLinkHistoryForEmployee;
const node_crypto_1 = require("node:crypto");
const employeePrincipalLink_js_1 = require("./employeePrincipalLink.js");
const SCHEMA = "eos_policy";
const TABLE = `${SCHEMA}.employee_principal_links`;
class EmployeePrincipalLinkConflict extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "EmployeePrincipalLinkConflict";
    }
}
exports.EmployeePrincipalLinkConflict = EmployeePrincipalLinkConflict;
const toRecord = (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    employeeId: row.employee_id,
    operatingCompanyId: row.operating_company_id,
    linkSource: row.link_source,
    status: row.status,
    assertedBy: row.asserted_by,
    assertionReason: row.assertion_reason,
});
const SELECT_COLUMNS = "id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason";
/** The two partial unique indexes, by the name migration 008 gives them. Matched on the error's
 *  `constraint` field rather than on message text, because message text is a locale away from
 *  changing and a constraint name is part of the schema. */
const EMPLOYEE_INDEX = "employee_principal_links_one_active_per_employee";
const PRINCIPAL_INDEX = "employee_principal_links_one_active_per_principal";
const MEMBER_FK = "employee_principal_links_member_fk";
/**
 * Establish an ACTIVE link between one Employee and one principal.
 *
 * Refuses — never resolves — every ambiguity:
 *   * malformed input, or an OPERATOR_ASSERTED link with no author (assertValidLinkInput);
 *   * a second ACTIVE link for the Employee, or for the principal (the partial unique indexes);
 *   * a principal who is not a member of this tenant (the composite foreign key).
 *
 * IDEMPOTENCE IS NOT GUESSED EITHER. Re-establishing the exact same link is NOT silently accepted:
 * an existing ACTIVE row for this Employee that already names this principal is returned unchanged,
 * but one that names a DIFFERENT principal is a conflict. "Already true" and "now says something
 * else" are different answers and are never collapsed.
 */
async function establishLink(db, input) {
    (0, employeePrincipalLink_js_1.assertValidLinkInput)(input);
    const existing = await readActiveLinkForEmployee(db, input.tenantId, input.employeeId);
    if (existing !== null) {
        if (existing.principalId === input.principalId)
            return existing;
        throw new EmployeePrincipalLinkConflict("EMPLOYEE_ALREADY_LINKED", `employee ${input.employeeId} is already actively linked to principal ${existing.principalId} ` +
            `in tenant ${input.tenantId}; revoke that link before establishing another`);
    }
    const id = `epl_${(0, node_crypto_1.randomUUID)()}`;
    try {
        const result = await db.query(`INSERT INTO ${TABLE}
         (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status,
          asserted_by, assertion_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, now(), now())
       RETURNING ${SELECT_COLUMNS}`, [
            id,
            input.tenantId,
            input.principalId,
            input.employeeId,
            input.operatingCompanyId,
            input.linkSource,
            input.assertedBy ?? null,
            input.assertionReason ?? null,
        ]);
        return toRecord(result.rows[0]);
    }
    catch (error) {
        throw translateConstraintFailure(error, input);
    }
}
/** Map a Postgres integrity failure to the sentence describing what it prevented. Anything this
 *  module did not anticipate is re-thrown unchanged — swallowing an unknown database error would
 *  turn a real defect into a polite refusal. */
function translateConstraintFailure(error, input) {
    const constraint = error?.constraint;
    if (constraint === EMPLOYEE_INDEX) {
        return new EmployeePrincipalLinkConflict("EMPLOYEE_ALREADY_LINKED", `employee ${input.employeeId} already has an active link in tenant ${input.tenantId}`);
    }
    if (constraint === PRINCIPAL_INDEX) {
        return new EmployeePrincipalLinkConflict("PRINCIPAL_ALREADY_LINKED", `principal ${input.principalId} is already actively linked to a different Employee in tenant ` +
            `${input.tenantId}; one login is not two Employees`);
    }
    if (constraint === MEMBER_FK) {
        return new EmployeePrincipalLinkConflict("NOT_A_TENANT_MEMBER", `principal ${input.principalId} holds no membership in tenant ${input.tenantId}; granting one ` +
            "is an authorization decision this command does not make");
    }
    return error;
}
/** The ACTIVE link for an Employee, or null. */
async function readActiveLinkForEmployee(db, tenantId, employeeId) {
    const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`, [tenantId, employeeId]);
    return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}
/** The ACTIVE link for a principal, or null. */
async function readActiveLinkForPrincipal(db, tenantId, principalId) {
    const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, principalId]);
    return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}
/**
 * "Which Employee is this authenticated principal?" — the one question the runtime asks.
 *
 * Returns the Employee id or null. NULL IS A COMPLETE ANSWER: there is no fallback chain, and in
 * particular no fallback to `users/{uid}.technicianId` or to a `fieldops_technicians` id. A
 * principal with no link is not an Employee as far as this function is concerned, and a caller that
 * needs an Employee must fail closed on the null rather than reach for a second source.
 */
async function resolveEmployeeIdForPrincipal(db, tenantId, principalId) {
    const link = await readActiveLinkForPrincipal(db, tenantId, principalId);
    return link?.employeeId ?? null;
}
/**
 * Revoke the ACTIVE link for an Employee. The row STAYS, with `status = 'revoked'` — the partial
 * unique indexes are declared `WHERE status = 'active'` precisely so history survives and a later
 * re-link is not blocked by it.
 *
 * Returns the revoked record, or null when there was no active link. Null rather than an error
 * because "there is nothing to revoke" is a legitimate end state for a caller that is making sure.
 */
async function revokeLinkForEmployee(db, tenantId, employeeId) {
    const result = await db.query(`UPDATE ${TABLE} SET status = 'revoked', updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'
      RETURNING ${SELECT_COLUMNS}`, [tenantId, employeeId]);
    return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}
/** Every link for an Employee, active and revoked, oldest first. The audit view. */
async function listLinkHistoryForEmployee(db, tenantId, employeeId) {
    const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND employee_id = $2
      ORDER BY created_at, id`, [tenantId, employeeId]);
    return result.rows.map(toRecord);
}
//# sourceMappingURL=employeePrincipalLinkRepository.js.map