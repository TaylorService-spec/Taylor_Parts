// THE PROTECTED ADMINISTRATOR'S ADMINISTRATION REACH (Owner rulings 2026-10-09: DECISIONS #223 D3, #224 PR-2; G2).
//
// A protected Administrator ADMINISTERS company-scoped operational configuration without an Employee Operational Scope:
// every Reorder queue of a company this tenant is authorized to operate as, and every ACTIVE warehouse of such a company.
// It is REACH, never execution. Standing (protectedAdministrator.ts, PR-1) is the only way in, and reach is decided here,
// once, for the two places that consume it:
//
//   READ REACH        queueReachKeys (Reorder queue reads, search, analysis, assigned work) and scopedWarehouseIds
//                     (on-hand, receipts, movements, warehouse analysis) add the authorized companies / warehouses.
//   PREDICATE REACH   contextualAuthorization's OPERATIONAL_SCOPE predicate admits the Administrator ONLY where the call
//                     site OPTS IN (AuthorizeInput.administrationReach) AND the capability is on the allow-list below.
//
// NEVER REACH (fail closed): every O1 WORKER capability, inventory.stock.receive (so the receipt CORRECTED / re-receive
// path, which goes through the receive pipeline, stays the worker's own WAREHOUSE authority -- G2), technician MOBILE
// scope, and assignment-gated purchasing (those steps are decided by the assignee, never by reach). WORK_ELIGIBILITY and
// RECORD_ASSIGNMENT predicates are untouched, so an action that also needs them still refuses the Administrator.
//
// "Authorized company" = an operating-company key bound ACTIVE, for this tenant, to an ACTIVE operating company (the rule
// the Reorder creation boundary already applies). Another tenant's companies and warehouses are never in reach, and an
// unkeyed company has no queue to reach.
import type { PoolClient } from "pg";
import { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES } from "../adminPolicy/employmentAccessEligibility";
import {
  ADMIN_ROLE_KEY, afterWithActorAuthority, hasProtectedAdministratorStanding, PROTECTED_ADMINISTRATOR_AUTHORITY, PROTECTED_OWNER_ROLE_KEY,
} from "../adminPolicy/protectedAdministrator";

type Db = Pick<PoolClient, "query">;

/** Scope types the Administrator reaches by standing. MOBILE (a technician's truck) is deliberately absent. */
export const ADMINISTRATION_REACH_SCOPE_TYPES: ReadonlySet<string> = new Set(["REORDER_QUEUE", "WAREHOUSE"]);

/**
 * The capabilities whose OPERATIONAL_SCOPE predicate the Administrator's reach may satisfy (where the call site opts in):
 * administering and inspecting, never executing.
 *   warehouse.record.read        inspect a warehouse (experience surface)
 *   reorder.request.read         inspect a company's Reorder queue (experience surface)
 *   inventory.receipt.correct    the audited receipt VOID / reversal (G2) -- the receipt-correction call site opts in for
 *                                VOID only; CORRECTED re-receives through inventory.stock.receive, which never has reach
 */
export const ADMINISTRATION_REACH_CAPABILITIES: ReadonlySet<string> = new Set([
  "warehouse.record.read",
  "reorder.request.read",
  "inventory.receipt.correct",
]);

/**
 * Operational execution reach NEVER satisfies (O1 WORKER, Owner ruling 2026-10-09, plus inventory.stock.receive per G2).
 * Disjoint from the allow-list by construction (asserted below), and pinned by test.
 */
export const ADMINISTRATOR_EXECUTION_CAPABILITIES: ReadonlySet<string> = new Set([
  "reorder.request.startPurchasing",
  "reorder.request.postPurchasingUpdate",
  "reorder.request.markReceived",
  "reorder.request.recordPurchaseOrder",
  "workOrder.execution.record",
  "workOrder.lifecycle.complete",
  "inventory.workOrderConsumption.record",
  "inventory.serializedAsset.acquire",
  "rental.unit.assign",
  "rental.unit.return",
  "inventory.stock.receive",
]);

for (const key of ADMINISTRATION_REACH_CAPABILITIES) {
  if (ADMINISTRATOR_EXECUTION_CAPABILITIES.has(key)) throw new Error(`administrationReach: ${key} is both reach and execution`);
}

/** May reach satisfy this capability's OPERATIONAL_SCOPE predicate at all? */
export function isAdministrationReachCapability(capabilityKey: string): boolean {
  return ADMINISTRATION_REACH_CAPABILITIES.has(capabilityKey) && !ADMINISTRATOR_EXECUTION_CAPABILITIES.has(capabilityKey);
}

/**
 * PROTECTED ADMINISTRATOR STANDING for a principal, from the store -- PR-1's ONE rule (hasProtectedAdministratorStanding)
 * over the same qualifying assignments principal resolution reads: an ENABLED principal with an ACTIVE membership, its
 * ACTIVE, GLOBAL, non-stale assignments, and no linked Employee that is not access-eligible. Fails closed on any gap.
 */
export async function principalHasProtectedAdministratorStanding(db: Db, tenantId: string, principalId: string): Promise<boolean> {
  const rows = await qualifyingGlobalRoles(db, tenantId, principalId, [ADMIN_ROLE_KEY, PROTECTED_OWNER_ROLE_KEY]);
  return hasProtectedAdministratorStanding(rows, rows.map((r) => r.key));
}

/**
 * The principal's QUALIFYING GLOBAL Roles among `roleKeys`: an ENABLED principal with an ACTIVE membership, its ACTIVE,
 * GLOBAL, non-stale assignments, and no unusable Employee link -- the rule principal resolution applies. Standing and a
 * reserved capability's holder check (Owner G7) both read it, so the two can never disagree about who holds a Role.
 */
export async function qualifyingGlobalRoles(db: Db, tenantId: string, principalId: string, roleKeys: readonly string[]): Promise<readonly { key: string; protected: boolean | null }[]> {
  const { rows } = await db.query<{ key: string; protected: boolean | null }>(
    `SELECT r.key, r.protected
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
       JOIN eos_policy.principals p ON p.id = a.principal_id AND p.status = 'active'
       JOIN eos_policy.tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id AND m.status = 'active'
       LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND a.scope_type = 'global'
        AND a.access_version_at_grant <= coalesce(v.access_version, 0)
        AND r.key = ANY($3::text[])
        -- No unusable Employee link (PR-1's employeeAccessIneligibility): a link to a missing or ineligible Employee, or
        -- more than one active link, means no standing (fail closed).
        AND NOT EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                          LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
                         WHERE l.tenant_id = a.tenant_id AND l.principal_id = a.principal_id AND l.status = 'active'
                           AND (e.id IS NULL OR NOT (e.employment_status::text = ANY($4::text[]))))
        AND (SELECT count(*) FROM eos_policy.employee_principal_links l2
              WHERE l2.tenant_id = a.tenant_id AND l2.principal_id = a.principal_id AND l2.status = 'active') <= 1`,
    [tenantId, principalId, [...roleKeys], [...ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES]]);
  return rows;
}

/** The company keys this tenant is authorized to operate as: bound ACTIVE to an ACTIVE operating company. */
export async function authorizedCompanyKeys(db: Db, tenantId: string): Promise<readonly string[]> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT DISTINCT b.operating_company_key AS key
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'
      ORDER BY 1`, [tenantId]);
  return rows.map((r) => r.key);
}

/** The ACTIVE warehouses of an authorized company, in this tenant. */
export async function authorizedWarehouseIds(db: Db, tenantId: string): Promise<readonly string[]> {
  const keys = await authorizedCompanyKeys(db, tenantId);
  if (keys.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1 AND status::text = 'ACTIVE' AND operating_company_key = ANY($2::text[]) ORDER BY id`,
    [tenantId, keys]);
  return rows.map((r) => r.id);
}

/** The targets of one reachable scope type for a principal WITH standing; empty without standing. */
export async function administrationReachTargets(db: Db, tenantId: string, principalId: string, scopeType: string): Promise<readonly string[]> {
  if (!ADMINISTRATION_REACH_SCOPE_TYPES.has(scopeType)) return [];
  if (!(await principalHasProtectedAdministratorStanding(db, tenantId, principalId))) return [];
  return scopeType === "REORDER_QUEUE" ? authorizedCompanyKeys(db, tenantId) : authorizedWarehouseIds(db, tenantId);
}

/**
 * Every reach target of a principal, read ONCE: one standing check, one company-key read, one warehouse read. Empty
 * (both types) without standing. Used for the experience snapshot and the effective-access explanation.
 */
export async function administrationReachAll(db: Db, tenantId: string, principalId: string): Promise<Readonly<Record<string, readonly string[]>>> {
  if (!(await principalHasProtectedAdministratorStanding(db, tenantId, principalId))) return Object.freeze({ REORDER_QUEUE: [], WAREHOUSE: [] });
  const keys = await authorizedCompanyKeys(db, tenantId);
  const warehouses = keys.length === 0 ? [] : (await db.query<{ id: string }>(
    `SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1 AND status::text = 'ACTIVE' AND operating_company_key = ANY($2::text[]) ORDER BY id`,
    [tenantId, keys])).rows.map((r) => r.id);
  return Object.freeze({ REORDER_QUEUE: keys, WAREHOUSE: warehouses });
}

/** Does standing reach this target (or, with no target, any target of the type)? */
export async function administrationReaches(db: Db, tenantId: string, principalId: string, scopeType: string, scopeId?: string): Promise<boolean> {
  const targets = await administrationReachTargets(db, tenantId, principalId, scopeType);
  return scopeId === undefined || scopeId === null ? targets.length > 0 : targets.includes(scopeId);
}

/**
 * ADMINISTRATOR AUDIT PROVENANCE for a direct audit writer (DECISIONS #225 / PR-3): the event's `after` record, with
 * `authorizedBy` = the protected-Administrator marker when the ACTING principal has standing (the same rule as reach).
 * A non-record `after` is returned unchanged, and an existing `authorizedBy` is never overwritten. Read in the writer's
 * own transaction; one indexed read, only when there is a record to stamp.
 */
export async function withActorAuthority(db: Db, tenantId: string, principalId: string, after: unknown): Promise<unknown> {
  if (after === null || typeof after !== "object" || Array.isArray(after)) return after;
  const standing = await principalHasProtectedAdministratorStanding(db, tenantId, principalId);
  return afterWithActorAuthority(after, standing ? PROTECTED_ADMINISTRATOR_AUTHORITY : undefined);
}
