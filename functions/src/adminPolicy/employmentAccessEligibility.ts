// EMPLOYMENT ACCESS ELIGIBILITY -- the one rule, dependency-free (type-only imports), shared by principal resolution
// (principalContext.ts), the operator actor resolution (eosWorkforce/commands/employeeAdministrationAuthority.ts) and the
// predicate layer's Employee link (eosOps/contextualAuthorization.ts), so no two of them can disagree.
import type { LinkedEmployeeAccessFact } from "./policyRepository";

/**
 * ACCESS-ELIGIBLE EMPLOYMENT STATUSES -- Controller ruling DQ-007 (2026-09-28), under Owner workforce ruling 2
 * (2026-09-17: "PostgreSQL employment status is the single access-eligibility authority").
 *
 * ACTIVE and CONTRACTOR only. Every other status (ON_LEAVE, INACTIVE, TERMINATED, RETIRED, and any value added to the
 * enum later) is runtime-INELIGIBLE: the Principal resolves to NO context at all, so no capability, surface or
 * commercial write survives on the strength of a Role assignment that was never revoked. An explicit ALLOW list, so an
 * unknown future status fails closed. Work Eligibility and every other predicate may further restrict; nothing widens.
 */
export const ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES: readonly string[] = Object.freeze(["ACTIVE", "CONTRACTOR"]);

/**
 * THE ONE ELIGIBILITY RULE, shared by principal resolution and the operator actor resolution
 * (eosWorkforce/commands/employeeAdministrationAuthority.ts) so the two can never disagree.
 * Returns null when access is permitted (no active link, or an eligible status), else the refusal detail.
 */
export function employeeAccessIneligibility(fact: LinkedEmployeeAccessFact | null): string | null {
  if (!fact) return null;
  if (fact.ambiguous) return "the Principal's Employee link is ambiguous";
  if (fact.employmentStatus === null) return "the linked Employee does not resolve in this tenant";
  return ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES.includes(fact.employmentStatus) ? null : "the linked Employee is not access-eligible";
}
