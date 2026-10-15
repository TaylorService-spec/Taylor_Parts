"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_DIRECTORY_COLUMNS = exports.CURRENT_MANAGER_JOIN = exports.EMPLOYEE_RECORD_COLUMNS = void 0;
exports.deriveEmployeeDisplayName = deriveEmployeeDisplayName;
exports.employeeRecordOf = employeeRecordOf;
exports.directoryItemOf = directoryItemOf;
// The Employee BUSINESS record projection -- one shape for EMP-RT-01 readEmployee and EMP-RT-07 readMyEmployeeProfile,
// and the bounded directory item for listEmployees / listManagedEmployees.
//
// Every field is an eos_workforce fact (migration 019 + the profile/reporting migration). Nothing here is a Principal,
// credential, provider identity, Role, account status, operational eligibility marker or Job Role.
//
// DISPLAY NAME RULE (deterministic, documented in the migration header): preferred_name, else display_name, else
// first_name + ' ' + last_name (whichever are present), else null. The first two steps are the client's existing
// employeeDisplayName (field-ops-app-vite/src/domain/employeeProfile.js:154-159). eos_policy.principals.display_name is
// never consulted.
const employeeReadKernel_1 = require("./employeeReadKernel");
function deriveEmployeeDisplayName(r) {
    if (r.preferred_name)
        return r.preferred_name;
    if (r.display_name)
        return r.display_name;
    const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
    return joined === "" ? null : joined;
}
/** Selects `e` (the Employee) and `rr` / `m` (the current reporting relationship and its manager). */
exports.EMPLOYEE_RECORD_COLUMNS = `e.id, e.employment_status::text AS employment_status, e.operating_company_id, e.employee_number,
  e.display_name, e.first_name, e.middle_name, e.last_name, e.preferred_name, e.job_title, e.work_email, e.work_phone, e.mobile_phone,
  e.address_street, e.address_unit, e.address_city, e.address_state, e.address_postal_code,
  to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date, to_char(e.separation_date, 'YYYY-MM-DD') AS separation_date, e.created_at, e.updated_at,
  rr.manager_employee_id AS manager_id, rr.effective_from AS manager_effective_from,
  m.preferred_name AS manager_preferred_name, m.display_name AS manager_display_name, m.first_name AS manager_first_name, m.last_name AS manager_last_name`;
exports.CURRENT_MANAGER_JOIN = `LEFT JOIN eos_workforce.employee_reporting_relationships rr
    ON rr.tenant_id = e.tenant_id AND rr.employee_id = e.id AND rr.effective_to IS NULL
  LEFT JOIN eos_workforce.employees m ON m.tenant_id = rr.tenant_id AND m.id = rr.manager_employee_id`;
function employeeRecordOf(r) {
    return {
        employeeId: r.id,
        employmentStatus: r.employment_status,
        operatingCompanyId: r.operating_company_id,
        employeeNumber: r.employee_number ?? null,
        displayName: deriveEmployeeDisplayName(r),
        name: {
            displayName: r.display_name ?? null, firstName: r.first_name ?? null, middleName: r.middle_name ?? null,
            lastName: r.last_name ?? null, preferredName: r.preferred_name ?? null,
        },
        jobTitle: r.job_title ?? null,
        contact: { workEmail: r.work_email ?? null, workPhone: r.work_phone ?? null, mobilePhone: r.mobile_phone ?? null },
        address: {
            street: r.address_street ?? null, unit: r.address_unit ?? null, city: r.address_city ?? null,
            state: r.address_state ?? null, postalCode: r.address_postal_code ?? null,
        },
        hireDate: r.hire_date ?? null,
        separationDate: r.separation_date ?? null,
        currentManager: r.manager_id == null ? null : {
            managerEmployeeId: r.manager_id,
            displayName: deriveEmployeeDisplayName({ preferred_name: r.manager_preferred_name, display_name: r.manager_display_name, first_name: r.manager_first_name, last_name: r.manager_last_name }),
            effectiveFrom: (0, employeeReadKernel_1.isoOf)(r.manager_effective_from),
        },
        createdAt: (0, employeeReadKernel_1.isoOf)(r.created_at),
        updatedAt: (0, employeeReadKernel_1.isoOf)(r.updated_at),
    };
}
/** The bounded directory projection: identity, name, lifecycle, company, title. No contact or address. */
exports.EMPLOYEE_DIRECTORY_COLUMNS = `e.id, e.employment_status::text AS employment_status, e.operating_company_id, e.employee_number,
  e.display_name, e.first_name, e.last_name, e.preferred_name, e.job_title`;
function directoryItemOf(r) {
    return {
        employeeId: r.id, displayName: deriveEmployeeDisplayName(r), employeeNumber: r.employee_number ?? null,
        employmentStatus: r.employment_status, operatingCompanyId: r.operating_company_id, jobTitle: r.job_title ?? null,
    };
}
//# sourceMappingURL=employeeRecordProjection.js.map