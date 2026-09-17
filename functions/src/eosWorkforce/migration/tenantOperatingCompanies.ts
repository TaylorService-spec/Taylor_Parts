// TENANT <-> OPERATING COMPANY reconciliation (EMP-RT-W2, Owner ruling option b). Driven only by
// functions/scripts/tenantOperatingCompanyReconcileCli.js, which fences the environment before this module or `pg` loads.
//
// Writes an ACTIVE eos_policy.tenant_operating_companies row for each governed company the named environment's evidence
// lists and the tenant does not yet have. It never deletes, never deactivates, never reactivates and never links a
// company the evidence does not name: an existing row absent from the evidence, or an INACTIVE row the evidence names,
// is REPORTED for a person to decide. Dry run by default; idempotent (a second apply adds zero).
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

export interface TenantOperatingCompanyReport {
  readonly tenantId: string;
  readonly evidenceCompanyIds: readonly string[];
  readonly additions: readonly string[];
  readonly alreadyActive: readonly string[];
  readonly inactiveNotReactivated: readonly string[];
  readonly linkedButNotInEvidence: readonly string[];
  readonly applied: boolean;
}

const SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;

export async function reconcileTenantOperatingCompanies(
  pool: Pool,
  input: { tenantId: string; companyIds: readonly string[]; source: string; actor: string; apply?: boolean },
): Promise<TenantOperatingCompanyReport> {
  const ids = [...new Set(input.companyIds)].sort();
  if (ids.length === 0 || !ids.every((id) => SHAPE.test(id))) throw new Error("the evidence must name at least one well-formed operating company id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`tenant-operating-companies|${input.tenantId}`]);
    const tenant = await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [input.tenantId]);
    if (tenant.rows.length === 0) throw new Error("the tenant does not exist; the reconciliation never creates one");
    const existing = new Map<string, string>((await client.query(
      `SELECT operating_company_id, status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 FOR UPDATE`, [input.tenantId],
    )).rows.map((r) => [r.operating_company_id, r.status]));
    const additions = ids.filter((id) => !existing.has(id));
    const report: TenantOperatingCompanyReport = {
      tenantId: input.tenantId,
      evidenceCompanyIds: ids,
      additions,
      alreadyActive: ids.filter((id) => existing.get(id) === "ACTIVE"),
      inactiveNotReactivated: ids.filter((id) => existing.get(id) === "INACTIVE"),
      linkedButNotInEvidence: [...existing.keys()].filter((id) => !ids.includes(id)).sort(),
      applied: input.apply === true && additions.length > 0,
    };
    if (report.applied) {
      for (const id of additions) {
        await client.query(
          `INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1, $2, 'ACTIVE', $3, $4, $4)`,
          [input.tenantId, id, input.source, input.actor],
        );
      }
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         VALUES ($1, $2, 'tenant.operatingCompanies.reconcile', $3, 'tenant', $2, NULL, $4, $5)`,
        [`audit_${randomUUID()}`, input.tenantId, input.actor, JSON.stringify({ added: additions }), input.source],
      );
    }
    await client.query(report.applied ? "COMMIT" : "ROLLBACK");
    return report;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
