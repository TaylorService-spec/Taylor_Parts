"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEmployeeOperationalScopes = listEmployeeOperationalScopes;
exports.listEmployeeOperationalScopeHistory = listEmployeeOperationalScopeHistory;
exports.listOperationalScopeTargets = listOperationalScopeTargets;
// Step C: the governed PostgreSQL OPERATIONAL SCOPE reads.
//
// Visibility reuses employee.record.read, for the same reason Job Role and Work Eligibility do: reading which
// warehouses an Employee covers is the same business visibility as reading the Employee record. Every read is a
// READ ONLY snapshot through the shared Employee read kernel.
//
//   listEmployeeOperationalScopes         one Employee's CURRENT scopes (the Administration surface's list)
//   listEmployeeOperationalScopeHistory   one Employee's full history, newest first; open rows are `current`
//
// A scope read returns scope facts ONLY. It names no Security Role, capability, permission, Job Role, qualification,
// ownership, assignment, manager or operating-company authority. It infers nothing: an Employee with no scopes reads
// as an empty list, never as a warehouse derived from a legacy role string, Job Role, manager or operating company.
//
// WHY THE WAREHOUSE STATUS IS RETURNED. A scope assigned while its warehouse was ACTIVE stays recorded if that
// warehouse is later deactivated -- the command deliberately performs no silent revocation. Surfacing
// `warehouseStatus` is what lets Administration SEE that remediation case instead of it hiding behind a name. The
// status is reported, never enforced here; a read decides nothing.
const employeeReadKernel_1 = require("./employeeReadKernel");
const employeeDirectoryReads_1 = require("./employeeDirectoryReads");
const operationalScopeVocabulary_1 = require("../operationalScopeVocabulary");
const MAX_HISTORY = 100;
const itemOf = (r) => ({
    operationalScopeId: r.id,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    scopeName: r.warehouse_name ?? r.scope_id,
    scopeTypeLabel: operationalScopeVocabulary_1.OPERATIONAL_SCOPE_TYPE_LABEL[r.scope_type],
    warehouseStatus: r.warehouse_status ?? "UNKNOWN",
    current: r.effective_to === null,
    effectiveFrom: (0, employeeReadKernel_1.isoOf)(r.effective_from),
    effectiveTo: (0, employeeReadKernel_1.isoOf)(r.effective_to),
    reason: r.reason ?? null,
});
// The join is tenant-safe on BOTH columns, matching the table's composite foreign key. LEFT, not INNER: a read must
// still report a scope row even if its target somehow cannot be resolved, rather than silently dropping it.
const SCOPE_SELECT = `SELECT s.id, s.scope_type, s.scope_id, s.effective_from, s.effective_to, s.reason,
                             w.name AS warehouse_name, w.status::text AS warehouse_status
                        FROM eos_workforce.employee_operational_scopes s
                        LEFT JOIN eos_ops.warehouses w ON w.tenant_id = s.tenant_id AND w.id = s.scope_id`;
async function requireEmployee(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    if (rows.length === 0)
        (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}
/** The Employee's CURRENT operational scopes. Several concurrent warehouses are ordinary; none is equally ordinary. */
function listEmployeeOperationalScopes(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        await requireEmployee(db, tenantId, employeeId);
        const { rows } = await db.query(`${SCOPE_SELECT} WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.effective_to IS NULL
          ORDER BY s.scope_type, lower(coalesce(w.name, s.scope_id)), s.scope_id`, [tenantId, employeeId]);
        return { employeeId, items: rows.map(itemOf) };
    });
}
/** The Employee's full scope history, newest first. Ended periods are kept: the table refuses DELETE. */
function listEmployeeOperationalScopeHistory(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, ["employeeId"]); return (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId); }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId, _principalId, employeeId) => {
        await requireEmployee(db, tenantId, employeeId);
        const { rows } = await db.query(`${SCOPE_SELECT} WHERE s.tenant_id = $1 AND s.employee_id = $2
          ORDER BY s.effective_from DESC, s.id DESC LIMIT $3`, [tenantId, employeeId, MAX_HISTORY + 1]);
        const items = rows.slice(0, MAX_HISTORY).map(itemOf);
        return { employeeId, current: items.filter((i) => i.current), items, truncated: rows.length > MAX_HISTORY };
    });
}
const TARGET_SOURCES = Object.freeze({
    WAREHOUSE: Object.freeze({
        valueSource: "eos_ops.warehouses (ACTIVE, this tenant)",
        sql: `SELECT id AS value, coalesce(name, id) AS label FROM eos_ops.warehouses
           WHERE tenant_id = $1 AND status::text = 'ACTIVE' ORDER BY lower(coalesce(name, id)), id`,
    }),
    REORDER_QUEUE: Object.freeze({
        valueSource: "eos_policy.tenant_operating_company_keys (ACTIVE, this tenant)",
        sql: `SELECT operating_company_key AS value, operating_company_id || ' queue (' || operating_company_key || ')' AS label
            FROM eos_policy.tenant_operating_company_keys
           WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY operating_company_id, operating_company_key`,
    }),
    // OD-T1: a truck's MOBILE location (labelled with its truck when one is linked). Only ACTIVE locations, and never one whose
    // linked truck is inactive -- the same rule the writer enforces.
    MOBILE: Object.freeze({
        valueSource: "eos_ops.mobile_locations (ACTIVE, this tenant; a linked truck must be active)",
        sql: `SELECT m.location_id AS value,
                 coalesce(t.display_label || ' (' || t.vehicle_number || ')', m.display_label) AS label
            FROM eos_ops.mobile_locations m
            LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
           WHERE m.tenant_id = $1 AND m.active AND (t.truck_id IS NULL OR t.active)
           ORDER BY lower(coalesce(t.display_label, m.display_label)), m.location_id`,
    }),
});
/** The governed, tenant-scoped values each Operational Scope type may take. Gate: employee.record.read. */
function listOperationalScopeTargets(deps, actor, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => { (0, employeeReadKernel_1.acceptOnly)(input, []); return null; }, () => [employeeDirectoryReads_1.EMPLOYEE_RECORD_READ], async (db, tenantId) => {
        const scopeTypes = [];
        for (const scopeType of operationalScopeVocabulary_1.OPERATIONAL_SCOPE_TYPES) {
            const source = TARGET_SOURCES[scopeType];
            const { rows } = await db.query(source.sql, [tenantId]);
            scopeTypes.push(Object.freeze({
                scopeType, label: operationalScopeVocabulary_1.OPERATIONAL_SCOPE_TYPE_LABEL[scopeType], valueSource: source.valueSource,
                available: rows.length > 0,
                reason: rows.length > 0 ? null : `no ACTIVE governed value in this tenant (${source.valueSource})`,
                values: Object.freeze(rows.map((r) => Object.freeze({ value: String(r.value), label: String(r.label) }))),
            }));
        }
        return { scopeTypes: Object.freeze(scopeTypes) };
    });
}
//# sourceMappingURL=operationalScopeReads.js.map