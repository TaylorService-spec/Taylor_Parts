// THE STOCK LOCATION LOCK -- one transaction-scoped advisory lock per (tenant, part, location), shared by EVERY writer that
// decides a movement from the balance it read at that location: stock relocation, transfer dispatch, cycle-count
// reconciliation (Package H, 2026-10-01) and Work Order consumption from a truck (OD-T4). Two writers that each see enough
// stock can no longer both commit against it. The key string is unchanged from the original relocation lock, so a writer
// built before this module and one built after it still exclude each other.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export const stockLocationLockKey = (tenantId: string, partId: string, locationType: string, locationId: string): string =>
  `eos-relocation:${tenantId}:${partId}:${locationType}:${locationId}`;

/** Held until the caller's transaction ends. Call it BEFORE reading the balance the movement is decided from. */
export async function lockStockLocation(db: Queryable, tenantId: string, partId: string, locationType: string, locationId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [stockLocationLockKey(tenantId, partId, locationType, locationId)]);
}
