// FINANCE VISIBILITY -- the credited-person / team reach that sits INSIDE the company boundary (Firebase exit B1, DECISIONS #B1;
// Owner rulings F7c-3 and SALES FINANCE VISIBILITY, 2026-10-17).
//
//   OUTER LIMIT   financeCompanyAccess.ts: capability AND an explicit operating-company assignment. Unchanged.
//   INNER REACH   THIS FILE: inside a company the principal reaches, which receivables may it read? Mirrors Firebase FIN-004
//                 (functions/src/finance/financialVisibility.ts): finance.visibility.{self,team,businessUnit,company,consolidated}.
//
// RESOLUTION, per principal and per reached company (D-249-2 .. D-249-4; the company boundary is always the outer limit):
//
//   holds an active consolidated or company key (flat, or admitted at that company)   FULL     every record of the company
//   holds NO visibility key at all                                                    FULL     (EOS's company-assignment model;
//                                                                                              D-249-2, the Firebase default is the
//                                                                                              fact-family gate alone)
//   holds only self / team, and they are ACTIVE                                       SELF|TEAM attributed RECEIVABLE rows only
//   holds only self / team and they are INACTIVE (every environment today, D-249-0)   EMPTY    nothing -- Firebase's effective zero
//   holds only businessUnit                                                           EMPTY    EOS receivables carry no business unit
//
// A mixed holder (a salesperson who also holds something else without a visibility key) resolves by the visibility keys it
// holds: any visibility key without a full one is a RESTRICTION, never a widening (fail closed).
//
// WHAT "ATTRIBUTED" MEANS (authoritative sales source, derive-not-persist; FIN-002 "historical stays historical"):
//   obligation.source_domain = 'BILLING_PACKAGE' -> billing_packages.id = source_record_id, source_kind = 'SALES_ORDER', the
//   package's company equals the obligation's -> eos_commercial.sales_orders.credited_salesperson_employee_id. That credit is
//   set at creation, never edited (a store trigger refuses any change), and is NEVER the Account owner or the creator.
//   NOT attributable (hidden from restricted readers, visible to FULL): RENTAL_CHARGE packages, INTERCOMPANY / PAYABLE /
//   FUNDING obligations, an Order with no credit, a package whose company differs from the obligation's.
//
// TEAM (D-249-1, Owner choice A, PROPOSED definition -- implemented, inert while self/team are inactive): the credited person's
// reporting line (eos_workforce.employee_reporting_relationships) AS OF THE ORDER'S CREATION (the moment the credit was
// recorded): the manager chain at that date, transitive, depth-bounded, cycle-safe, fail-closed -- a break in the chain hides
// the row from managers while the credited person and Finance still see it. Legacy-migrated lines start at the snapshot time,
// so an Order older than that has no manager under this definition (named data wrinkle).
//
// ONE PLACE: every finance projection (workspace, lists, details, totals, Analysis measures, the Account strip) asks this file
// for its row set. There is no second copy of the rule.
import type { PoolClient } from "pg";
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES } from "../adminPolicy/employmentAccessEligibility";
import type { FinanceReachActor } from "./financeCompanyAccess";

type Db = Pick<PoolClient, "query">;

export const FINANCE_VISIBILITY_SELF = "finance.visibility.self";
export const FINANCE_VISIBILITY_TEAM = "finance.visibility.team";
export const FINANCE_VISIBILITY_BUSINESS_UNIT = "finance.visibility.businessUnit";
export const FINANCE_VISIBILITY_COMPANY = "finance.visibility.company";
export const FINANCE_VISIBILITY_CONSOLIDATED = "finance.visibility.consolidated";
export const FINANCE_VISIBILITY_KEYS = Object.freeze([
  FINANCE_VISIBILITY_SELF, FINANCE_VISIBILITY_TEAM, FINANCE_VISIBILITY_BUSINESS_UNIT, FINANCE_VISIBILITY_COMPANY, FINANCE_VISIBILITY_CONSOLIDATED,
]);

/**
 * THE ACTIVATION SWITCH (D-249-0). self and team are mirrored INACTIVE, exactly as Firebase has them in every environment.
 * Activation is an Owner decision; until then the transport passes nothing and a self/team-only holder is RESTRICTED-EMPTY.
 * Tests pass `true` to exercise the activated fixture. There is deliberately no environment variable and no stored flag.
 */
export const FINANCE_SELF_TEAM_ACTIVE_DEFAULT = false;

/** The deepest reporting chain a TEAM reach follows (fail closed beyond it). */
export const TEAM_MAX_DEPTH = 8;
/** The largest visible-receivable set one request resolves; beyond it the request is refused rather than truncated. */
export const VISIBLE_SET_CAP = 20_000;

export type FinanceVisibilityMode = "FULL" | "SELF" | "TEAM" | "EMPTY";

export interface FinanceVisibilityActor extends FinanceReachActor {
  readonly tenantId: string;
  readonly principalId: string;
  /** D-249-0: true only when the Owner has activated self/team reach (and in the activated test fixture). */
  readonly financeSelfTeamActive?: boolean;
}

const heldAt = (actor: FinanceReachActor, key: string, company: string): boolean =>
  actor.capabilities.has(key) || admittedScopeValues(actor.scopedHeld as never, key, "operatingCompany").includes(company);

/** PURE: the inner reach of `actor` at one operating company (which the outer company rule has already admitted). */
export function financeVisibilityModeAt(actor: FinanceReachActor, companyId: string, selfTeamActive: boolean): FinanceVisibilityMode {
  const has = (key: string) => heldAt(actor, key, companyId);
  if (has(FINANCE_VISIBILITY_CONSOLIDATED) || has(FINANCE_VISIBILITY_COMPANY)) return "FULL";
  if (!has(FINANCE_VISIBILITY_SELF) && !has(FINANCE_VISIBILITY_TEAM) && !has(FINANCE_VISIBILITY_BUSINESS_UNIT)) return "FULL";
  if (selfTeamActive && has(FINANCE_VISIBILITY_TEAM)) return "TEAM";
  if (selfTeamActive && has(FINANCE_VISIBILITY_SELF)) return "SELF";
  return "EMPTY";
}

export interface FinanceVisibility {
  readonly fullCompanies: readonly string[];
  /** SELF or TEAM companies: only the attributed receivables in `visibleReceivableIds`. */
  readonly restrictedCompanies: readonly string[];
  /** Reached, but nothing is visible. */
  readonly emptyCompanies: readonly string[];
  readonly visibleReceivableIds: readonly string[];
  /** True when ANY company in play is not FULL: a total over it must be over visible rows only and unattributable sections withheld. */
  readonly restricted: boolean;
}

/** The caller's Employee, or null: exactly one ACTIVE link to an access-eligible Employee of this tenant, otherwise nothing. */
export async function linkedEmployeeId(db: Db, tenantId: string, principalId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT l.employee_id, e.employment_status::text AS employment_status
       FROM eos_policy.employee_principal_links l
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, principalId]);
  if (rows.length !== 1) return null;
  const status = rows[0].employment_status;
  return typeof status === "string" && ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES.includes(status) ? String(rows[0].employee_id) : null;
}

/**
 * The attributed RECEIVABLES an Employee may read in `companies` (SELF: credited to them; TEAM: also credited to anyone who
 * reported to them, transitively, at the Order's creation). Order by id for determinism.
 */
async function visibleReceivables(db: Db, tenantId: string, employeeId: string, companies: readonly string[], team: boolean): Promise<string[]> {
  const base = `
    SELECT o.id AS obligation_id, so.credited_salesperson_employee_id AS credited, so.created_at AS as_of
      FROM eos_finance.obligations o
      JOIN eos_finance.billing_packages p ON p.tenant_id = o.tenant_id AND p.id = o.source_record_id
                                         AND p.source_kind = 'SALES_ORDER' AND p.operating_company_id = o.operating_company_id
      JOIN eos_commercial.sales_orders so ON so.tenant_id = p.tenant_id AND so.id = p.sales_order_id
     WHERE o.tenant_id = $1 AND o.kind = 'RECEIVABLE' AND o.source_domain = 'BILLING_PACKAGE' AND o.operating_company_id = ANY($2)
       AND so.credited_salesperson_employee_id IS NOT NULL`;
  const sql = team
    ? `WITH RECURSIVE attributed AS (${base}),
            up(obligation_id, as_of, employee_id, depth, path) AS (
              SELECT a.obligation_id, a.as_of, a.credited, 0, ARRAY[a.credited] FROM attributed a
              UNION ALL
              SELECT u.obligation_id, u.as_of, r.manager_employee_id, u.depth + 1, u.path || r.manager_employee_id
                FROM up u JOIN eos_workforce.employee_reporting_relationships r
                  ON r.tenant_id = $1 AND r.employee_id = u.employee_id AND r.effective_from <= u.as_of AND (r.effective_to IS NULL OR r.effective_to > u.as_of)
               WHERE u.depth < ${TEAM_MAX_DEPTH} AND NOT (r.manager_employee_id = ANY(u.path)))
        SELECT DISTINCT obligation_id FROM up WHERE employee_id = $3 ORDER BY obligation_id LIMIT ${VISIBLE_SET_CAP + 1}`
    : `WITH attributed AS (${base}) SELECT DISTINCT obligation_id FROM attributed WHERE credited = $3 ORDER BY obligation_id LIMIT ${VISIBLE_SET_CAP + 1}`;
  const { rows } = await db.query(sql, [tenantId, [...companies], employeeId]);
  if (rows.length > VISIBLE_SET_CAP) {
    throw Object.assign(new Error(`FINANCE_VISIBILITY_TOO_WIDE: more than ${VISIBLE_SET_CAP} visible receivables in one request; narrow the company`), { code: "FINANCE_VISIBILITY_TOO_WIDE" });
  }
  return rows.map((r) => String(r.obligation_id));
}

/**
 * Resolve `actor`'s inner reach over `companies` (already admitted by the outer company rule). A restricted principal whose
 * identity does not resolve to exactly one access-eligible Employee reads nothing.
 */
export async function resolveFinanceVisibility(db: Db, actor: FinanceVisibilityActor, companies: readonly string[]): Promise<FinanceVisibility> {
  const active = actor.financeSelfTeamActive ?? FINANCE_SELF_TEAM_ACTIVE_DEFAULT;
  const full: string[] = [], selfCs: string[] = [], teamCs: string[] = [], empty: string[] = [];
  for (const c of companies) {
    const mode = financeVisibilityModeAt(actor, c, active);
    (mode === "FULL" ? full : mode === "SELF" ? selfCs : mode === "TEAM" ? teamCs : empty).push(c);
  }
  let ids: string[] = [];
  if (selfCs.length + teamCs.length > 0) {
    const employeeId = await linkedEmployeeId(db, actor.tenantId, actor.principalId);
    if (employeeId === null) {
      empty.push(...selfCs, ...teamCs);
      selfCs.length = 0; teamCs.length = 0;
    } else {
      const sets = await Promise.all([
        selfCs.length ? visibleReceivables(db, actor.tenantId, employeeId, selfCs, false) : Promise.resolve([] as string[]),
        teamCs.length ? visibleReceivables(db, actor.tenantId, employeeId, teamCs, true) : Promise.resolve([] as string[]),
      ]);
      ids = [...new Set(sets.flat())].sort();
    }
  }
  return Object.freeze({
    fullCompanies: Object.freeze(full), restrictedCompanies: Object.freeze([...selfCs, ...teamCs].sort()), emptyCompanies: Object.freeze(empty.sort()),
    visibleReceivableIds: Object.freeze(ids), restricted: selfCs.length + teamCs.length + empty.length > 0,
  });
}

/** A visibility that restricts nothing over `companies` (the shape every FULL reader gets). */
export const unrestricted = (companies: readonly string[]): FinanceVisibility => Object.freeze({
  fullCompanies: Object.freeze([...companies]), restrictedCompanies: Object.freeze([]), emptyCompanies: Object.freeze([]), visibleReceivableIds: Object.freeze([]), restricted: false,
});

/** The names a withheld section carries (never a value, never a zero). */
export const RESTRICTED_WITHHELD_REASON =
  "restricted finance visibility: this section cannot be attributed to a credited salesperson, so it is not shown (and not shown as zero)";

/**
 * SQL over obligations `alias`: a row of a FULL company, or a visible attributed receivable of a restricted company. Pushes its
 * two parameters onto `params` (whose first entry is the tenant at $1) and returns the clause.
 */
export function obligationVisibilityClause(vis: FinanceVisibility, alias: string, params: unknown[]): string {
  params.push([...vis.fullCompanies]); const a = params.length;
  params.push([...vis.visibleReceivableIds]); const b = params.length;
  return `(${alias}.operating_company_id = ANY($${a}) OR ${alias}.id = ANY($${b}))`;
}

/**
 * SQL over settlements `alias`: every settlement of a FULL company; for a restricted company ONLY a settlement that HAS
 * applications and whose every application ever recorded (reversed ones included) is to a visible obligation. Unapplied
 * settlements are hidden from restricted readers.
 */
export function settlementVisibilityClause(vis: FinanceVisibility, alias: string, params: unknown[]): string {
  params.push([...vis.fullCompanies]); const a = params.length;
  params.push([...vis.restrictedCompanies]); const r = params.length;
  params.push([...vis.visibleReceivableIds]); const v = params.length;
  return `(${alias}.operating_company_id = ANY($${a}) OR (${alias}.operating_company_id = ANY($${r})
      AND EXISTS (SELECT 1 FROM eos_finance.settlement_applications sa WHERE sa.tenant_id = ${alias}.tenant_id AND sa.settlement_id = ${alias}.id)
      AND NOT EXISTS (SELECT 1 FROM eos_finance.settlement_applications sa WHERE sa.tenant_id = ${alias}.tenant_id AND sa.settlement_id = ${alias}.id
                         AND NOT (sa.obligation_id = ANY($${v})))))`;
}
