"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_FUNCTIONAL_ROLE_PREDICATE = void 0;
exports.listCurrentFunctionalRoles = listCurrentFunctionalRoles;
exports.postgresWorkflowFunctionalRoleFacts = postgresWorkflowFunctionalRoleFacts;
exports.CURRENT_FUNCTIONAL_ROLE_PREDICATE = `a.effective_from <= now() AND (a.effective_to IS NULL OR a.effective_to > now()) AND r.status = 'ACTIVE'`;
async function listCurrentFunctionalRoles(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT a.id, a.functional_role_id, a.effective_from, a.effective_to, r.key, r.name
       FROM eos_workforce.employee_functional_role_assignments a
       JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
      WHERE a.tenant_id = $1 AND a.employee_id = $2 AND ${exports.CURRENT_FUNCTIONAL_ROLE_PREDICATE}
      ORDER BY r.key`, [tenantId, employeeId]);
    return rows.map((r) => Object.freeze({
        functionalRoleId: String(r.functional_role_id), key: String(r.key), name: String(r.name), assignmentId: String(r.id),
        effectiveFrom: r.effective_from.toISOString(), effectiveTo: r.effective_to ? r.effective_to.toISOString() : null,
    }));
}
/**
 * The PostgreSQL facts for ONE acting Principal. The Employee is found through the ACTIVE principal link only -- the
 * Principal id never stands in for an Employee id -- and a Principal with no link holds no Functional Role.
 */
function postgresWorkflowFunctionalRoleFacts(db, tenantId, principalId) {
    return {
        async currentFunctionalRoles() {
            const link = await db.query(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, principalId]);
            const employeeId = link.rows.length === 1 ? String(link.rows[0].employee_id) : null;
            if (!employeeId)
                return { employeeId: null, functionalRoleIds: [] };
            const current = await listCurrentFunctionalRoles(db, tenantId, employeeId);
            return { employeeId, functionalRoleIds: current.map((c) => c.functionalRoleId) };
        },
    };
}
//# sourceMappingURL=functionalRoleFacts.js.map