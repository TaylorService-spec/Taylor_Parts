// MOBILE (TRUCK) STOCK AUTHORITY -- Controller TRUCK INVENTORY ACTIVATION AUTHORIZED (2026-10-01), OD-T1 / OD-T3.
//
// An Employee's relationship to a truck IS a current Employee Operational Scope of type MOBILE over the truck's MOBILE
// inventory location (OD-T1). For Technician truck operations that scope is the RECORD relationship (OD-T3): it reaches
// that truck's stock and nothing else -- no warehouse, no other truck, no tenant-wide view.
//
// REVALIDATED ON EVERY OPERATION, server-side, never cached, never caller-asserted:
//   1. capability (the operation's own key)                         -> CAPABILITY_MISSING
//   2. WORK_ELIGIBILITY SERVICE_TECHNICIAN                          -> WORK_ELIGIBILITY_MISSING
//   3. OPERATIONAL_SCOPE MOBILE:<locationId>, current               -> OUTSIDE_OPERATIONAL_SCOPE
//   4. the location exists, is ACTIVE, is linked to an ACTIVE truck  -> MOBILE_LOCATION_NOT_FOUND / _INACTIVE / TRUCK_NOT_LINKED / TRUCK_INACTIVE
//   5. the Employee's operating company is the location's company   -> MOBILE_LOCATION_COMPANY_MISMATCH
// A scope ended, a truck idled out of service, a location deactivated or an Employee moved to another company each closes
// the path for the NEXT operation; nothing already recorded (ledger, custody, transactions, audit, Work Orders) changes.
import type { PoolClient } from "pg";
import { authorizeObjectAction, postgresContextualReader, type AuthorizationDecision, type ContextPredicate, type ContextualActor } from "./contextualAuthorization.js";

type Queryable = Pick<PoolClient, "query">;

export const MOBILE_WORK_ELIGIBILITY = "SERVICE_TECHNICIAN";

/** The Technician (truck) path for an act at one MOBILE location. */
export function mobilePredicates(locationId: string): readonly ContextPredicate[] {
  return Object.freeze([
    Object.freeze({ kind: "WORK_ELIGIBILITY" as const, qualificationCode: MOBILE_WORK_ELIGIBILITY }),
    Object.freeze({ kind: "OPERATIONAL_SCOPE" as const, scopeType: "MOBILE", scopeId: locationId }),
  ]);
}

export type MobileStockRefusalCode =
  | "MOBILE_LOCATION_NOT_FOUND" | "MOBILE_LOCATION_INACTIVE" | "TRUCK_NOT_LINKED" | "TRUCK_INACTIVE" | "MOBILE_LOCATION_COMPANY_MISMATCH";

export class MobileStockRefusal extends Error {
  constructor(readonly code: MobileStockRefusalCode, readonly category: "NOT_FOUND" | "PRECONDITION_FAILED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "MobileStockRefusal";
  }
}

export interface UsableMobileLocation {
  readonly locationId: string;
  readonly operatingCompanyKey: string;
  readonly truckId: string;
  readonly displayLabel: string;
}

/**
 * The location is a usable truck location RIGHT NOW: present, ACTIVE, linked 1:1 to a truck that is active and not out of
 * service. `lock` takes a share lock so a concurrent deactivation / relink waits for the operation that relied on it.
 */
export async function requireUsableMobileLocation(db: Queryable, tenantId: string, locationId: string, opts: { readonly lock?: boolean } = {}): Promise<UsableMobileLocation> {
  const { rows } = await db.query(
    `SELECT m.active, m.operating_company_key, m.display_label, t.truck_id, t.active AS truck_active, t.status::text AS truck_status
       FROM eos_ops.mobile_locations m
       LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
      WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND m.location_id = $2${opts.lock ? " FOR SHARE OF m" : ""}`,
    [tenantId, locationId]);
  const r = rows[0];
  if (!r) throw new MobileStockRefusal("MOBILE_LOCATION_NOT_FOUND", "NOT_FOUND", "no truck location with that id");
  if (r.active !== true) throw new MobileStockRefusal("MOBILE_LOCATION_INACTIVE", "PRECONDITION_FAILED", "the truck location is inactive");
  if (!r.truck_id) throw new MobileStockRefusal("TRUCK_NOT_LINKED", "PRECONDITION_FAILED", "the truck location is not linked to a truck");
  if (r.truck_active !== true || r.truck_status === "OUT_OF_SERVICE") {
    throw new MobileStockRefusal("TRUCK_INACTIVE", "PRECONDITION_FAILED", "the truck is out of service");
  }
  return Object.freeze({ locationId, operatingCompanyKey: String(r.operating_company_key), truckId: String(r.truck_id), displayLabel: String(r.display_label) });
}

async function employeeCompanyKey(db: Queryable, tenantId: string, employeeId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT k.operating_company_key FROM eos_workforce.employees e
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id AND k.status = 'ACTIVE'
      WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, employeeId]);
  return rows.length === 1 ? String(rows[0].operating_company_key) : null;
}

export type MobileActDecision =
  | { readonly allowed: true; readonly employeeId: string; readonly location: UsableMobileLocation }
  | { readonly allowed: false; readonly decision: AuthorizationDecision };

/**
 * The full Technician-path decision for one act at one MOBILE location (steps 1-5 above). A refused authorization comes
 * back as a decision (so a caller can fall through to another path); a location / company precondition throws.
 */
export async function authorizeMobileAct(db: Queryable, actor: ContextualActor, capabilityKey: string, locationId: string,
  opts: { readonly lock?: boolean } = {}): Promise<MobileActDecision> {
  const reader = postgresContextualReader(db);
  const decision = await authorizeObjectAction(reader, { actor, capabilityKey, predicates: mobilePredicates(locationId) });
  if (!decision.allowed) return { allowed: false, decision };
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  if (!employeeId) return { allowed: false, decision: { ...decision, allowed: false, reason: "EMPLOYEE_LINK_REQUIRED" } as AuthorizationDecision };
  const location = await requireUsableMobileLocation(db, actor.tenantId, locationId, opts);
  if ((await employeeCompanyKey(db, actor.tenantId, employeeId)) !== location.operatingCompanyKey) {
    throw new MobileStockRefusal("MOBILE_LOCATION_COMPANY_MISMATCH", "FORBIDDEN", "the truck belongs to a different operating company than your employment");
  }
  return { allowed: true, employeeId, location };
}

/**
 * The MOBILE locations the caller may operate RIGHT NOW: current MOBILE scopes of the caller's access-eligible linked Employee,
 * over ACTIVE locations linked to an active truck of the Employee's own operating company. Empty for a caller without an
 * Employee, without eligibility or without scope -- never "all trucks".
 */
export async function currentMobileLocationIds(db: Queryable, actor: { readonly tenantId: string; readonly principalId: string }): Promise<string[]> {
  const reader = postgresContextualReader(db);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  if (!employeeId) return [];
  if (!(await reader.hasWorkEligibility(actor.tenantId, employeeId, MOBILE_WORK_ELIGIBILITY))) return [];
  const { rows } = await db.query(
    `SELECT s.scope_id FROM eos_workforce.employee_operational_scopes s
       JOIN eos_ops.mobile_locations m ON m.tenant_id = s.tenant_id AND m.location_type = 'MOBILE' AND m.location_id = s.scope_id AND m.active
       JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
                            AND t.active AND t.status::text <> 'OUT_OF_SERVICE'
       JOIN eos_workforce.employees e ON e.tenant_id = s.tenant_id AND e.id = s.employee_id
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id
                            AND k.status = 'ACTIVE' AND k.operating_company_key = m.operating_company_key
      WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.scope_type = 'MOBILE' AND s.effective_to IS NULL
      ORDER BY s.scope_id`, [actor.tenantId, employeeId]);
  return rows.map((r) => String(r.scope_id));
}
