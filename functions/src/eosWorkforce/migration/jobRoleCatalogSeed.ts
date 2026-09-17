// EMP-RT-08 launch Job Role catalog seed (Owner ruling 2026-09-16). Driven only by functions/scripts/jobRoleCatalogSeedCli.js,
// which fences the environment and tenant before this module or `pg` loads.
//
// Adds the Owner-named launch Job Roles as ACTIVE catalog entries for ONE tenant. It never renames, deactivates, deletes
// or re-activates an existing entry, and never assigns a Job Role to any Employee (assignments start empty). An existing
// entry whose name or status differs from the ruling is REPORTED for a person to decide. Dry run by default; idempotent.
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

/** The Owner-ruled launch catalog. Stable ids; display names are the ruling's words. Retail and National Accounts Sales are distinct. */
export const LAUNCH_JOB_ROLES = Object.freeze([
  Object.freeze({ jobRoleId: "owner", displayName: "Owner" }),
  Object.freeze({ jobRoleId: "general-manager", displayName: "General Manager" }),
  Object.freeze({ jobRoleId: "service-manager", displayName: "Service Manager" }),
  Object.freeze({ jobRoleId: "service-coordinator-dispatcher", displayName: "Service Coordinator / Dispatcher" }),
  Object.freeze({ jobRoleId: "service-technician", displayName: "Service Technician" }),
  Object.freeze({ jobRoleId: "retail-sales", displayName: "Retail Sales" }),
  Object.freeze({ jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales" }),
  Object.freeze({ jobRoleId: "parts-warehouse", displayName: "Parts / Warehouse" }),
  Object.freeze({ jobRoleId: "accounting", displayName: "Accounting" }),
  Object.freeze({ jobRoleId: "office-administration", displayName: "Office / Administration" }),
]);

export interface JobRoleCatalogSeedReport {
  readonly tenantId: string;
  readonly additions: readonly string[];
  readonly alreadyPresent: readonly string[];
  readonly differsFromRuling: readonly { jobRoleId: string; displayName: string; status: string }[];
  readonly notInRuling: readonly string[];
  readonly applied: boolean;
}

export async function seedJobRoleCatalog(pool: Pool, input: { tenantId: string; actor: string; apply?: boolean }): Promise<JobRoleCatalogSeedReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`job-role-catalog-seed|${input.tenantId}`]);
    if ((await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [input.tenantId])).rows.length === 0) {
      throw new Error("the tenant does not exist; the seed never creates one");
    }
    const existing = new Map<string, { display_name: string; status: string }>((await client.query(
      `SELECT id, display_name, status FROM eos_workforce.job_roles WHERE tenant_id = $1 FOR UPDATE`, [input.tenantId],
    )).rows.map((r) => [r.id, r]));
    const ruled = new Set<string>(LAUNCH_JOB_ROLES.map((r) => r.jobRoleId));
    const additions = LAUNCH_JOB_ROLES.filter((r) => !existing.has(r.jobRoleId));
    const report: JobRoleCatalogSeedReport = {
      tenantId: input.tenantId,
      additions: additions.map((r) => r.jobRoleId),
      alreadyPresent: LAUNCH_JOB_ROLES.filter((r) => existing.has(r.jobRoleId)).map((r) => r.jobRoleId),
      differsFromRuling: LAUNCH_JOB_ROLES.filter((r) => existing.has(r.jobRoleId)
        && (existing.get(r.jobRoleId)!.display_name !== r.displayName || existing.get(r.jobRoleId)!.status !== "ACTIVE"))
        .map((r) => ({ jobRoleId: r.jobRoleId, displayName: existing.get(r.jobRoleId)!.display_name, status: existing.get(r.jobRoleId)!.status })),
      notInRuling: [...existing.keys()].filter((id) => !ruled.has(id)).sort(),
      applied: input.apply === true && additions.length > 0,
    };
    if (report.applied) {
      for (const r of additions) {
        await client.query(
          `INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, updated_by) VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`,
          [input.tenantId, r.jobRoleId, r.displayName, input.actor],
        );
      }
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         VALUES ($1, $2, 'jobRole.catalog.seed', $3, 'tenant', $2, NULL, $4, 'EMP-RT-08 Owner ruling launch catalog')`,
        [`audit_${randomUUID()}`, input.tenantId, input.actor, JSON.stringify({ added: report.additions })],
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
