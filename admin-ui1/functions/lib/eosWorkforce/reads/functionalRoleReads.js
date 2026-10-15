"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FUNCTIONAL_ROLE_HISTORY_ACTIONS = void 0;
exports.listFunctionalRoles = listFunctionalRoles;
exports.listEmployeeFunctionalRoles = listEmployeeFunctionalRoles;
exports.listFunctionalRoleHolders = listFunctionalRoleHolders;
exports.listFunctionalRoleHistory = listFunctionalRoleHistory;
// The governed PostgreSQL FUNCTIONAL ROLE reads. Visibility reuses employee.record.read -- reading an Employee's
// business responsibilities is the same business visibility as reading the Employee record, exactly as the Job Role and
// Work Eligibility reads do; no extra read capability is invented. Every read is one READ ONLY snapshot through the
// shared Employee read kernel, tenant-scoped by the actor.
//
//   listFunctionalRoles             the tenant catalog (ACTIVE and INACTIVE), each with its current holder count
//   listFunctionalRoleHolders       one Functional Role's current and scheduled holders
//   listEmployeeFunctionalRoles     one Employee's current, scheduled and past assignments
//   listFunctionalRoleHistory       one Functional Role's audit history: catalog changes and assignment changes
//
// A Functional Role read returns business responsibility only. It names no Security Role, capability or permission,
// and nothing here derives one.
const employeeReadKernel_1 = require("./employeeReadKernel");
const employeeRecordProjection_1 = require("./employeeRecordProjection");
const employeeDirectoryReads_1 = require("./employeeDirectoryReads");
const functionalRoleVocabulary_1 = require("../functionalRoleVocabulary");
const MAX_CATALOG = 200;
const MAX_HOLDERS = 500;
const MAX_HISTORY = 100;
function requireFunctionalRoleId(value) {
    if (typeof value !== "string" || !functionalRoleVocabulary_1.FUNCTIONAL_ROLE_ID_SHAPE.test(value)) {
        (0, employeeReadKernel_1.refuse)("FUNCTIONAL_ROLE_ID_INVALID", "INVALID_INPUT", "functionalRoleId must be a governed Functional Role id");
    }
    return value;
}
function requireLimit(value) {
    if (value === undefined || value === null)
        return MAX_HISTORY;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_HISTORY) {
        (0, employeeReadKernel_1.refuse)("LIMIT_INVALID", "INVALID_INPUT", `limit must be an integer from 1 to ${MAX_HISTORY}`);
    }
    return value;
}
const CURRENT = `a.effective_from <= now() AND (a.effective_to IS NULL OR a.effective_to > now())`;
function listFunctionalRoles(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => {
        (0, employeeReadKernel_1.acceptOnly)(input, ["status"]);
        const status = input?.status;
        if (status !== undefined && !functionalRoleVocabulary_1.FUNCTIONAL_ROLE_STATUSES.includes(status)) {
            (0, employeeReadKernel_1.refuse)("FUNCTIONAL_ROLE_STATUS_INVALID", "INVALID_INPUT", `status must be one of ${functionalRoleVocabulary_1.FUNCTIONAL_ROLE_STATUSES.join(", ")}`);
        }
        return status ?? null;
    }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, status) => {
        const { rows } = await db.query(`SELECT r.id, r.key, r.name, r.description, r.status, r.created_at, r.updated_at,
                (SELECT count(*)::int FROM eos_workforce.employee_functional_role_assignments a
                  WHERE a.tenant_id = r.tenant_id AND a.functional_role_id = r.id AND ${CURRENT}) AS holders
           FROM eos_workforce.functional_roles r
          WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.status = $2)
          ORDER BY lower(r.name), r.id LIMIT $3`, [tenantId, status, MAX_CATALOG]);
        return {
            items: rows.map((r) => ({
                functionalRoleId: r.id, key: r.key, name: r.name, description: r.description ?? null, status: r.status,
                currentHolderCount: r.holders, createdAt: (0, employeeReadKernel_1.isoOf)(r.created_at), updatedAt: (0, employeeReadKernel_1.isoOf)(r.updated_at),
            })),
        };
    });
}
const STATE = `CASE WHEN a.effective_from > now() AND (a.effective_to IS NULL OR a.effective_to > a.effective_from) THEN 'SCHEDULED'
                    WHEN ${CURRENT} THEN 'CURRENT' ELSE 'ENDED' END`;
const assignmentOf = (r) => ({
    assignmentId: String(r.id), functionalRoleId: String(r.functional_role_id), key: String(r.key), name: String(r.name),
    functionalRoleStatus: String(r.role_status), state: r.state,
    effectiveFrom: (0, employeeReadKernel_1.isoOf)(r.effective_from), effectiveTo: (0, employeeReadKernel_1.isoOf)(r.effective_to ?? null),
    assignmentSource: String(r.assignment_source), reason: String(r.reason), endReason: r.end_reason ?? null,
});
const ASSIGNMENT_COLUMNS = `a.id, a.functional_role_id, r.key, r.name, r.status AS role_status, ${STATE} AS state,
  a.effective_from, a.effective_to, a.assignment_source, a.reason, a.end_reason`;
function listEmployeeFunctionalRoles(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        const employee = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
        if (employee.rows.length === 0)
            (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
        const { rows } = await db.query(`SELECT ${ASSIGNMENT_COLUMNS}
           FROM eos_workforce.employee_functional_role_assignments a
           JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
          WHERE a.tenant_id = $1 AND a.employee_id = $2
          ORDER BY a.effective_from DESC, a.id DESC LIMIT $3`, [tenantId, employeeId, MAX_HISTORY + 1]);
        const items = rows.slice(0, MAX_HISTORY).map(assignmentOf);
        return {
            employeeId,
            current: items.filter((i) => i.state === "CURRENT"),
            scheduled: items.filter((i) => i.state === "SCHEDULED"),
            items,
            truncated: rows.length > MAX_HISTORY,
        };
    });
}
function listFunctionalRoleHolders(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["functionalRoleId"]); return requireFunctionalRoleId(input?.functionalRoleId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, functionalRoleId) => {
        const role = await db.query(`SELECT 1 FROM eos_workforce.functional_roles WHERE tenant_id = $1 AND id = $2`, [tenantId, functionalRoleId]);
        if (role.rows.length === 0)
            (0, employeeReadKernel_1.refuse)("FUNCTIONAL_ROLE_NOT_FOUND", "NOT_FOUND", "the Functional Role does not exist in this tenant");
        const { rows } = await db.query(`SELECT ${ASSIGNMENT_COLUMNS}, ${employeeRecordProjection_1.EMPLOYEE_DIRECTORY_COLUMNS}, a.id AS assignment_row_id
           FROM eos_workforce.employee_functional_role_assignments a
           JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
           JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.employee_id
          WHERE a.tenant_id = $1 AND a.functional_role_id = $2 AND (a.effective_to IS NULL OR a.effective_to > now())
            AND (a.effective_to IS NULL OR a.effective_to > a.effective_from)
          ORDER BY a.effective_from, a.id LIMIT $3`, [tenantId, functionalRoleId, MAX_HOLDERS + 1]);
        const holders = rows.slice(0, MAX_HOLDERS).map((r) => ({
            ...assignmentOf({ ...r, id: r.assignment_row_id }),
            employee: (0, employeeRecordProjection_1.directoryItemOf)(r),
        }));
        return { functionalRoleId, holders, truncated: rows.length > MAX_HOLDERS };
    });
}
const HISTORY_KEYS = ["functionalRoleId", "functionalRoleKey", "key", "name", "description", "status", "assignmentId", "effectiveFrom", "effectiveTo"];
const project = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const out = {};
    for (const k of HISTORY_KEYS)
        if (Object.prototype.hasOwnProperty.call(value, k))
            out[k] = value[k] ?? null;
    return out;
};
/** The closed set of actions this history shows. Anything else is not Functional Role history. */
exports.FUNCTIONAL_ROLE_HISTORY_ACTIONS = Object.freeze([
    functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_CATALOG_STATUS_ACTION,
    functionalRoleVocabulary_1.FUNCTIONAL_ROLE_ASSIGN_ACTION, functionalRoleVocabulary_1.FUNCTIONAL_ROLE_END_ACTION,
]);
function listFunctionalRoleHistory(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["functionalRoleId", "limit"]); return { id: requireFunctionalRoleId(input?.functionalRoleId), limit: requireLimit(input?.limit) }; }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, p) => {
        const role = await db.query(`SELECT 1 FROM eos_workforce.functional_roles WHERE tenant_id = $1 AND id = $2`, [tenantId, p.id]);
        if (role.rows.length === 0)
            (0, employeeReadKernel_1.refuse)("FUNCTIONAL_ROLE_NOT_FOUND", "NOT_FOUND", "the Functional Role does not exist in this tenant");
        const { rows } = await db.query(`SELECT action, occurred_at, target_kind, target_id, before, after, reason FROM eos_policy.audit_events
          WHERE tenant_id = $1 AND action = ANY($3::text[])
            AND ((target_kind = $4 AND target_id = $2)
                 OR (target_kind = 'employee' AND (before ->> 'functionalRoleId' = $2 OR after ->> 'functionalRoleId' = $2)))
          ORDER BY occurred_at DESC, id DESC LIMIT $5`, [tenantId, p.id, [...exports.FUNCTIONAL_ROLE_HISTORY_ACTIONS], functionalRoleVocabulary_1.FUNCTIONAL_ROLE_AUDIT_TARGET_KIND, p.limit]);
        return {
            functionalRoleId: p.id,
            items: rows.map((r) => ({
                action: r.action, occurredAt: (0, employeeReadKernel_1.isoOf)(r.occurred_at),
                employeeId: r.target_kind === "employee" ? r.target_id : null,
                before: project(r.before), after: project(r.after), reason: r.reason ?? null,
            })),
        };
    });
}
//# sourceMappingURL=functionalRoleReads.js.map