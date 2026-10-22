// THE ONE Reorder queue reach (DECISIONS #224): which operating companies' REORDER_QUEUE a caller reaches.
//
// Two sources, unioned, and nothing else:
//   - the caller's linked Employee's REORDER_QUEUE Operational Scopes (company-keyed; migration 1761696000000:
//     "a queue is always some company's queue", so reach is a set of keys, never a yes/no);
//   - PROTECTED ADMINISTRATOR standing: every company this tenant is authorized to operate as (administrationReach.ts).
// A caller with neither reaches no queue. Replaces the five copies that each re-derived the Employee's scopes
// (Reorder lifecycle, assignment, My Work search, analysis, assigned-work reads). Reach admits reads and the management
// decisions that carry their OWN capability (review, cancel, void, assign); the purchasing steps are assignee-gated and
// never consult reach.
import type { PoolClient } from "pg";
import { postgresPrincipalDimensionReader } from "./contextualAuthorization.js";
import { administrationReachTargets } from "./administrationReach.js";
import { resolveCompanyAuthority } from "./companyAuthority.js";

export const REORDER_QUEUE_SCOPE_TYPE = "REORDER_QUEUE";

export async function queueReachKeys(
  db: Pick<PoolClient, "query">,
  actor: { readonly tenantId: string; readonly principalId: string },
): Promise<readonly string[]> {
  const reader = postgresPrincipalDimensionReader(db);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  const own = employeeId === null ? [] : (await reader.listOperationalScopes(actor.tenantId, employeeId))
    .filter((x) => x.scopeType === REORDER_QUEUE_SCOPE_TYPE).map((x) => x.scopeId);
  const administered = await administrationReachTargets(db, actor.tenantId, actor.principalId, REORDER_QUEUE_SCOPE_TYPE);
  return [...new Set([...own, ...administered])].sort();
}

/**
 * THE READ REACH (Owner ruling PARTS-404 / RO-02, 2026-10-21): what a holder of reorder.request.read may READ.
 *
 * Two bases, ADDITIVE, and nothing else:
 *   - the company-keyed REORDER_QUEUE reach above, unchanged (`companyKeys`);
 *   - the warehouses of the caller's linked Employee's WAREHOUSE Operational Scopes that lie inside the caller's own
 *     operating-company authority (`warehouseIds`, with `warehouseCompanyKeys` the authority they were restricted to).
 *     A Reorder Request carries warehouse_id (the same eos_ops.warehouses identifier a WAREHOUSE scope stores -- the create
 *     command refuses a warehouse that is not a governed one and checks that very scope), so a request in a scoped warehouse
 *     is reachable and a sibling warehouse of the same company is not.
 *
 * READS ONLY. The management commands (review, cancel, void, assign) keep calling queueReachKeys, which this does not touch.
 * No Employee, no WAREHOUSE scope, or no company authority: no warehouse reach (fail closed). Protected Administrator
 * standing already reaches every authorized company through `companyKeys`, so it adds no warehouse of its own.
 */
export interface ReorderReadReach {
  readonly companyKeys: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly warehouseCompanyKeys: readonly string[];
}

export const REORDER_READ_CAPABILITY = "reorder.request.read";

/**
 * THE WAREHOUSE BASIS IS EARNED BY reorder.request.read AND BY NOTHING ELSE, decided HERE so no consumer can reach it through another
 * capability (a holder of reorder.purchaseOrder.read -- the Warehouse Associate -- passes the analysis measure's any-of capability
 * check, and must not thereby read the requests of its warehouses). `capabilities` is REQUIRED for the basis: an actor that does not
 * state it, or does not hold the read, has no warehouse reach (fail closed).
 */
export async function warehouseReadReach(
  db: Pick<PoolClient, "query">,
  actor: { readonly tenantId: string; readonly principalId: string; readonly capabilities?: ReadonlySet<string> },
): Promise<{ readonly warehouseIds: readonly string[]; readonly warehouseCompanyKeys: readonly string[] }> {
  const none = Object.freeze({ warehouseIds: [] as string[], warehouseCompanyKeys: [] as string[] });
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(REORDER_READ_CAPABILITY)) return none;
  const reader = postgresPrincipalDimensionReader(db);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  const scoped = employeeId === null ? [] : (await reader.listOperationalScopes(actor.tenantId, employeeId))
    .filter((x) => x.scopeType === "WAREHOUSE").map((x) => x.scopeId);
  if (scoped.length === 0) return none;
  const authority = (await resolveCompanyAuthority(db, actor.tenantId, actor.principalId)).companyKeys;
  if (authority.length === 0) return none;
  const { rows } = await db.query(
    `SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_key = ANY($3::text[])`,
    [actor.tenantId, [...new Set(scoped)], [...authority]]);
  return Object.freeze({ warehouseIds: rows.map((r) => String(r.id)).sort(), warehouseCompanyKeys: [...authority] });
}

export async function queueReadReach(
  db: Pick<PoolClient, "query">,
  actor: { readonly tenantId: string; readonly principalId: string; readonly capabilities?: ReadonlySet<string> },
): Promise<ReorderReadReach> {
  const companyKeys = await queueReachKeys(db, actor);
  const w = await warehouseReadReach(db, actor);
  return Object.freeze({ companyKeys, warehouseIds: w.warehouseIds, warehouseCompanyKeys: w.warehouseIds.length === 0 ? [] : w.warehouseCompanyKeys });
}

/** Whether a request (its company and warehouse) is inside a read reach. The one rule the in-memory sites share. */
export function reorderInReadReach(reach: ReorderReadReach, operatingCompanyKey: string, warehouseId: string | null): boolean {
  return reach.companyKeys.includes(operatingCompanyKey)
    || (warehouseId !== null && reach.warehouseIds.includes(warehouseId) && reach.warehouseCompanyKeys.includes(operatingCompanyKey));
}

/**
 * The same rule as a SQL predicate over `alias` (a reorder_requests row): bind `reach.companyKeys`, `reach.warehouseIds`
 * and `reach.warehouseCompanyKeys` as text[] at the three given parameter positions.
 */
export function reorderReadReachSql(alias: string, p: { company: number; warehouse: number; warehouseCompany: number }): string {
  return `(${alias}.operating_company_key = ANY($${p.company}::text[])
     OR (${alias}.warehouse_id = ANY($${p.warehouse}::text[]) AND ${alias}.operating_company_key = ANY($${p.warehouseCompany}::text[])))`;
}
