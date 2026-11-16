// OPERATING-COMPANY AUTHORITY ON WORK ORDERS -- lane DWO (Owner ruling Q1-11 carried to Dispatch; DECISIONS #DWO-company, closing the #Q-1a-company
// named follow-up "Dispatch Work Order scoping by operating company"). Hardening of the EXISTING PostgreSQL Work Order system: no second implementation.
//
// ONE resolver, ONE reach object, ONE SQL predicate for every Work Order read, list, board, search and command. It is the Q-1a pattern
// (eosCommercial/commercialCompanyAuthority.ts) applied to the Work Order's own `operating_company_key` (NOT NULL on every Work Order):
//
//   ORDER      capability  ->  record relation (own assignment, where the grant is conditioned)  ->  COMPANY AUTHORITY (this file).
//   OWN        a Work Order is reachable when its operating-company KEY is one of the caller's company keys (resolveCompanyAuthority: home company,
//              OPERATIONAL company-scoped Role assignments, explicit company-access grants -- the SAME authority the inventory domains, the office list,
//              the technician picker and the Work Order scheduling commands already use). The Work Order's company is the company that PERFORMS the work.
//   ASSIGNED   the Employee the caller is linked to holds the Work Order's OPEN assignment: that technician legitimately works the job (accept, travel, arrive, work,
//              parts, labor, complete) and keeps seeing and acting on it whatever company it is in (a migrated or legacy assignment). The owning company of a sale,
//              the servicing company, the accountable Employee and the assigned technician are four different things; an assignment reaches only the Work Order it
//              is on, never a company.
//   FOREIGN    a Work Order of any other company, with no assignment to the caller, is NONEXISTENT to the caller: the predicate is inside the SELECT (and inside
//              SELECT ... FOR UPDATE), so a foreign row is never read, never locked and never described; the refusal is the one a missing id gets (same code,
//              category and message).
//   NO AUTHORITY  a caller with no company authority at all (and not the protected Administrator) is COMPANY_AUTHORITY_REQUIRED, uniformly for every id, exactly as
//              the office list and the scheduling commands answer it.
//   ADMINISTRATOR the protected Administrator's reach is UNCHANGED. Two modes, chosen per entry point and never inferred:
//              UNRESTRICTED  the entry points that were tenant-wide before this lane (detail, transitions, labor, parts, execution, install, analytics, ...):
//                            the protected Administrator keeps every company, exactly as before.
//              OWN           the entry points that were ALREADY bounded by the caller's own company authority (schedule / reschedule / dispatch -- D-248-1 --
//                            the office list, the technician picker): the Administrator stays bounded by its own authority, exactly as before.
//              The mode is a recorded fact of each entry point (the inventory in DECISIONS #DWO-company), not a policy choice made here.
//   SERVICE PROVIDER cross-company authorization (a provider company serving another company's Sales Order -- eosCommercial/fulfillment/serviceProviderAuthorization.ts)
//              is a Sales Order <-> Work Order LINK rule, decided at creation and at completion. It is untouched; the Work Order is the provider's, reached by the
//              provider's people and the technicians assigned to it.
//
// This file confers nothing: it never adds a capability and never widens a read beyond what the capability and the relation already allowed.
import type { PoolClient } from "pg";
import { resolveCompanyAuthority, type CompanyAuthority } from "./companyAuthority";
import { authorizedCompanyKeys, principalHasProtectedAdministratorStanding } from "./administrationReach";

type Db = Pick<PoolClient, "query">;

export type WorkOrderAdministratorMode = "UNRESTRICTED" | "OWN";

export interface WorkOrderCompanyReach {
  /** True only for the protected Administrator in UNRESTRICTED mode. */
  readonly unrestricted: boolean;
  /** False when the caller has no company authority at all and is not unrestricted. */
  readonly hasAuthority: boolean;
  /** The operating-company KEYS the caller reaches (empty for the unrestricted Administrator, whose reach is every company). */
  readonly companyKeys: readonly string[];
  /** The Employee ids the caller is linked to: the OPEN-assignment branch of the predicate. */
  readonly employeeIds: readonly string[];
  /** May the caller see a Work Order of this stored company key (by company; an assignment is decided in SQL)? */
  admits(companyKey: string | null | undefined): boolean;
  /** The TWO bind values `sql` references: the company keys, then the caller's Employee ids. */
  sqlParams(): readonly unknown[];
  /**
   * A boolean SQL expression over a Work Order row, using $firstParam and $firstParam+1. `column` is `operating_company_key` of an UNALIASED eos_ops.work_orders (the row is then
   * addressed as work_orders) or `alias.operating_company_key`.
   *
   * `assignment` (default true) is the OPEN-assignment branch. It is for the FIELD side of a Work Order: detail, field context, labor, parts used, install, accept / travel /
   * arrive / start / complete, My Work. It is `false` for the OFFICE side -- Schedule, Reschedule, Dispatch, Unschedule, cancel / close by the office, parts planning, the
   * estimate, the office lists, search, aggregates, self-scheduling links and the inbound queue -- so an assignment never authorizes dispatch, scheduling, cancellation,
   * billing or cross-company office access. The bind arity is the same either way (the second bind is then referenced by a no-op).
   */
  sql(column: string, firstParam: number, options?: { readonly assignment?: boolean }): string;
}

const COLUMN = /^(?:[a-z_][a-z0-9_]*\.)?operating_company_key$/;

export function workOrderCompanyReachOf(f: {
  readonly unrestricted: boolean; readonly hasAuthority: boolean; readonly companyKeys: readonly string[]; readonly employeeIds?: readonly string[];
}): WorkOrderCompanyReach {
  const keys = Object.freeze([...f.companyKeys]);
  const employees = Object.freeze([...(f.employeeIds ?? [])]);
  return Object.freeze({
    unrestricted: f.unrestricted,
    hasAuthority: f.unrestricted || f.hasAuthority,
    companyKeys: keys,
    employeeIds: employees,
    admits: (companyKey: string | null | undefined): boolean => f.unrestricted || (typeof companyKey === "string" && keys.includes(companyKey)),
    sqlParams: (): readonly unknown[] => [keys, employees],
    sql(column: string, firstParam: number, options: { readonly assignment?: boolean } = {}): string {
      // The column is a code-supplied identifier, never input; the check keeps it that way.
      if (!COLUMN.test(column) || !Number.isInteger(firstParam) || firstParam < 1) throw new Error("work order company predicate: bad column or parameter index");
      const row = column.includes(".") ? column.slice(0, column.indexOf(".")) : "work_orders";
      const company = `${f.unrestricted ? "TRUE" : "FALSE"} OR ${column} = ANY($${firstParam}::text[])`;
      if (options.assignment === false) return `((${company}) AND ($${firstParam + 1}::text[] IS NULL OR TRUE))`;
      return `(${company}`
        + ` OR EXISTS (SELECT 1 FROM eos_ops.work_order_assignments wra WHERE wra.tenant_id = ${row}.tenant_id AND wra.work_order_id = ${row}.id AND wra.effective_to IS NULL`
        + ` AND wra.assignee_employee_id = ANY($${firstParam + 1}::text[])))`;
    },
  });
}

/** A reach that admits nothing. */
export const NO_WORK_ORDER_COMPANY_REACH: WorkOrderCompanyReach = workOrderCompanyReachOf({ unrestricted: false, hasAuthority: false, companyKeys: [] });

export async function resolveWorkOrderCompanyReach(
  db: Db, tenantId: string, principalId: string, options: { readonly administrator?: WorkOrderAdministratorMode } = {},
): Promise<WorkOrderCompanyReach> {
  if ((options.administrator ?? "UNRESTRICTED") === "UNRESTRICTED" && await principalHasProtectedAdministratorStanding(db, tenantId, principalId)) {
    return workOrderCompanyReachOf({ unrestricted: true, hasAuthority: true, companyKeys: [] });
  }
  const authority = await resolveCompanyAuthority(db, tenantId, principalId);
  // The caller's linked Employee (identity resolved: no gap) is the one whose OPEN assignment counts.
  const employeeIds = authority.gap !== null ? [] : (await db.query<{ employee_id: string }>(
    `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, principalId])).rows
    .map((r) => String(r.employee_id));
  // An OPEN assignment alone is authority over ITS Work Order even where the home company is inactive or unkeyed -- but only for an identity that resolved (an enabled Principal
  // with an active membership and exactly one active link to an access-eligible Employee). A terminated or ineligible Employee, a disabled Principal and an ambiguous link have a
  // gap and no employee ids; an ended or reassigned assignment is not OPEN; and every capability and lifecycle rule still applies.
  return workOrderCompanyReachOf({ unrestricted: false, hasAuthority: authority.companies.length > 0 || employeeIds.length > 0, companyKeys: authority.companyKeys, employeeIds });
}

/**
 * READ authority over Work Orders (Owner DWO-2, 2026-10-21): the protected Administrator has consistent tenant-wide administrative READ visibility -- every ACTIVE operating
 * company and key of the tenant -- for the office list, the technician picker, schedule views, placement suggestions, analytics, search and detail. Everyone else (the
 * protected Owner included) follows its own company authority. Read visibility authorizes NO mutation: every mutation keeps its own capability, lifecycle, integrity and audit
 * rules and its own company reach (Schedule / Reschedule / Dispatch / Create / working hours / unavailability stay bounded by the caller's own authority, as before).
 */
export async function resolveWorkOrderReadAuthority(db: Db, tenantId: string, principalId: string): Promise<CompanyAuthority> {
  if (await principalHasProtectedAdministratorStanding(db, tenantId, principalId)) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT operating_company_id AS id FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY 1`, [tenantId]);
    const keys = await authorizedCompanyKeys(db, tenantId);
    return Object.freeze({ companies: Object.freeze(rows.map((r) => String(r.id))), companyKeys: Object.freeze([...keys]), gap: null });
  }
  return resolveCompanyAuthority(db, tenantId, principalId);
}

export const COMPANY_AUTHORITY_REQUIRED_MESSAGE =
  "no operating-company authority: requires one access-eligible linked Employee with an active home company, or an operating-company assignment";

/**
 * The reach, or the refusal every Work Order entry point gives a caller with no company authority at all: COMPANY_AUTHORITY_REQUIRED (403), decided before any
 * Work Order row is read and identical for every id. `refuse` is the calling module's own governed refusal.
 */
export async function requireWorkOrderCompanyReach(
  db: Db, tenantId: string, principalId: string,
  refuse: (code: string, category: "FORBIDDEN", message: string) => never,
  options: { readonly administrator?: WorkOrderAdministratorMode; readonly message?: string } = {},
): Promise<WorkOrderCompanyReach> {
  const reach = await resolveWorkOrderCompanyReach(db, tenantId, principalId, options);
  if (!reach.hasAuthority) refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", options.message ?? COMPANY_AUTHORITY_REQUIRED_MESSAGE);
  return reach;
}
