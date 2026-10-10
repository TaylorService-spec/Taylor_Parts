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
