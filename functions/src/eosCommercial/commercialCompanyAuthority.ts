// OPERATING-COMPANY AUTHORITY ON COMMERCIAL RECORDS -- Q-1a (Owner ruling Q1-11; DECISIONS #Q-1a-company; supersedes the "Commercial reserved" line of #235).
//
// ONE resolver, ONE reach object, ONE SQL predicate for every Commercial read, write, approval, record and export (Opportunities, Sales Agreements,
// Sales Orders, trade-in and discount decisions, lists, the Account projection) AND for Sales Order allocation (eosOps/salesOrderAllocation.ts).
//
//   ORDER      capability  ->  COMPANY AUTHORITY (this file)  ->  channel / ownership reach (the existing sales-channel narrowing, unchanged).
//   OWN        a record is reachable when its operating-company KEY is one of the caller's company keys (resolveCompanyAuthority: home company, OPERATIONAL
//              company-scoped Role assignments, explicit company-access grants -- the SAME authority the inventory domains use).
//   FOREIGN    a record of any other company is NONEXISTENT to the caller: a detail read, a command target and a lock are all a plain miss (the predicate
//              is inside the SELECT, so a foreign row is never even locked), a list never contains it, a lineage reference to it is null. No code, count,
//              message or timing distinguishes it from a record that is not there.
//   NO COMPANY an Opportunity or Sales Agreement may carry no company until one is set (Sales Orders and Work Orders are NOT NULL). Owner ruling: such a
//              record is visible ONLY to its owner (the caller's linked Employee) or creator (created_by = the caller's Principal), the protected
//              Administrator and the protected Owner; everyone else sees it as nonexistent. Setting a company brings it under the rule above.
//   ADMINISTRATOR the protected Administrator's Commercial reach is UNCHANGED: before this lane Commercial was tenant-wide for a global capability holder and
//              the protected Administrator (standing decided by the protected-administrator standing rule, principalHasProtectedAdministratorStanding) is exactly that, so it is
//              UNRESTRICTED here -- every company, a company-less record, and a record of a since-deactivated company. Proved by a before/after test.
//   NATIONAL ACCOUNTS are a sales CHANNEL, never a company: channel narrowing stays inside company authority and no channel crosses a company.
//
// This file confers nothing: it never adds a capability and never widens a read beyond what the capability and channel already allowed.
import type { PoolClient } from "pg";
import { ADMIN_ROLE_KEY, hasProtectedAdministratorStanding, PROTECTED_OWNER_ROLE_KEY } from "../adminPolicy/protectedAdministrator";
import { isProtectedOwnerRole } from "../adminPolicy/administrationAuthority";
import { admittedScopeValues, type ScopedHolding } from "../adminPolicy/assignmentScopeRuntime";
import { qualifyingGlobalRoles } from "../eosOps/administrationReach";
import { resolveCompanyAuthority } from "../eosOps/companyAuthority";

type Db = Pick<PoolClient, "query">;

/** The three stored facts a Commercial record's company visibility is decided on. */
export interface CommercialRecordCompanyFacts {
  readonly operatingCompanyKey: string | null;
  /** The record's owner (an Employee id) as stored. Named neutrally: this file reads ownership, it never writes or changes it. */
  readonly ownerRef: string | null;
  readonly createdBy: string | null;
}

export interface CommercialCompanyReach {
  /** Why the caller reaches what it reaches (for tests and the audit story; never a client field). */
  readonly basis: "PROTECTED_ADMINISTRATOR" | "OWN" | "NONE";
  /** True when the caller is the protected Owner (sees company-less records; company-keyed records follow OWN like everyone else). */
  readonly protectedOwner: boolean;
  /** The operating-company KEYS the caller holds authority over. Empty for the protected Administrator, whose reach is unrestricted. */
  readonly companyKeys: readonly string[];
  /** May the caller see this stored record? */
  admits(record: CommercialRecordCompanyFacts): boolean;
  /** May the caller CREATE a record in this company (null = a company-less record, which its creator can see)? */
  admitsNewCompany(companyKey: string | null): boolean;
  /** The three bind values `sql` references, in order: company keys, owner Employee ids, creator Principal id. */
  sqlParams(): readonly unknown[];
  /** A boolean SQL expression over `alias.operating_company_key / owner_employee_id / created_by`, using $firstParam..$firstParam+2. */
  sql(alias: string, firstParam: number): string;
}

export interface CommercialCompanyReachFacts {
  readonly unrestricted: boolean;
  readonly protectedOwner: boolean;
  readonly companyKeys: readonly string[];
  readonly employeeIds: readonly string[];
  /** The caller's Principal id when it may count as a record's creator; null when identity failed (fail closed). */
  readonly creatorId: string | null;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function commercialCompanyReachOf(f: CommercialCompanyReachFacts): CommercialCompanyReach {
  const keys = Object.freeze([...f.companyKeys]);
  const employees = Object.freeze([...f.employeeIds]);
  return Object.freeze({
    basis: f.unrestricted ? "PROTECTED_ADMINISTRATOR" as const : keys.length > 0 || f.protectedOwner || employees.length > 0 || f.creatorId !== null ? "OWN" as const : "NONE" as const,
    protectedOwner: f.protectedOwner,
    companyKeys: keys,
    admits(r: CommercialRecordCompanyFacts): boolean {
      if (f.unrestricted) return true;
      if (r.operatingCompanyKey !== null) return keys.includes(r.operatingCompanyKey);
      return f.protectedOwner
        || (r.ownerRef !== null && employees.includes(r.ownerRef))
        || (f.creatorId !== null && r.createdBy === f.creatorId);
    },
    admitsNewCompany(companyKey: string | null): boolean {
      return f.unrestricted || companyKey === null || keys.includes(companyKey);
    },
    sqlParams: () => [keys, employees, f.creatorId],
    sql(alias: string, firstParam: number): string {
      // The alias is a code-supplied identifier, never input; the check keeps it that way.
      if (!IDENT.test(alias) || !Number.isInteger(firstParam) || firstParam < 1) throw new Error("commercial company predicate: bad alias or parameter index");
      const p = firstParam;
      return `(${f.unrestricted ? "TRUE" : "FALSE"} OR ${alias}.operating_company_key = ANY($${p}::text[])`
        + ` OR (${alias}.operating_company_key IS NULL AND (${f.protectedOwner ? "TRUE" : "FALSE"}`
        + ` OR ${alias}.owner_employee_id = ANY($${p + 1}::text[]) OR ${alias}.created_by = $${p + 2}::text)))`;
    },
  });
}

/** A reach that admits nothing: for a read that touches no Commercial record (the caller's own capability list). */
export const NO_COMMERCIAL_COMPANY_REACH: CommercialCompanyReach = commercialCompanyReachOf({
  unrestricted: false, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: null,
});

/**
 * TEST INJECTION ONLY (like the catalog authority): the deployed server supplies none, and a test asserts it. A suite that does not exercise company
 * authority hands the kernel a resolver of its own; the real one is below.
 */
export type CommercialCompanyResolver = (db: Db, tenantId: string, principalId: string) => Promise<CommercialCompanyReach>;

export const resolveCommercialCompanyReach: CommercialCompanyResolver = async (db, tenantId, principalId) => {
  // One read of the qualifying global Roles decides BOTH protected identities (the same rule as principalHasProtectedAdministratorStanding).
  const roles = await qualifyingGlobalRoles(db, tenantId, principalId, [ADMIN_ROLE_KEY, PROTECTED_OWNER_ROLE_KEY]);
  const held = roles.map((r) => r.key);
  if (hasProtectedAdministratorStanding(roles, held)) {
    return commercialCompanyReachOf({ unrestricted: true, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: principalId });
  }
  const protectedOwner = roles.some((r) => isProtectedOwnerRole(r));
  const authority = await resolveCompanyAuthority(db, tenantId, principalId);
  // An identity gap (no usable Employee link, ambiguity, an ineligible Employee) has NO company authority and cannot claim a company-less record as
  // its own either: fail closed. (A protected Owner always has a usable link -- qualifyingGlobalRoles requires it.)
  if (authority.gap !== null) {
    return commercialCompanyReachOf({ unrestricted: false, protectedOwner, companyKeys: [], employeeIds: [], creatorId: null });
  }
  const { rows } = await db.query<{ employee_id: string }>(
    `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, principalId]);
  return commercialCompanyReachOf({
    unrestricted: false, protectedOwner, companyKeys: authority.companyKeys, employeeIds: rows.map((r) => String(r.employee_id)), creatorId: principalId,
  });
};

// ════════════════════ the ONE "may this caller see this Sales Order" decision for non-Commercial callers ════════════════════

/**
 * The shared Sales Order visibility decision (Commercial company authority + the existing sales-channel narrowing), for a caller outside the Commercial
 * transport -- Sales Order allocation (eosOps/salesOrderAllocation.ts: allocate, release, read). The Commercial reads and commands apply the SAME
 * `CommercialCompanyReach` (resolved by the SAME resolver) inside their own SQL. A caller that fails here reads the order as NONEXISTENT; allocation
 * takes the INTERSECTION of this and its own inventory company / warehouse checks (fail closed).
 *
 * Channel: a capability held globally (in `capabilities`) reaches every channel; one held only at salesChannel=X reaches an order whose stored channel is X.
 * A caller carrying no scoped holdings (the Operations actor) is therefore decided on the global capability alone.
 */
export async function callerMaySeeSalesOrder(
  db: Db,
  actor: { readonly tenantId: string; readonly principalId: string; readonly capabilities: ReadonlySet<string>; readonly scopedHeld?: readonly ScopedHolding[] },
  salesOrderId: string,
  capabilityKeys: readonly string[],
  resolver: CommercialCompanyResolver = resolveCommercialCompanyReach,
): Promise<boolean> {
  const reach = await resolver(db, actor.tenantId, actor.principalId);
  const { rows } = await db.query<{ sales_channel: string | null }>(
    `SELECT s.sales_channel::text AS sales_channel FROM eos_commercial.sales_orders s
      WHERE s.tenant_id = $1 AND s.id = $2 AND ${reach.sql("s", 3)}`, [actor.tenantId, salesOrderId, ...reach.sqlParams()]);
  if (rows.length === 0) return false;
  if (capabilityKeys.some((k) => actor.capabilities.has(k))) return true;
  const channel = rows[0].sales_channel;
  return typeof channel === "string" && channel !== ""
    && capabilityKeys.some((k) => admittedScopeValues(actor.scopedHeld, k, "salesChannel").includes(channel));
}
