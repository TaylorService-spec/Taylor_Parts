// COPY ONCE -> VERIFY -> RECONCILE: the PostgreSQL half of the one-time Employee PROFILE migration (Owner ruling F).
// NO DUAL WRITE, NO SYNC: after the copy PostgreSQL is the profile authority, and a changed source is a finding for a
// person, never an update for a script.
//
// Driven only by functions/scripts/employeeProfileCutover.js, which fences the environment BEFORE this module or `pg`
// loads. Consumes the canonical form employeeProfileSnapshot.ts produced from an exported snapshot file; loads no
// Firebase module and has no Firestore path.
//
// ════════════════════ COPY ════════════════════
//
// ONE transaction for the tenant, under a transaction-scoped advisory lock:
//   PROFILES (eos_workforce.employees profile columns)
//     * snapshot Employee absent from PostgreSQL            -> reconciliation EMPLOYEE_NOT_IN_POSTGRES (never created:
//                                                              no governed Employee writer exists, and a profile copy
//                                                              is not one)
//     * every profile column NULL in PostgreSQL              -> UPDATE the profile columns (copy once)
//     * profile identical                                    -> nothing
//     * profile present and DIFFERENT                        -> REFUSE DRIFT_DETECTED, roll back everything
//     * snapshot employee number held by ANOTHER PostgreSQL
//       Employee of the tenant (case-insensitive)            -> REFUSE EMPLOYEE_NUMBER_CONFLICT
//     * snapshot employmentStatus / operatingCompanyId
//       disagreeing with the Employee authority              -> reconciliation (never overwritten)
//   REPORTING RELATIONSHIPS (legacy managerEmployeeId)
//     * both Employees in PostgreSQL, no current relationship -> INSERT, source LEGACY_PROFILE_MIGRATION, effective_from
//                                                              = the snapshot's export time ("current as of export";
//                                                              no start date is fabricated)
//     * same current manager                                  -> nothing
//     * a different current manager                           -> REFUSE DRIFT_DETECTED
//     * either Employee absent from PostgreSQL                -> reconciliation MANAGER_RELATIONSHIP_NOT_RESOLVABLE
// A run that writes anything appends ONE eos_policy.audit_events row naming the canonical digest and counts.
//
// ACTOR COLUMNS carry `employee-profile-cutover:<performedBy>`. A Firebase uid from the legacy record is provenance
// evidence only (counted in the census) and is never written to any column.
//
// ════════════════════ VERIFY ════════════════════
//
// READ ONLY transaction: every snapshot profile present in PostgreSQL compared field by field; every resolvable manager
// candidate compared with the current relationship; reconciled = no mismatch.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { PROFILE_COLUMNS, type CanonicalEmployeeProfiles, type CanonicalProfile } from "./employeeProfileSnapshot";

type Db = Pick<PoolClient, "query">;

export class EmployeeProfileCutoverError extends Error {
  constructor(readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "EmployeeProfileCutoverError";
  }
}

export interface ReconciliationItem {
  readonly id: string;
  readonly code: string;
  readonly detail?: string;
}

const PROFILE_SELECT = `SELECT id, employment_status::text AS employment_status, operating_company_id,
  ${PROFILE_COLUMNS.filter((c) => c !== "hire_date" && c !== "separation_date").join(", ")},
  to_char(hire_date, 'YYYY-MM-DD') AS hire_date, to_char(separation_date, 'YYYY-MM-DD') AS separation_date
  FROM eos_workforce.employees WHERE tenant_id = $1`;

async function targetState(db: Db, tenantId: string) {
  const employees = new Map<string, Record<string, any>>((await db.query(`${PROFILE_SELECT} ORDER BY id`, [tenantId])).rows.map((r) => [r.id, r]));
  const current = new Map<string, string>((await db.query(
    `SELECT employee_id, manager_employee_id FROM eos_workforce.employee_reporting_relationships WHERE tenant_id = $1 AND effective_to IS NULL`,
    [tenantId],
  )).rows.map((r) => [r.employee_id, r.manager_employee_id]));
  return { employees, current };
}

const differing = (p: CanonicalProfile, row: Record<string, any>) => PROFILE_COLUMNS.filter((c) => (row[c] ?? null) !== (p[c] ?? null));
const allNull = (row: Record<string, any>) => PROFILE_COLUMNS.every((c) => row[c] === null || row[c] === undefined);

export interface ProfileCopyReport {
  readonly outcome: "COPIED" | "NO_CHANGES";
  readonly tenantId: string;
  readonly canonicalDigest: string;
  readonly profiles: { readonly updated: number; readonly unchanged: number };
  readonly reportingRelationships: { readonly inserted: number; readonly unchanged: number };
  readonly reconciliation: readonly ReconciliationItem[];
}

function plan(canonical: CanonicalEmployeeProfiles, state: Awaited<ReturnType<typeof targetState>>) {
  const reconciliation: ReconciliationItem[] = [];
  const drift: { kind: string; id: string; fields: string[] }[] = [];
  const updates: CanonicalProfile[] = [];
  let unchangedProfiles = 0;
  const authorityById = new Map(canonical.authority.map((a) => [a.id, a]));
  for (const p of canonical.profiles) {
    const row = state.employees.get(p.id);
    if (!row) { reconciliation.push({ id: p.id, code: "EMPLOYEE_NOT_IN_POSTGRES" }); continue; }
    const legacy = authorityById.get(p.id);
    if (legacy?.employmentStatus && legacy.employmentStatus !== row.employment_status) reconciliation.push({ id: p.id, code: "EMPLOYMENT_STATUS_DIFFERS", detail: `${legacy.employmentStatus} != ${row.employment_status}` });
    if (legacy?.operatingCompanyId && legacy.operatingCompanyId !== row.operating_company_id) reconciliation.push({ id: p.id, code: "OPERATING_COMPANY_DIFFERS", detail: `${legacy.operatingCompanyId} != ${row.operating_company_id}` });
    const diff = differing(p, row);
    if (diff.length === 0) unchangedProfiles += 1;
    else if (allNull(row)) updates.push(p);
    else drift.push({ kind: "profile", id: p.id, fields: diff });
  }
  const inserts: { employeeId: string; managerEmployeeId: string }[] = [];
  let unchangedRelationships = 0;
  for (const m of canonical.managers) {
    if (!state.employees.has(m.employeeId) || !state.employees.has(m.managerEmployeeId)) {
      reconciliation.push({ id: m.employeeId, code: "MANAGER_RELATIONSHIP_NOT_RESOLVABLE", detail: m.managerEmployeeId });
      continue;
    }
    const current = state.current.get(m.employeeId);
    if (current === undefined) inserts.push(m);
    else if (current === m.managerEmployeeId) unchangedRelationships += 1;
    else drift.push({ kind: "reporting_relationship", id: m.employeeId, fields: ["manager_employee_id"] });
  }
  return { reconciliation, drift, updates, inserts, unchangedProfiles, unchangedRelationships };
}

export async function copyEmployeeProfiles(
  client: PoolClient,
  input: { tenantId: string; performedBy: string; canonical: CanonicalEmployeeProfiles; canonicalDigest: string; now?: Date },
): Promise<ProfileCopyReport> {
  const { tenantId, canonical } = input;
  if (typeof input.performedBy !== "string" || !/^[A-Za-z0-9._@-]{1,100}$/.test(input.performedBy)) {
    throw new EmployeeProfileCutoverError("PERFORMED_BY_INVALID", "--performedBy must name the operator ([A-Za-z0-9._@-], at most 100)");
  }
  const actor = `employee-profile-cutover:${input.performedBy}`;
  const at = input.now ?? new Date();
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`employee-profile-cutover|${tenantId}`]);
    const tenant = await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [tenantId]);
    if (tenant.rows.length === 0) throw new EmployeeProfileCutoverError("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
    const state = await targetState(client, tenantId);
    const p = plan(canonical, state);
    if (p.drift.length > 0) throw new EmployeeProfileCutoverError("DRIFT_DETECTED", `${p.drift.length} source records differ from PostgreSQL; nothing was written`, p.drift);

    const snapshotIds = new Set(canonical.profiles.map((x) => x.id));
    const conflicts: { id: string; heldBy: string }[] = [];
    for (const u of p.updates) {
      if (!u.employee_number) continue;
      for (const [id, row] of state.employees) {
        if (id !== u.id && row.employee_number && String(row.employee_number).toUpperCase() === u.employee_number.toUpperCase() && !snapshotIds.has(id)) {
          conflicts.push({ id: u.id, heldBy: id });
        }
      }
    }
    if (conflicts.length > 0) throw new EmployeeProfileCutoverError("EMPLOYEE_NUMBER_CONFLICT", `${conflicts.length} employee numbers are held by other Employees; nothing was written`, conflicts);

    for (const u of p.updates) {
      await client.query(
        `UPDATE eos_workforce.employees SET ${PROFILE_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(", ")}, updated_at = $${PROFILE_COLUMNS.length + 3}
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, u.id, ...PROFILE_COLUMNS.map((c) => u[c]), at],
      );
    }
    for (const m of p.inserts) {
      await client.query(
        `INSERT INTO eos_workforce.employee_reporting_relationships
           (id, tenant_id, employee_id, manager_employee_id, effective_from, established_by, established_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'LEGACY_PROFILE_MIGRATION')`,
        [`err_${randomUUID()}`, tenantId, m.employeeId, m.managerEmployeeId, new Date(canonical.exportedAt), actor, at],
      );
    }
    const report: ProfileCopyReport = {
      outcome: p.updates.length + p.inserts.length > 0 ? "COPIED" : "NO_CHANGES",
      tenantId,
      canonicalDigest: input.canonicalDigest,
      profiles: { updated: p.updates.length, unchanged: p.unchangedProfiles },
      reportingRelationships: { inserted: p.inserts.length, unchanged: p.unchangedRelationships },
      reconciliation: p.reconciliation,
    };
    if (report.outcome === "COPIED") {
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, 'employee.profile.cutover.copy', $3, 'employee_profile_snapshot', $4, NULL, $5, $6)`,
        [`audit_${randomUUID()}`, tenantId, actor, input.canonicalDigest, JSON.stringify({ profiles: report.profiles, reportingRelationships: report.reportingRelationships }), at],
      );
    }
    await client.query("COMMIT");
    return report;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

export interface ProfileVerifyReport {
  readonly reconciled: boolean;
  readonly tenantId: string;
  readonly profiles: { readonly compared: number; readonly mismatched: readonly { id: string; fields: string[] }[] };
  readonly reportingRelationships: { readonly compared: number; readonly mismatched: readonly { id: string; expected: string; actual: string | null }[] };
  readonly reconciliation: readonly ReconciliationItem[];
}

export async function verifyEmployeeProfiles(client: PoolClient, input: { tenantId: string; canonical: CanonicalEmployeeProfiles }): Promise<ProfileVerifyReport> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await targetState(client, input.tenantId);
    const reconciliation: ReconciliationItem[] = [];
    const mismatchedProfiles: { id: string; fields: string[] }[] = [];
    let comparedProfiles = 0;
    for (const p of input.canonical.profiles) {
      const row = state.employees.get(p.id);
      if (!row) { reconciliation.push({ id: p.id, code: "EMPLOYEE_NOT_IN_POSTGRES" }); continue; }
      comparedProfiles += 1;
      const diff = differing(p, row);
      if (diff.length > 0) mismatchedProfiles.push({ id: p.id, fields: diff });
    }
    const mismatchedRelationships: { id: string; expected: string; actual: string | null }[] = [];
    let comparedRelationships = 0;
    for (const m of input.canonical.managers) {
      if (!state.employees.has(m.employeeId) || !state.employees.has(m.managerEmployeeId)) {
        reconciliation.push({ id: m.employeeId, code: "MANAGER_RELATIONSHIP_NOT_RESOLVABLE", detail: m.managerEmployeeId });
        continue;
      }
      comparedRelationships += 1;
      const actual = state.current.get(m.employeeId) ?? null;
      if (actual !== m.managerEmployeeId) mismatchedRelationships.push({ id: m.employeeId, expected: m.managerEmployeeId, actual });
    }
    await client.query("COMMIT");
    return {
      reconciled: mismatchedProfiles.length === 0 && mismatchedRelationships.length === 0,
      tenantId: input.tenantId,
      profiles: { compared: comparedProfiles, mismatched: mismatchedProfiles },
      reportingRelationships: { compared: comparedRelationships, mismatched: mismatchedRelationships },
      reconciliation,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
