// TENANT OPERATING COMPANY -> eos_ops KEY reconciliation.
//
// The sibling of tenantOperatingCompanies.ts, and deliberately the same posture: driven only by a
// governed CLI that fences the environment before this module or `pg` loads; DRY RUN by default; it
// never deletes, never overwrites, never rebinds and never reactivates.
//
// ════════════════════ THE KEY COMES FROM EVIDENCE ════════════════════
//
// `bindings` is read from the environment's governed evidence file, never from a command line. A key an
// operator could type is a key an operator could mistype, and an eos_ops partition key is not a value
// anybody should be able to invent at 5pm: every operational row that inherits it becomes unreachable
// from the company that supposedly owns it, silently, because the column is opaque TEXT.
//
// ════════════════════ WHAT IT REFUSES, AND WHY EACH ONE MATTERS ════════════════════
//
//   company not authorized   a binding cannot INTRODUCE a company. The tenant must already be authorized
//                            to operate as it (eos_policy.tenant_operating_companies, ACTIVE).
//   conflicting key          an existing ACTIVE row binding the same company to a DIFFERENT key is
//                            REPORTED, never rewritten. Re-keying a company silently orphans every
//                            eos_ops row already written under the old key.
//   key taken by another     one company per key, per tenant -- otherwise an operational row's owner is
//                            unanswerable.
//   inactive row             an INACTIVE binding is not reactivated by a reconciliation run. Someone
//                            deactivated it on purpose.
import type { Pool } from "pg";

export interface OperatingCompanyKeyBinding {
  readonly operatingCompanyId: string;
  readonly operatingCompanyKey: string;
  readonly provenance: "NATIVE" | "MIGRATED";
  readonly reason: string;
}

export interface TenantOperatingCompanyKeyReport {
  readonly tenantId: string;
  readonly evidenceBindings: readonly string[];
  readonly additions: readonly string[];
  readonly alreadyBound: readonly string[];
  readonly companyNotAuthorized: readonly string[];
  readonly conflictingKey: readonly string[];
  readonly keyTakenByAnotherCompany: readonly string[];
  readonly inactiveNotReactivated: readonly string[];
  readonly applied: boolean;
}

const SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;

export async function reconcileTenantOperatingCompanyKeys(
  pool: Pool,
  input: {
    readonly tenantId: string;
    readonly bindings: readonly OperatingCompanyKeyBinding[];
    readonly source: string;
    readonly actor: string;
    readonly apply?: boolean;
  },
): Promise<TenantOperatingCompanyKeyReport> {
  const bindings = [...input.bindings].sort((a, b) => a.operatingCompanyId.localeCompare(b.operatingCompanyId));
  if (bindings.length === 0) throw new Error("the evidence must name at least one binding");
  for (const b of bindings) {
    if (!SHAPE.test(b.operatingCompanyId) || !SHAPE.test(b.operatingCompanyKey)) {
      throw new Error(`binding ${b.operatingCompanyId} -> ${b.operatingCompanyKey} is not well-formed`);
    }
    if (b.provenance !== "NATIVE" && b.provenance !== "MIGRATED") {
      throw new Error(`binding ${b.operatingCompanyId} has an unknown provenance`);
    }
    if (typeof b.reason !== "string" || b.reason.trim() === "") {
      throw new Error(`binding ${b.operatingCompanyId} states no reason`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: authorized } = await client.query(
      `SELECT operating_company_id FROM eos_policy.tenant_operating_companies
        WHERE tenant_id = $1 AND status = 'ACTIVE'`, [input.tenantId]);
    const activeCompanies = new Set(authorized.map((r) => String(r.operating_company_id)));

    const { rows: existing } = await client.query(
      `SELECT operating_company_id, operating_company_key, status
         FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 FOR UPDATE`, [input.tenantId]);
    const byCompany = new Map(existing.map((r) => [String(r.operating_company_id), r as Record<string, unknown>]));
    const byKey = new Map(existing.map((r) => [String(r.operating_company_key), String(r.operating_company_id)]));

    const additions: string[] = [], alreadyBound: string[] = [], notAuthorized: string[] = [];
    const conflicting: string[] = [], keyTaken: string[] = [], inactive: string[] = [];

    for (const b of bindings) {
      if (!activeCompanies.has(b.operatingCompanyId)) { notAuthorized.push(b.operatingCompanyId); continue; }
      const row = byCompany.get(b.operatingCompanyId);
      if (row) {
        if (String(row.status) !== "ACTIVE") { inactive.push(b.operatingCompanyId); continue; }
        if (String(row.operating_company_key) !== b.operatingCompanyKey) {
          conflicting.push(`${b.operatingCompanyId}: bound to '${String(row.operating_company_key)}', evidence says '${b.operatingCompanyKey}'`);
          continue;
        }
        alreadyBound.push(b.operatingCompanyId);
        continue;
      }
      const owner = byKey.get(b.operatingCompanyKey);
      if (owner && owner !== b.operatingCompanyId) {
        keyTaken.push(`${b.operatingCompanyKey}: already bound to '${owner}'`);
        continue;
      }
      additions.push(b.operatingCompanyId);
      if (input.apply === true) {
        await client.query(
          `INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $6)`,
          [input.tenantId, b.operatingCompanyId, b.operatingCompanyKey, b.provenance, input.source, input.actor]);
      }
    }

    // A refusal must not leave a partial reconciliation behind.
    const refused = notAuthorized.length + conflicting.length + keyTaken.length;
    if (input.apply === true && refused === 0) await client.query("COMMIT");
    else await client.query("ROLLBACK");

    return Object.freeze({
      tenantId: input.tenantId,
      evidenceBindings: Object.freeze(bindings.map((b) => `${b.operatingCompanyId} -> ${b.operatingCompanyKey}`)),
      additions: Object.freeze(additions.sort()),
      alreadyBound: Object.freeze(alreadyBound.sort()),
      companyNotAuthorized: Object.freeze(notAuthorized.sort()),
      conflictingKey: Object.freeze(conflicting.sort()),
      keyTakenByAnotherCompany: Object.freeze(keyTaken.sort()),
      inactiveNotReactivated: Object.freeze(inactive.sort()),
      applied: input.apply === true && refused === 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}
