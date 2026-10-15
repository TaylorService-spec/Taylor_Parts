"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYMENT_STATUSES = exports.EMPLOYEE_RECORD_READ = void 0;
exports.readEmployee = readEmployee;
exports.listEmployees = listEmployees;
exports.listManagedEmployees = listManagedEmployees;
// EMP-RT-01 readEmployee / listEmployees and EMP-RT-06 listManagedEmployees -- under `employee.record.read`.
//
// SCOPE OF employee.record.read (Owner ruling A). An Employee BUSINESS record and a bounded directory projection. It
// returns NO Principal id, provider identity, Role assignment or account status: another person's Principal linkage is
// readEmployeePrincipalLink, under admin.principalAccess.read (ruling B).
//
// userAccess (ruling B, decided): readEmployee carries `userAccess: "LINKED" | "UNLINKED"`, derived ONLY from whether an
// ACTIVE eos_policy.employee_principal_links row exists for this Employee in this tenant. It reveals no id, no provider,
// no Role and no account status (a disabled Principal's Employee still reads LINKED: the fact is the governed linkage,
// not whether the account can sign in). It is the Employee-facing fact the UI already shows as "User Access linked".
//
// ALL SIX lifecycle statuses are readable; a former Employee stays resolvable. The tenant is the actor's; an Employee of
// another tenant is EMPLOYEE_NOT_FOUND. Lists are keyset-paginated by Employee id, bounded, deterministic.
//
// EMP-RT-06 reads eos_workforce.employee_reporting_relationships (CURRENT rows: effective_to IS NULL) -- a person-level
// reporting relation, NOT the Security Role hierarchy, NOT a Job Role, and not ownership, accountability or assignment.
const employeeReadKernel_1 = require("./employeeReadKernel");
const employeeRecordProjection_1 = require("./employeeRecordProjection");
exports.EMPLOYEE_RECORD_READ = "employee.record.read";
exports.EMPLOYMENT_STATUSES = Object.freeze(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);
function readEmployee(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [exports.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        const { rows } = await db.query(`SELECT ${employeeRecordProjection_1.EMPLOYEE_RECORD_COLUMNS},
                EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                         WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active') AS linked
           FROM eos_workforce.employees e
           ${employeeRecordProjection_1.CURRENT_MANAGER_JOIN}
          WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, employeeId]);
        if (rows.length === 0)
            (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
        return { ...(0, employeeRecordProjection_1.employeeRecordOf)(rows[0]), userAccess: rows[0].linked ? "LINKED" : "UNLINKED" };
    });
}
function pageOf(scope, rows, limit, project) {
    const truncated = rows.length > limit;
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    return { items: kept.map(project), truncated, nextCursor: truncated && last ? (0, employeeReadKernel_1.encodeEmployeeCursor)(scope, { number: last.id, id: last.id }) : null };
}
function prepareDirectory(input) {
    (0, employeeReadKernel_1.acceptOnly)(input, ["limit", "cursor", "employmentStatus"]);
    let statuses = null;
    if (input?.employmentStatus !== undefined) {
        const v = input.employmentStatus;
        const values = typeof v === "string" ? [v] : v;
        if (!Array.isArray(values) || values.length === 0 || values.length > exports.EMPLOYMENT_STATUSES.length
            || !values.every((s) => typeof s === "string" && exports.EMPLOYMENT_STATUSES.includes(s))) {
            (0, employeeReadKernel_1.refuse)("FILTER_INVALID", "INVALID_INPUT", `employmentStatus must be one of, or a non-empty array of, ${exports.EMPLOYMENT_STATUSES.join(", ")}`);
        }
        statuses = [...new Set(values)].sort();
    }
    const scope = `directory:${statuses ? statuses.join(",") : "*"}`;
    return { limit: (0, employeeReadKernel_1.requirePageSize)(input?.limit), statuses, cursor: (0, employeeReadKernel_1.decodeEmployeeCursor)(scope, input?.cursor), scope };
}
/** EMP-RT-01: every Employee of the tenant, any lifecycle status unless filtered, by id, bounded. */
function listEmployees(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => prepareDirectory(input), () => [exports.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, o) => {
        const { rows } = await db.query(`SELECT ${employeeRecordProjection_1.EMPLOYEE_DIRECTORY_COLUMNS}
           FROM eos_workforce.employees e
          WHERE e.tenant_id = $1
            AND ($2::text[] IS NULL OR e.employment_status::text = ANY($2::text[]))
            AND ($3::text IS NULL OR e.id > $3::text)
          ORDER BY e.id ASC
          LIMIT $4`, [tenantId, o.statuses, o.cursor?.id ?? null, o.limit + 1]);
        return pageOf(o.scope, rows, o.limit, employeeRecordProjection_1.directoryItemOf);
    });
}
/** EMP-RT-06: the Employees whose CURRENT manager is this Employee, by id, bounded. */
function listManagedEmployees(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => {
        (0, employeeReadKernel_1.acceptOnly)(input, ["managerEmployeeId", "limit", "cursor"]);
        const managerEmployeeId = (0, employeeReadKernel_1.requireEmployeeId)(input?.managerEmployeeId);
        const scope = `managed:${managerEmployeeId}`;
        return { managerEmployeeId, limit: (0, employeeReadKernel_1.requirePageSize)(input?.limit), cursor: (0, employeeReadKernel_1.decodeEmployeeCursor)(scope, input?.cursor), scope };
    }, () => [exports.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, o) => {
        const manager = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, o.managerEmployeeId]);
        if (manager.rows.length === 0)
            (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
        const { rows } = await db.query(`SELECT ${employeeRecordProjection_1.EMPLOYEE_DIRECTORY_COLUMNS}, rr.effective_from
           FROM eos_workforce.employee_reporting_relationships rr
           JOIN eos_workforce.employees e ON e.tenant_id = rr.tenant_id AND e.id = rr.employee_id
          WHERE rr.tenant_id = $1 AND rr.manager_employee_id = $2 AND rr.effective_to IS NULL
            AND ($3::text IS NULL OR e.id > $3::text)
          ORDER BY e.id ASC
          LIMIT $4`, [tenantId, o.managerEmployeeId, o.cursor?.id ?? null, o.limit + 1]);
        return { managerEmployeeId: o.managerEmployeeId, ...pageOf(o.scope, rows, o.limit, (r) => ({ ...(0, employeeRecordProjection_1.directoryItemOf)(r), reportingSince: (0, employeeReadKernel_1.isoOf)(r.effective_from) })) };
    });
}
//# sourceMappingURL=employeeDirectoryReads.js.map