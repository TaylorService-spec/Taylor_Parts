// THE ONE SYNTHETIC TAYLOR ACCEPTANCE WAREHOUSE (Controller ruling "CATALOG/REORDER WINDOW BLOCKER RULINGS",
// 2026-09-30, Option 2(a)).
//
// Acceptance infrastructure, NOT Taylor master data. The governed Reorder create derives the operating company FROM
// the warehouse (reorderLifecycleCommands.ts createGovernedReorderRequest), and nonprod's only warehouses are the
// Sample Company fixtures under the unbound key `sample-co-synthetic`. One pinned, unmistakably synthetic warehouse
// under the bound key `taylor` lets the synthetic Reorder -> PO -> receipt -> void proof run without populating
// wh-main / wh-north, without mapping to Sample Company, and without binding Sample Company to Taylor.
//
// It is written by the EXISTING governed writer (warehouseBinRepository.createWarehouse) -- no second warehouse
// architecture, no bin (receiving lands on a WAREHOUSE location directly) -- inside ONE transaction that first proves:
//   * the pinned id is unused in eos_ops.warehouses (any tenant);
//   * no row in any eos_* table references it through a warehouse / location id column;
//   * `taylor` resolves to exactly ONE ACTIVE tenant_operating_company_keys binding for the tenant, whose operating
//     company is ACTIVE;
// then appends ONE audit event naming it synthetic acceptance data. A rerun finds it ALREADY_PRESENT and writes
// nothing; a warehouse at the pinned id that differs from the pinned facts is a REFUSAL, never repaired.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { createWarehouse, readWarehouse } from "./warehouseBinRepository";

export const SYNTHETIC_ACCEPTANCE_WAREHOUSE = Object.freeze({
  warehouseId: "synthetic-np-wh-taylor-acceptance",
  operatingCompanyKey: "taylor",
  name: "SYNTHETIC Taylor Acceptance Proof Warehouse (fixture)",
  siteLabel: "SYNTHETIC nonprod acceptance proof -- not a real site",
  status: "ACTIVE" as const,
  provenance: "NATIVE" as const,
});
export const SYNTHETIC_ACCEPTANCE_PROVENANCE = "NONPROD_SYNTHETIC_ACCEPTANCE";
/** The ids the ruling forbids this warehouse from being or claiming. */
export const FORBIDDEN_WAREHOUSE_IDS: readonly string[] = Object.freeze(["wh-main", "wh-north", "SC-WH-MAIN", "SC-WH-SERVICE"]);

export class SyntheticAcceptanceWarehouseError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SyntheticAcceptanceWarehouseError"; }
}

export interface SyntheticWarehousePreflight {
  readonly warehouseId: string;
  readonly existing: "ABSENT" | "PRESENT_EXACT";
  readonly referencingRows: number;
  readonly referenceColumnsChecked: number;
  readonly companyKeyBindings: number;
  readonly operatingCompanyId: string | null;
}

export interface SyntheticWarehouseResult {
  readonly outcome: "DRY_RUN" | "CREATED" | "ALREADY_PRESENT";
  readonly preflight: SyntheticWarehousePreflight;
  readonly auditEventId: string | null;
}

async function preflight(db: PoolClient, tenantId: string): Promise<SyntheticWarehousePreflight> {
  const w = SYNTHETIC_ACCEPTANCE_WAREHOUSE;
  if (FORBIDDEN_WAREHOUSE_IDS.includes(w.warehouseId)) throw new SyntheticAcceptanceWarehouseError("FORBIDDEN_IDENTITY", "the pinned id is a forbidden warehouse identity");
  const anyTenant = (await db.query(`SELECT tenant_id FROM eos_ops.warehouses WHERE id = $1`, [w.warehouseId])).rows;
  let existing: SyntheticWarehousePreflight["existing"] = "ABSENT";
  if (anyTenant.length > 0) {
    const mine = await readWarehouse(db, tenantId, w.warehouseId);
    const exact = anyTenant.length === 1 && mine !== null && mine.operatingCompanyKey === w.operatingCompanyKey && mine.name === w.name &&
      mine.siteLabel === w.siteLabel && mine.status === w.status && mine.provenance === w.provenance;
    if (!exact) throw new SyntheticAcceptanceWarehouseError("IDENTITY_OCCUPIED", "the pinned warehouse id is occupied by a record that is not the pinned synthetic warehouse");
    existing = "PRESENT_EXACT";
  }
  const columns = (await db.query(
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE table_schema LIKE 'eos\\_%' AND data_type IN ('text', 'character varying')
        AND (column_name LIKE '%warehouse_id' OR column_name IN ('location_id', 'scope_id', 'scope_value'))
        AND NOT (table_schema = 'eos_ops' AND table_name = 'warehouses')
      ORDER BY 1, 2, 3`)).rows as { table_schema: string; table_name: string; column_name: string }[];
  let referencingRows = 0;
  for (const c of columns) {
    const r = await db.query(`SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}" WHERE "${c.column_name}" = $1`, [w.warehouseId]);
    referencingRows += r.rows[0].n as number;
  }
  if (existing === "ABSENT" && referencingRows > 0) {
    throw new SyntheticAcceptanceWarehouseError("IDENTITY_REFERENCED", "rows already reference the pinned warehouse id before it exists");
  }
  const bindings = (await db.query(
    `SELECT b.operating_company_id FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_key = $2 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
    [tenantId, w.operatingCompanyKey])).rows as { operating_company_id: string }[];
  if (bindings.length !== 1) {
    throw new SyntheticAcceptanceWarehouseError("COMPANY_KEY_NOT_UNIQUE", `operating company key '${w.operatingCompanyKey}' resolves to ${bindings.length} ACTIVE bindings, not exactly one`);
  }
  return Object.freeze({ warehouseId: w.warehouseId, existing, referencingRows, referenceColumnsChecked: columns.length,
    companyKeyBindings: bindings.length, operatingCompanyId: bindings[0].operating_company_id });
}

/** Dry run by default; `apply` creates the pinned warehouse once, audited, in one transaction. */
export async function establishSyntheticAcceptanceWarehouse(
  pool: Pool,
  input: { tenantId: string; actorPrincipalId: string; apply: boolean; now?: Date },
): Promise<SyntheticWarehouseResult> {
  const client = await pool.connect();
  try {
    await client.query(input.apply ? "BEGIN" : "BEGIN READ ONLY");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`synthetic-acceptance-warehouse|${input.tenantId}`]);
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [input.tenantId, input.actorPrincipalId]);
    if (member.rows.length === 0) throw new SyntheticAcceptanceWarehouseError("ACTOR_NOT_TENANT_MEMBER", "the actor is not an active member of the tenant");
    const pre = await preflight(client, input.tenantId);
    if (!input.apply || pre.existing === "PRESENT_EXACT") {
      await client.query(input.apply ? "COMMIT" : "ROLLBACK");
      return Object.freeze({ outcome: pre.existing === "PRESENT_EXACT" ? "ALREADY_PRESENT" : "DRY_RUN", preflight: pre, auditEventId: null });
    }
    // The governed writer, on this transaction's client (it issues a single INSERT through `query`).
    await createWarehouse(client as unknown as Pool, input.tenantId, input.actorPrincipalId, { ...SYNTHETIC_ACCEPTANCE_WAREHOUSE });
    const auditEventId = `audit_${randomUUID()}`;
    await client.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
       VALUES ($1, $2, 'warehouse.syntheticAcceptance.create', $3, 'warehouse', $4, NULL, $5, $6)`,
      [auditEventId, input.tenantId, input.actorPrincipalId, SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId,
        JSON.stringify({ ...SYNTHETIC_ACCEPTANCE_WAREHOUSE, dataProvenance: SYNTHETIC_ACCEPTANCE_PROVENANCE,
          ruling: "Controller 2026-09-30 Option 2(a): nonprod synthetic acceptance infrastructure, not Taylor master data" }),
        input.now ?? new Date()]);
    await client.query("COMMIT");
    return Object.freeze({ outcome: "CREATED", preflight: pre, auditEventId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
