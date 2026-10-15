"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWorkforceResolutionView = buildWorkforceResolutionView;
exports.reportLegacyWorkforceEvidence = reportLegacyWorkforceEvidence;
const legacyWorkforceEvidence_1 = require("./legacyWorkforceEvidence");
/**
 * Read what PostgreSQL currently holds for one tenant.
 *
 * Warehouses are read across ALL tenants, and ONLY so that a legacy id naming another tenant's warehouse can be
 * reported as CROSS_TENANT rather than hidden inside UNKNOWN_WAREHOUSE. No candidate may ever name one: the pure
 * census refuses any warehouse whose tenant is not the view's tenant.
 */
async function buildWorkforceResolutionView(pool, tenantId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        if ((await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId])).rows.length === 0) {
            throw new Error("the tenant does not exist; the census never creates one");
        }
        const employees = await client.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1`, [tenantId]);
        const warehouses = await client.query(`SELECT id, tenant_id, status::text AS status FROM eos_ops.warehouses`);
        const qualifications = await client.query(`SELECT employee_id, qualification_code FROM eos_workforce.employee_work_eligibility
        WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId]);
        const scopes = await client.query(`SELECT employee_id, scope_type, scope_id FROM eos_workforce.employee_operational_scopes
        WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId]);
        await client.query("COMMIT");
        return {
            tenantId,
            employees: new Set(employees.rows.map((r) => r.id)),
            warehouses: new Map(warehouses.rows.map((r) => [r.id, { tenantId: r.tenant_id, status: r.status }])),
            currentQualifications: new Set(qualifications.rows.map((r) => `${r.employee_id}|${r.qualification_code}`)),
            currentScopes: new Set(scopes.rows.map((r) => `${r.employee_id}|${r.scope_type}|${r.scope_id}`)),
        };
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
/** The whole lane in one call: read the view, classify the snapshot, return the evidence. Mutates nothing. */
async function reportLegacyWorkforceEvidence(pool, input) {
    return (0, legacyWorkforceEvidence_1.censusLegacyWorkforceEvidence)(input.snapshot, await buildWorkforceResolutionView(pool, input.tenantId));
}
//# sourceMappingURL=legacyWorkforceEvidenceReport.js.map