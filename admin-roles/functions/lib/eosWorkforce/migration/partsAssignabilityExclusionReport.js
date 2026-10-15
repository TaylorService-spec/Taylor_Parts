"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGovernedEmployeeFacts = buildGovernedEmployeeFacts;
/**
 * Read the governed facts for the report from PostgreSQL. READ ONLY, in one snapshot.
 *
 * Security Roles are resolved through the Employee's ACTIVE Principal link and its QUALIFYING assignments -- the
 * same chain the authority itself uses, so the evidence matches what the runtime would see. They are reported for
 * the ruling and are never an input to any eligibility decision.
 */
async function buildGovernedEmployeeFacts(pool, tenantId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const employees = await client.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1`, [tenantId]);
        const roles = await client.query(`SELECT l.employee_id, r.key
         FROM eos_policy.employee_principal_links l
         JOIN eos_policy.user_role_assignments a ON a.tenant_id = l.tenant_id AND a.principal_id = l.principal_id
         JOIN eos_policy.roles r ON r.id = a.role_id
         LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
        WHERE l.tenant_id = $1 AND l.status = 'active' AND a.status = 'active'
          -- Pass 9 S3: GLOBAL, NON-STALE assignments only -- the runtime's rule; a scoped Role is not tenant-wide.
          AND a.scope_type = 'global' AND a.access_version_at_grant <= coalesce(v.access_version, 0)`, [tenantId]);
        const jobRoles = await client.query(`SELECT a.employee_id, j.display_name
         FROM eos_workforce.employee_job_role_assignments a
         JOIN eos_workforce.job_roles j ON j.tenant_id = a.tenant_id AND j.id = a.job_role_id
        WHERE a.tenant_id = $1 AND a.effective_to IS NULL`, [tenantId]);
        await client.query("COMMIT");
        const byEmployee = new Map();
        for (const r of employees.rows)
            byEmployee.set(r.id, { securityRoleKeys: [], jobRole: null, knownToPostgres: true });
        for (const r of roles.rows)
            byEmployee.get(r.employee_id)?.securityRoleKeys.push(r.key);
        for (const r of jobRoles.rows) {
            const entry = byEmployee.get(r.employee_id);
            if (entry)
                entry.jobRole = r.display_name;
        }
        return byEmployee;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=partsAssignabilityExclusionReport.js.map