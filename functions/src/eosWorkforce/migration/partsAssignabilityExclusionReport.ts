// The PostgreSQL half of the Parts assignability exclusion measurement. READ ONLY, in one snapshot.
//
// Split from the classifier so that module stays pure: the partition is a function of its inputs, and this file
// only fetches facts. The same separation the step D/E evidence lane uses.
//
// The Security Roles it reads are EVIDENCE for the Owner ruling. They are never an input to an eligibility rule --
// making a Security Role a requirement for Work Eligibility is the conflation the decomposition removes.
import type { GovernedEmployeeFacts } from "./partsAssignabilityExclusion";

/**
 * Read the governed facts for the report from PostgreSQL. READ ONLY, in one snapshot.
 *
 * Security Roles are resolved through the Employee's ACTIVE Principal link and its QUALIFYING assignments -- the
 * same chain the authority itself uses, so the evidence matches what the runtime would see. They are reported for
 * the ruling and are never an input to any eligibility decision.
 */
export async function buildGovernedEmployeeFacts(
  pool: { connect: () => Promise<{ query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; release: () => void }> },
  tenantId: string,
): Promise<ReadonlyMap<string, GovernedEmployeeFacts>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const employees = await client.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1`, [tenantId]);
    const roles = await client.query(
      `SELECT l.employee_id, r.key
         FROM eos_policy.employee_principal_links l
         JOIN eos_policy.user_role_assignments a ON a.tenant_id = l.tenant_id AND a.principal_uid = l.principal_id
         JOIN eos_policy.roles r ON r.id = a.role_id
        WHERE l.tenant_id = $1 AND l.status = 'active' AND a.status = 'active'`,
      [tenantId],
    );
    const jobRoles = await client.query(
      `SELECT a.employee_id, j.display_name
         FROM eos_workforce.employee_job_role_assignments a
         JOIN eos_workforce.job_roles j ON j.tenant_id = a.tenant_id AND j.id = a.job_role_id
        WHERE a.tenant_id = $1 AND a.effective_to IS NULL`,
      [tenantId],
    );
    await client.query("COMMIT");

    const byEmployee = new Map<string, { securityRoleKeys: string[]; jobRole: string | null; knownToPostgres: boolean }>();
    for (const r of employees.rows) byEmployee.set(r.id as string, { securityRoleKeys: [], jobRole: null, knownToPostgres: true });
    for (const r of roles.rows) byEmployee.get(r.employee_id as string)?.securityRoleKeys.push(r.key as string);
    for (const r of jobRoles.rows) {
      const entry = byEmployee.get(r.employee_id as string);
      if (entry) entry.jobRole = r.display_name as string;
    }
    return byEmployee;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
