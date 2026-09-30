// THE PINNED WORK ORDER QUARANTINE, AT RUNTIME (Owner DECISION 3, 2026-09-30; migration 1764310000000).
//
// A quarantined Work Order is PRESERVED and INVISIBLE to operations: no Service Office / Dispatcher / Technician
// queue, no operational search, no workload analytics, no scheduling candidate or conflict, and no command. It stays
// readable only to the migration evidence tooling (scripts/workOrderProtectedRowsPlanCli.js,
// scripts/workOrderQuarantineCli.js), which reads the relation directly and is not an operational surface.
//
// ONE predicate and ONE check, so every surface excludes the same set. The relation itself admits only the pinned
// thirteen (a CHECK constraint), so this is never a generic "ignore bad rows" filter.
//
// FAIL CLOSED: a quarantine row excludes its Work Order whatever the row's current fingerprint is -- a quarantined
// Work Order that later changed is still quarantined; only a reviewed migration lifts a quarantine.
import type { PoolClient, Pool } from "pg";

export const WORK_ORDER_QUARANTINED = "WORK_ORDER_QUARANTINED";
export const WORK_ORDER_QUARANTINED_MESSAGE =
  "this Work Order is quarantined (a pinned OBSOLETE/BAD_COPY migrated record) and is preserved for migration evidence only";

/** SQL: the Work Order aliased `alias` is NOT quarantined. */
export function notQuarantined(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("notQuarantined: alias must be a plain SQL identifier");
  return `NOT EXISTS (SELECT 1 FROM eos_ops.work_order_quarantine wq WHERE wq.tenant_id = ${alias}.tenant_id AND wq.work_order_id = ${alias}.id)`;
}

/** Is this Work Order quarantined? The CALLER refuses with its own governed error class and WORK_ORDER_QUARANTINED. */
export async function isQuarantined(db: Pick<PoolClient, "query"> | Pick<Pool, "query">, tenantId: string, workOrderId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM eos_ops.work_order_quarantine WHERE tenant_id = $1 AND work_order_id = $2`, [tenantId, workOrderId]);
  return rows.length > 0;
}
