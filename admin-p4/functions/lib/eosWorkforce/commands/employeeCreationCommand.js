"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_CREATE_ACTION = void 0;
exports.prepareEmployeeCreation = prepareEmployeeCreation;
exports.createEmployee = createEmployee;
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const employeeProfileCommand_1 = require("./employeeProfileCommand");
const employeeAuthority_1 = require("../../employeeIdentity/employeeAuthority");
const employeeAdministrationAuthority_1 = require("./employeeAdministrationAuthority");
const employeeAdministrationInput_1 = require("./employeeAdministrationInput");
exports.EMPLOYEE_CREATE_ACTION = "employee.record.create";
/** The same slug shape employees_operating_company_shape accepts, and the same one the lifecycle writer checks. */
const COMPANY_ID_SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;
/**
 * A unique violation the body did not pre-empt. Only three unique constraints can fire on this
 * INSERT, and each one is a caller-visible refusal rather than an internal failure.
 */
const creationConflict = (err) => err.constraint === "employees_employee_number_unique_per_tenant"
    ? new employeeCommandKernel_1.EmployeeCommandError("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number")
    : new employeeCommandKernel_1.EmployeeCommandError("EMPLOYEE_ALREADY_EXISTS", "CONFLICT", "an Employee with that id already exists; creating one never changes an existing Employee");
/** Validate a creation input. Pure; runs before any connection is opened. */
function prepareEmployeeCreation(input) {
    const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "employmentStatus", "operatingCompanyId", "profile", "reason"]);
    if (typeof i.employmentStatus !== "string" || !employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.includes(i.employmentStatus)) {
        (0, employeeCommandKernel_1.refuse)("EMPLOYMENT_STATUS_INVALID", "INVALID_INPUT", `employmentStatus is required and must be one of ${employeeAuthority_1.EMPLOYMENT_STATUS_VALUES.join(", ")}`);
    }
    if (typeof i.operatingCompanyId !== "string" || !COMPANY_ID_SHAPE.test(i.operatingCompanyId)) {
        (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_INVALID", "INVALID_INPUT", "operatingCompanyId is required and must be a well-formed operating company id");
    }
    return {
        employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
        employmentStatus: i.employmentStatus,
        operatingCompanyId: i.operatingCompanyId,
        // An absent `profile` is an Employee with no profile fact, which is legitimate. A PRESENT but
        // empty one is accepted as the same thing rather than refused: the caller said "no facts" twice.
        profile: (0, employeeProfileCommand_1.prepareProfileFields)(i.profile === undefined ? {} : i.profile, { allowEmpty: true }),
        reason: (0, employeeAdministrationInput_1.requireGovernedReason)(i.reason),
    };
}
async function assertOperatingCompanyAuthorized(db, tenantId, companyId) {
    // The SAME tenant-scoped governed authority changeOperatingCompany checks (Owner ruling (b),
    // 2026-09-16): a code-recognised id is not enough, the company must be ACTIVE for THIS tenant.
    const { rows } = await db.query(`SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR SHARE`, [tenantId, companyId]);
    if (rows.length === 0) {
        (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT", "PRECONDITION_FAILED", "the operating company is not authorized for this tenant");
    }
    if (rows[0].status !== "ACTIVE")
        (0, employeeCommandKernel_1.refuse)("OPERATING_COMPANY_INACTIVE", "PRECONDITION_FAILED", "the operating company is inactive for this tenant");
}
/**
 * Create ONE Employee in the actor's tenant.
 *
 * One transaction: the id must be free (locked read over the GLOBAL key) -> the operating company
 * must be ACTIVE for this tenant -> the employee number, if stated, must be free in this tenant
 * (case-insensitively, exactly as the profile writer checks it) -> INSERT -> ONE audit event ->
 * COMMIT. Any failure, including the audit insert, rolls back the Employee with it.
 */
async function createEmployee(deps, actor, input) {
    const effective = await (0, employeeAdministrationAuthority_1.withDirectCapabilityGrants)(deps.pool, actor, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, effective, () => prepareEmployeeCreation(input), async (db, p, at) => {
        // THE GLOBAL KEY, READ GLOBALLY. `employees.id` is the PRIMARY KEY, so an id taken in another
        // tenant is taken here too; the read says nothing about that other tenant beyond "not free".
        const existing = await db.query(`SELECT id FROM eos_workforce.employees WHERE id = $1 FOR UPDATE`, [p.employeeId]);
        if (existing.rows.length > 0) {
            (0, employeeCommandKernel_1.refuse)("EMPLOYEE_ALREADY_EXISTS", "CONFLICT", "an Employee with that id already exists; use updateEmployeeProfile, changeEmploymentStatus or changeOperatingCompany to change one");
        }
        await assertOperatingCompanyAuthorized(db, effective.tenantId, p.operatingCompanyId);
        const stated = [...p.profile].filter(([, c]) => c.value !== null);
        const number = p.profile.get("employeeNumber")?.value ?? null;
        if (number) {
            const held = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND upper(employee_number) = upper($2)`, [effective.tenantId, number]);
            if (held.rows.length > 0)
                (0, employeeCommandKernel_1.refuse)("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number");
        }
        const columns = ["id", "tenant_id", "employment_status", "operating_company_id", "created_at", "updated_at",
            ...stated.map(([, c]) => c.column)];
        const values = [p.employeeId, effective.tenantId, p.employmentStatus, p.operatingCompanyId, at, at,
            ...stated.map(([, c]) => c.value)];
        await db.query(`INSERT INTO eos_workforce.employees (${columns.join(", ")})
         VALUES ($1, $2, $3::eos_workforce.workforce_employment_status, $4, $5, $6${stated.map((_, i) => `, $${i + 7}`).join("")})`, values);
        const after = {
            employmentStatus: p.employmentStatus, operatingCompanyId: p.operatingCompanyId,
            ...Object.fromEntries(stated.map(([key, c]) => [key, c.value])),
        };
        // before is NULL, which is what "this Employee did not exist" looks like in the audit trail.
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, effective.tenantId, effective.principalId, exports.EMPLOYEE_CREATE_ACTION, p.employeeId, null, after, p.reason, at);
        return {
            outcome: "CREATED",
            employeeId: p.employeeId,
            employmentStatus: p.employmentStatus,
            operatingCompanyId: p.operatingCompanyId,
            profileFields: stated.map(([key]) => key),
            auditEventId,
            grantedAuthority: Object.freeze([]),
        };
    }, creationConflict, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
}
//# sourceMappingURL=employeeCreationCommand.js.map