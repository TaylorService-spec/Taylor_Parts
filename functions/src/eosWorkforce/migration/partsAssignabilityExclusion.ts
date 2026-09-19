// APPROVED_LEGACY_UI_RESTRICTION_RETIREMENT -- what the retired `securityRole == technician` picker filter excluded.
//
// The Owner RULED on this predicate: it is retired, and NOT reproduced as a Security Role, Job Role, Work
// Eligibility or Operational Scope requirement. The ruling rests on repository evidence, not on counts -- the
// predicate was an advisory UI candidate filter that no assignment enforcement ever consulted, so retiring it is an
// intentional UI-narrowing retirement, NOT an accidental access widening.
//
// This module therefore no longer gates anything. It remains because the population it measures is still useful
// MIGRATION EVIDENCE -- who the picker used to hide, and what they hold under the governed authorities -- and that
// evidence is worth collecting when operator access exists. It is evidence only, never runtime authority.
//
// Pure: no database, no external service, no I/O, no clock. Both sides arrive as gathered facts.
//
// ════════════════════ THE CONFLICT ════════════════════
//
// The legacy assignable-Employee path is TWO predicates in two places:
//
//   the stored query    employmentStatus == ACTIVE, operationalRoles contains PARTS_ASSOCIATE, userId != null
//   the client hook     AND securityRole is a valid role AND securityRole != TECHNICIAN
//
// Step G's governed read replaces the first. The second has NO governed equivalent and must not gain one: making a
// Security Role a requirement for Work Eligibility is exactly the conflation the operationalRoles decomposition
// exists to remove. But silently dropping it would WIDEN who appears as assignable, which a migration may not do.
//
// The second is RETIRED by ruling. It is not ported, and its removal is deliberate rather than silent.
//
// ════════════════════ THE EVIDENCE THE RULING RESTS ON ════════════════════
//
// The exclusion was ADVISORY UI FILTERING, not an enforced authority boundary:
//
//   * the Rules' Assign arm validates only that `assignedToUserId` is a non-empty string -- it checks no
//     securityRole, no operationalRoles, no employment status and no link;
//   * no server command validates an assignee's eligibility at all; `assignedToUserId` appears in the reorder
//     callable only as a null initializer at creation.
//
// So nothing REFUSED an assignment to a technician-role Employee. The filter shaped what a manager was offered, not
// what the system permitted -- which is why retiring it changes no enforced access. Both facts stay asserted below,
// so a later change that makes the exclusion load-bearing cannot pass unnoticed as though the ruling still covered it.
//
// A second tension the report surfaces: the `technician` compatibility Role HOLDS all seven Parts-Associate reorder
// capabilities, conditioned on operationalRoleActive(PARTS_ASSOCIATE). A technician-role Employee carrying that
// operational role can therefore PERFORM the work while the picker refuses to OFFER it to them.
//
// ════════════════════ WHAT THIS MODULE IS NOT ════════════════════
//
// It decides nothing, migrates nothing and converts nothing, and it is NOT a cutover gate: the Parts/Warehouse
// client conversion proceeds on the ruling, not on these numbers. It does not recreate Security Role as Work
// Eligibility -- the governed Security Roles it reports are evidence, never an input to any eligibility rule.
//
// EXACT NONPROD COUNTS REMAIN `NOT_MEASURED_OPERATOR_BLOCKED`. The legacy securityRole and operationalRoles live
// only in the Firestore export, so the population cannot be measured without operator access. That is a gap in
// evidence, not a gap in the decision.
import type { EmployeeProfileSnapshot } from "./employeeProfileSnapshot";

/** The legacy value the picker filters on. Named once; never used as an eligibility input. */
export const LEGACY_ASSIGNABLE_OPERATIONAL_ROLE = "PARTS_ASSOCIATE";
/** The legacy Security Role the retired client filter excluded. Reported, never required. */
export const LEGACY_EXCLUDED_SECURITY_ROLE = "technician";

/** The Owner's disposition of that predicate. Retired deliberately; never reproduced in any governed authority. */
export const TECHNICIAN_PREDICATE_DISPOSITION = "APPROVED_LEGACY_UI_RESTRICTION_RETIREMENT";
/** The state of the live population measurement. Useful evidence to collect later; NOT a cutover gate. */
export const TECHNICIAN_PREDICATE_MEASUREMENT_STATE = "NOT_MEASURED_OPERATOR_BLOCKED";

export const EXCLUSION_DISPOSITIONS = Object.freeze([
  /** Satisfies the stored query AND passes the client filter: assignable today, and assignable after cutover. */
  "INCLUDED_TODAY",
  /** Satisfies the stored query but the client hook excludes it for securityRole == technician. THE POPULATION. */
  "EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE",
  /** Satisfies the stored query but securityRole is missing or outside the role vocabulary: the warning case. */
  "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE",
] as const);
export type ExclusionDisposition = (typeof EXCLUSION_DISPOSITIONS)[number];

/** Governed facts about one Employee, read from PostgreSQL. Evidence for the ruling, never an eligibility input. */
export interface GovernedEmployeeFacts {
  /** Security Role keys held through the Employee's ACTIVE Principal link. Empty when none, or when unlinked. */
  readonly securityRoleKeys: readonly string[];
  /** The Employee's current Job Role display name, or null when they hold none. */
  readonly jobRole: string | null;
  /** True when the governed authorities already know this Employee. */
  readonly knownToPostgres: boolean;
}

export interface ExcludedEmployee {
  readonly employeeId: string;
  readonly disposition: ExclusionDisposition;
  /** Exactly what the legacy record says, including a missing or malformed value, reported verbatim. */
  readonly legacySecurityRole: string | null;
  readonly governedSecurityRoleKeys: readonly string[];
  readonly governedJobRole: string | null;
  readonly knownToPostgres: boolean;
}

export interface PartsAssignabilityExclusionReport {
  readonly exportedAt: string;
  /** Employees satisfying the STORED legacy query: ACTIVE + PARTS_ASSOCIATE + a linked user. */
  readonly satisfyingStoredQuery: number;
  readonly counts: Readonly<Record<ExclusionDisposition, number>>;
  /** Every Employee the client filter removes, with the governed facts the ruling needs. Sorted, deterministic. */
  readonly excluded: readonly ExcludedEmployee[];
  /**
   * Always false, and stated rather than implied: nothing REFUSES an assignment to these Employees today. The Rules'
   * Assign arm checks only that an assignee id is present, and no server command validates assignee eligibility.
   */
  readonly enforcedByAnyServerAuthority: false;
}

const zeroed = () => Object.fromEntries(EXCLUSION_DISPOSITIONS.map((d) => [d, 0])) as Record<ExclusionDisposition, number>;

/**
 * Partition the legacy assignable population by what the client filter does to it.
 *
 * `validSecurityRoles` is the client's own role vocabulary, passed in rather than imported, so the report measures
 * the rule the application actually applies instead of a second copy of it that could drift.
 */
export function reportPartsAssignabilityExclusion(
  snapshot: EmployeeProfileSnapshot,
  governed: ReadonlyMap<string, GovernedEmployeeFacts>,
  validSecurityRoles: readonly string[],
): PartsAssignabilityExclusionReport {
  const valid = new Set(validSecurityRoles);
  const counts = zeroed();
  const excluded: ExcludedEmployee[] = [];
  let satisfyingStoredQuery = 0;

  for (const doc of snapshot.employees) {
    const data = doc.data;
    const roles = Array.isArray(data.operationalRoles) ? data.operationalRoles : [];
    // The STORED query, reproduced exactly: all three clauses, none of them optional.
    const satisfiesStored = data.employmentStatus === "ACTIVE"
      && roles.includes(LEGACY_ASSIGNABLE_OPERATIONAL_ROLE)
      && data.userId !== undefined && data.userId !== null && data.userId !== "";
    if (!satisfiesStored) continue;
    satisfyingStoredQuery += 1;

    const legacySecurityRole = typeof data.securityRole === "string" ? data.securityRole : null;
    const disposition: ExclusionDisposition = legacySecurityRole === null || !valid.has(legacySecurityRole)
      ? "EXCLUDED_BY_UNVERIFIED_SECURITY_ROLE"
      : legacySecurityRole === LEGACY_EXCLUDED_SECURITY_ROLE
        ? "EXCLUDED_BY_TECHNICIAN_SECURITY_ROLE"
        : "INCLUDED_TODAY";
    counts[disposition] += 1;
    if (disposition === "INCLUDED_TODAY") continue;

    const facts = governed.get(doc.id);
    excluded.push({
      employeeId: doc.id,
      disposition,
      legacySecurityRole,
      governedSecurityRoleKeys: [...(facts?.securityRoleKeys ?? [])].sort(),
      governedJobRole: facts?.jobRole ?? null,
      knownToPostgres: facts?.knownToPostgres ?? false,
    });
  }

  excluded.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  return Object.freeze({
    exportedAt: snapshot.source.exportedAt,
    satisfyingStoredQuery,
    counts: Object.freeze(counts),
    excluded: Object.freeze(excluded),
    enforcedByAnyServerAuthority: false,
  });
}
