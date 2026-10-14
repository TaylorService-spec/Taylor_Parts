// FINANCIALS COMPANY ACCESS -- capability AND explicit operating-company assignment (Owner ruling 2026-10-13; the
// Financials Workspace P0 correction, Owner-directed 2026-10-14). The same rule #2089 gave Financial Policy
// (financialPolicy.ts capabilityReach), applied to the Finance reads, the settlement commands and the Analysis finance
// measures:
//
//   A finance key applies at operating company C only when BOTH hold:
//     1. the CAPABILITY: the key is held flat (a global Role, e.g. controller / accountingManager / owner; or Administrator
//        standing) or through an UNCONDITIONED operatingCompany-scoped holding; and
//     2. an EXPLICIT, ACTIVE operatingCompany-scoped assignment for C: an unconditioned C-scoped holding of THAT key or --
//        for a key held flat -- of FINANCE_COMPANY_ASSIGNMENT_KEY (finance.payment.read, the Finance view key).
//
//   * A flat holding, a global Role or Administrator standing alone reaches NO company. There is no implicit "all
//     companies".
//   * The company assignment supplies REACH only, never a key: a principal holding finance.payment.read at C still needs
//     finance.settlement.record (etc.) to record at C.
//   * CONSOLIDATED (the reporting projection across companies) is admitted only when the key reaches EVERY active company.
//   * OUT OF SCOPE == UNKNOWN: an unassigned, an inactive and a non-existent company get the same refusal, so no caller
//     learns which companies exist.
//
// Pure: no query, no Firebase. Callers resolve the tenant's ACTIVE companies and refuse with their own error type.
import { admittedScopeValues, type ScopedHolding } from "../adminPolicy/assignmentScopeRuntime";

/** The Finance view key; a C-scoped holding of it is the explicit Financials company assignment for C. */
export const FINANCE_COMPANY_ASSIGNMENT_KEY = "finance.payment.read";

export interface FinanceReachActor {
  readonly capabilities: ReadonlySet<string>;
  readonly scopedHeld?: readonly ScopedHolding<unknown>[];
}

/** The companies `key` reaches for this actor (sorted), or null when the key is held nowhere. */
export function financeCompanyReach(actor: FinanceReachActor, key: string): readonly string[] | null {
  const holdings = actor.scopedHeld as readonly ScopedHolding[] | undefined;
  const scoped = admittedScopeValues(holdings, key, "operatingCompany");
  const flat = actor.capabilities.has(key);
  if (!flat && scoped.length === 0) return null;
  const assigned = flat ? admittedScopeValues(holdings, FINANCE_COMPANY_ASSIGNMENT_KEY, "operatingCompany") : [];
  return Object.freeze([...new Set([...scoped, ...assigned])].sort());
}

export type FinanceScopeDecision =
  | { readonly ok: true; readonly consolidated: boolean; readonly companies: readonly string[] }
  | { readonly ok: false; readonly code: "CAPABILITY_REQUIRED" | "OUTSIDE_OPERATING_COMPANY_SCOPE" };

const isConsolidated = (raw: unknown): boolean => raw === undefined || raw === null || (typeof raw === "string" && raw.toLowerCase() === "consolidated");

/**
 * Decide a requested scope (one company id, or consolidated / omitted) against the tenant's ACTIVE companies and the
 * actor's reach for `key`. Consolidated requires reach over every active company.
 */
export function decideFinanceScope(actor: FinanceReachActor, key: string, activeCompanies: readonly string[], raw: unknown): FinanceScopeDecision {
  const reach = financeCompanyReach(actor, key);
  if (reach === null) return { ok: false, code: "CAPABILITY_REQUIRED" };
  const reachable = activeCompanies.filter((c) => reach.includes(c));
  if (isConsolidated(raw)) {
    return activeCompanies.length > 0 && reachable.length === activeCompanies.length
      ? { ok: true, consolidated: true, companies: Object.freeze([...activeCompanies]) }
      : { ok: false, code: "OUTSIDE_OPERATING_COMPANY_SCOPE" };
  }
  return typeof raw === "string" && reachable.includes(raw)
    ? { ok: true, consolidated: false, companies: Object.freeze([raw]) }
    : { ok: false, code: "OUTSIDE_OPERATING_COMPANY_SCOPE" };
}

/** Whether `key` reaches `company` for this actor (a record's own company, for commands that name a record). */
export function financeReachesCompany(actor: FinanceReachActor, key: string, company: string): boolean {
  return (financeCompanyReach(actor, key) ?? []).includes(company);
}
