// Steps D/E: build the PostgreSQL RESOLUTION VIEW and produce the legacy evidence census.
//
// READ ONLY, STRUCTURALLY. Every statement runs inside one `REPEATABLE READ READ ONLY` transaction, so PostgreSQL
// itself refuses a write attempted here -- the guarantee does not depend on this file staying careful. There is no
// apply path, no `--apply` flag anywhere in this lane, and the census it returns carries `applied: false`.
//
// ONE SNAPSHOT, ONE ANSWER. All four reads share a single snapshot, so the Employees, warehouses, qualifications and
// scopes a finding is judged against are mutually consistent. Reading them separately could classify a scope as
// UNKNOWN_WAREHOUSE against one instant and ALREADY_GOVERNED against another.
//
// The classification itself lives in the pure module (legacyWorkforceEvidence.ts). This file only fetches facts.
import type { Pool } from "pg";
import { censusLegacyWorkforceEvidence, type LegacyWorkforceEvidenceCensus, type WorkforceResolutionView } from "./legacyWorkforceEvidence";
import type { EmployeeProfileSnapshot } from "./employeeProfileSnapshot";

/**
 * Read what PostgreSQL currently holds for one tenant.
 *
 * Warehouses are read across ALL tenants, and ONLY so that a legacy id naming another tenant's warehouse can be
 * reported as CROSS_TENANT rather than hidden inside UNKNOWN_WAREHOUSE. No candidate may ever name one: the pure
 * census refuses any warehouse whose tenant is not the view's tenant.
 */
export async function buildWorkforceResolutionView(pool: Pool, tenantId: string): Promise<WorkforceResolutionView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if ((await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId])).rows.length === 0) {
      throw new Error("the tenant does not exist; the census never creates one");
    }
    const employees = await client.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1`, [tenantId]);
    const warehouses = await client.query(`SELECT id, tenant_id, status::text AS status FROM eos_ops.warehouses`);
    const qualifications = await client.query(
      `SELECT employee_id, qualification_code FROM eos_workforce.employee_work_eligibility
        WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId],
    );
    const scopes = await client.query(
      `SELECT employee_id, scope_type, scope_id FROM eos_workforce.employee_operational_scopes
        WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId],
    );
    await client.query("COMMIT");
    return {
      tenantId,
      employees: new Set(employees.rows.map((r) => r.id as string)),
      warehouses: new Map(warehouses.rows.map((r) => [r.id as string, { tenantId: r.tenant_id as string, status: r.status as string }])),
      currentQualifications: new Set(qualifications.rows.map((r) => `${r.employee_id}|${r.qualification_code}`)),
      currentScopes: new Set(scopes.rows.map((r) => `${r.employee_id}|${r.scope_type}|${r.scope_id}`)),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The whole lane in one call: read the view, classify the snapshot, return the evidence. Mutates nothing. */
export async function reportLegacyWorkforceEvidence(
  pool: Pool, input: { readonly tenantId: string; readonly snapshot: EmployeeProfileSnapshot },
): Promise<LegacyWorkforceEvidenceCensus> {
  return censusLegacyWorkforceEvidence(input.snapshot, await buildWorkforceResolutionView(pool, input.tenantId));
}
