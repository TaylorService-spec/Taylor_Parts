// PARTS_OPERATIONS IDENTITY RECONCILIATION -- who, exactly, are the legacy PARTS_ASSOCIATE holders,
// and is there a governed Employee that provably IS each of them?
//
// Pure: no Firebase, no database, no I/O, no clock. Holders and the governed resolution view are
// INPUTS, measured by the caller; this module classifies them and nothing else.
//
// ════════════════════ WHY THIS EXISTS SEPARATELY ════════════════════
//
// `legacyWorkforceEvidence.ts` answers "which legacy operationalRoles VALUES have a ruled target
// code?" -- a question about vocabulary. It deliberately resolves an Employee with one test, the
// governed id, because that is all a vocabulary census needs.
//
// WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER is a different question, about IDENTITY: the target
// code is settled (PARTS_OPERATIONS, migration 1761696000000), and what is unproven is whether any
// particular human behind a legacy record exists in the governed workforce. "The id did not match"
// is not an answer to that -- two stores can hold the same person under two ids. So this module
// looks at every deterministic signal, and names which one carried a match.
//
// ════════════════════ IT ASSIGNS NOTHING ════════════════════
//
// There is no apply path here, in its caller, or in any migration this module informs. The output
// is a CLASSIFICATION plus, for EXACT_MATCH holders only, the governed command that WOULD be
// issued. `applied` is permanently false so a report can never be misread as a completed migration.
//
// ════════════════════ WHAT MAY AND MAY NOT PROVE AN IDENTITY ════════════════════
//
// ADMISSIBLE (each names one immutable, externally-assigned identifier):
//
//   GOVERNED_EMPLOYEE_ID     the legacy employee id IS a governed Employee id in this tenant
//   PRINCIPAL_LINK           an active employee_principal_link already binds this legacy id
//   FEDERATED_SUBJECT        the legacy account's external subject IS a governed Principal's, and
//                            that Principal is linked to exactly one governed Employee
//   EMPLOYEE_NUMBER          an exact governed employee_number
//   WORK_EMAIL               an exact governed work_email at a real, routable domain
//
// INADMISSIBLE, BY OWNER RULING (RULED_OUT_SIGNALS below). Display name, Job Role, job title,
// Security Role, operational role, warehouse, operating company and manager prove NOTHING about
// identity. Each describes what somebody DOES; none of them is who somebody IS, and two different
// people routinely share every one of them. A "Parts Associate" in one store and a "Parts
// Associate" in another are not thereby the same person, and matching them would invent a human.
//
// ════════════════════ A FIXTURE IS NEVER PROMOTED ════════════════════
//
// NONBUSINESS_FIXTURE is tested FIRST and short-circuits every other signal, including an otherwise
// admissible one. Non-production worlds are built by generators that reuse ids, numbers and reserved
// domains on purpose, so a signal that coincides there is a collision, not a discovery. Granting a
// synthetic identity real Work Eligibility would put a fixture into the business authority, and a
// later real migration would then have to prove which rows were never people.
import type { WorkEligibilityCode } from "../workEligibilityVocabulary";

/** The qualification this reconciliation exists to preserve. One code, named once. */
export const RECONCILED_QUALIFICATION: WorkEligibilityCode = "PARTS_OPERATIONS";

/** The legacy `operationalRoles` value whose gate PARTS_OPERATIONS governs. */
export const RECONCILED_LEGACY_VALUE = "PARTS_ASSOCIATE";

/**
 * Reserved top-level domains (RFC 2606 / RFC 6761). An address here can never route and can never
 * collide with a real person, so it is positive proof of a fixture rather than weak evidence.
 */
export const RESERVED_EMAIL_TLDS: ReadonlySet<string> =
  Object.freeze(new Set(["invalid", "test", "example", "localhost"]));

/** Signals that describe what somebody DOES. None may ever resolve an identity. */
export const RULED_OUT_SIGNALS: readonly string[] = Object.freeze([
  "displayName", "firstName", "lastName", "jobTitle", "jobRole", "securityRole",
  "operationalRoles", "assignedWarehouseIds", "operatingCompanyId", "managerEmployeeId",
]);

export const IDENTITY_SIGNALS = Object.freeze([
  "GOVERNED_EMPLOYEE_ID", "PRINCIPAL_LINK", "FEDERATED_SUBJECT", "EMPLOYEE_NUMBER", "WORK_EMAIL",
] as const);
export type IdentitySignal = (typeof IDENTITY_SIGNALS)[number];

export const HOLDER_CLASSIFICATIONS = Object.freeze([
  /** Exactly one governed Employee, proven by at least one admissible signal. */
  "EXACT_MATCH",
  /** Admissible signals resolve, but to more than one governed Employee, or they disagree. */
  "AMBIGUOUS",
  /** Every admissible signal was checked and none resolves to any governed Employee. */
  "NO_TARGET_EMPLOYEE",
  /** The legacy identity is provably not a person: a generator fixture or a reserved-domain persona. */
  "NONBUSINESS_FIXTURE",
  /** A real legacy identity that is no longer active, so there is no current eligibility to preserve. */
  "INACTIVE_LEGACY_IDENTITY",
] as const);
export type HolderClassification = (typeof HOLDER_CLASSIFICATIONS)[number];

/**
 * One legacy holder, as measured from its source world. Every field is evidence the caller READ;
 * this module never infers one from another.
 */
export interface LegacyEligibilityHolder {
  /** The legacy record id (a Firestore `employees` document id). */
  readonly legacyEmployeeId: string;
  /** Which world the record was measured in, for the report. Never used to classify. */
  readonly sourceWorld: string;
  /**
   * The generator/provenance marker the source world stamps on synthetic records, when it has one.
   * Any value beginning `SYNTHETIC` is positive proof of a fixture.
   */
  readonly dataProvenance?: string | null;
  /** The legacy account's external subject (a Firebase uid), when the record carries one. */
  readonly externalSubject?: string | null;
  readonly employeeNumber?: string | null;
  readonly workEmail?: string | null;
  /** The legacy record's own status. A record that is not active has no current eligibility. */
  readonly active?: boolean;
  readonly employmentStatus?: string | null;
}

/** What the governed PostgreSQL workforce currently holds. Read-only; never written by this module. */
export interface GovernedWorkforceView {
  readonly tenantId: string;
  /** Governed Employee ids in this tenant. */
  readonly employees: ReadonlySet<string>;
  /** employee_id for every ACTIVE employee_principal_link in this tenant. */
  readonly linkedEmployeeIds: ReadonlySet<string>;
  /** external_subject -> the governed Employee it resolves to through an ACTIVE link. */
  readonly employeeByExternalSubject: ReadonlyMap<string, string>;
  /** employee_number -> governed Employee id. */
  readonly employeeByNumber: ReadonlyMap<string, string>;
  /** work_email (lowercased) -> governed Employee id. */
  readonly employeeByWorkEmail: ReadonlyMap<string, string>;
  /** `${employeeId}|${qualificationCode}` for every CURRENT qualification in this tenant. */
  readonly currentQualifications: ReadonlySet<string>;
}

export interface MatchedSignal {
  readonly signal: IdentitySignal;
  readonly governedEmployeeId: string;
}

export interface HolderReconciliation {
  readonly legacyEmployeeId: string;
  readonly sourceWorld: string;
  readonly classification: HolderClassification;
  /** Every admissible signal that resolved, in IDENTITY_SIGNALS order. Empty unless one did. */
  readonly matchedSignals: readonly MatchedSignal[];
  /** Set only for EXACT_MATCH. Null in every other classification, including AMBIGUOUS. */
  readonly governedEmployeeId: string | null;
  /** Why this classification, in terms a reader can check against the evidence. */
  readonly reason: string;
}

/** A governed command that WOULD be issued for an EXACT_MATCH holder. Nothing here issues it. */
export interface PlannedEligibility {
  readonly operation: "assignEmployeeWorkEligibility";
  readonly input: {
    readonly employeeId: string;
    readonly qualificationCode: WorkEligibilityCode;
    readonly reason: string;
  };
}

export interface PartsOperationsReconciliation {
  readonly tenantId: string;
  readonly qualification: WorkEligibilityCode;
  readonly legacyValue: string;
  readonly holders: readonly HolderReconciliation[];
  readonly counts: Readonly<Record<HolderClassification, number>>;
  /** Holders a person must rule on: everything that is not an EXACT_MATCH. */
  readonly unmapped: readonly HolderReconciliation[];
  /** One entry per EXACT_MATCH holder that does not already hold the qualification. */
  readonly plan: readonly PlannedEligibility[];
  /**
   * True only when EVERY holder reconciled to a governed Employee. It is the precondition for
   * preserving the eligibility, for granting the withheld Purchase Order cells, and for retiring
   * the `operationalRoleActive` gate -- and it is a MEASUREMENT, never an assertion.
   */
  readonly reconciled: boolean;
  /** Always false. There is no apply path; the field exists so this cannot be misread as applied. */
  readonly applied: false;
}

const PLAN_REASON =
  "legacy PARTS_ASSOCIATE gate preservation (identity proven by an admissible immutable signal)";

const emailDomainTld = (email: string): string | null => {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const dot = email.lastIndexOf(".");
  return dot > at && dot < email.length - 1 ? email.slice(dot + 1).toLowerCase() : null;
};

/**
 * Is this legacy record provably not a person?
 *
 * Two independent proofs, either of which is sufficient, and both are positive evidence rather than
 * an absence: a generator provenance stamp, and an address at a domain reserved so that it cannot
 * exist. Neither is a judgement about what the record "looks like".
 */
export function isNonBusinessFixture(holder: LegacyEligibilityHolder): boolean {
  if (typeof holder.dataProvenance === "string" && holder.dataProvenance.startsWith("SYNTHETIC")) return true;
  const tld = typeof holder.workEmail === "string" ? emailDomainTld(holder.workEmail) : null;
  return tld !== null && RESERVED_EMAIL_TLDS.has(tld);
}

/** Every admissible signal that resolves, in declaration order. Inadmissible signals are not read. */
function resolveSignals(
  holder: LegacyEligibilityHolder, view: GovernedWorkforceView,
): MatchedSignal[] {
  const out: MatchedSignal[] = [];
  const push = (signal: IdentitySignal, governedEmployeeId: string | undefined | null) => {
    if (typeof governedEmployeeId === "string" && governedEmployeeId !== "") {
      out.push(Object.freeze({ signal, governedEmployeeId }));
    }
  };
  if (view.employees.has(holder.legacyEmployeeId)) push("GOVERNED_EMPLOYEE_ID", holder.legacyEmployeeId);
  if (view.linkedEmployeeIds.has(holder.legacyEmployeeId)) push("PRINCIPAL_LINK", holder.legacyEmployeeId);
  if (holder.externalSubject) push("FEDERATED_SUBJECT", view.employeeByExternalSubject.get(holder.externalSubject));
  if (holder.employeeNumber) push("EMPLOYEE_NUMBER", view.employeeByNumber.get(holder.employeeNumber));
  // A reserved-domain address never reaches this point: such a holder is already a fixture. The
  // lowercase fold is the only normalization -- an address that differs by anything else is a
  // different address, and "close enough" is how a migration mails somebody else's payroll.
  if (holder.workEmail) push("WORK_EMAIL", view.employeeByWorkEmail.get(holder.workEmail.toLowerCase()));
  return out;
}

/** Classify ONE legacy holder against the governed workforce. */
export function reconcileHolder(
  holder: LegacyEligibilityHolder, view: GovernedWorkforceView,
): HolderReconciliation {
  const base = { legacyEmployeeId: holder.legacyEmployeeId, sourceWorld: holder.sourceWorld };

  // FIRST, and short-circuiting: a fixture is never promoted, whatever else it happens to match.
  if (isNonBusinessFixture(holder)) {
    return Object.freeze({
      ...base, classification: "NONBUSINESS_FIXTURE" as const, matchedSignals: Object.freeze([]),
      governedEmployeeId: null,
      reason: "the legacy record carries a generator provenance stamp or a reserved-domain address, "
        + "so it is not a person and must never receive business Work Eligibility",
    });
  }

  // A legacy identity that is not currently active conveys no CURRENT eligibility, so there is
  // nothing to preserve and no reason to resolve it against the governed workforce.
  if (holder.active === false || (holder.employmentStatus != null && holder.employmentStatus !== "ACTIVE")) {
    return Object.freeze({
      ...base, classification: "INACTIVE_LEGACY_IDENTITY" as const, matchedSignals: Object.freeze([]),
      governedEmployeeId: null,
      reason: "the legacy record is not active, so it holds no current eligibility to preserve",
    });
  }

  const matchedSignals = resolveSignals(holder, view);
  if (matchedSignals.length === 0) {
    return Object.freeze({
      ...base, classification: "NO_TARGET_EMPLOYEE" as const, matchedSignals: Object.freeze([]),
      governedEmployeeId: null,
      reason: `no admissible identity signal (${IDENTITY_SIGNALS.join(", ")}) resolves this legacy `
        + "record to any governed Employee in this tenant",
    });
  }

  const targets = [...new Set(matchedSignals.map((m) => m.governedEmployeeId))];
  if (targets.length > 1) {
    return Object.freeze({
      ...base, classification: "AMBIGUOUS" as const, matchedSignals: Object.freeze(matchedSignals),
      governedEmployeeId: null,
      reason: `admissible signals disagree: they resolve to ${targets.length} different governed `
        + `Employees (${targets.join(", ")}), so no single identity is proven`,
    });
  }

  return Object.freeze({
    ...base, classification: "EXACT_MATCH" as const, matchedSignals: Object.freeze(matchedSignals),
    governedEmployeeId: targets[0],
    reason: `proven by ${matchedSignals.map((m) => m.signal).join(" + ")}`,
  });
}

/**
 * Reconcile every legacy PARTS_ASSOCIATE holder against the governed workforce.
 *
 * Deterministic and order-independent: holders are sorted by legacy id, so two runs over the same
 * evidence produce identical output and a diff between runs is a real change in the evidence.
 */
export function reconcilePartsOperationsHolders(
  holders: readonly LegacyEligibilityHolder[], view: GovernedWorkforceView,
): PartsOperationsReconciliation {
  const sorted = [...holders].sort((a, b) => (a.legacyEmployeeId < b.legacyEmployeeId ? -1 : a.legacyEmployeeId > b.legacyEmployeeId ? 1 : 0));
  const reconciliations = sorted.map((h) => reconcileHolder(h, view));

  const counts = Object.fromEntries(HOLDER_CLASSIFICATIONS.map((c) => [c, 0])) as Record<HolderClassification, number>;
  for (const r of reconciliations) counts[r.classification] += 1;

  const plan: PlannedEligibility[] = [];
  for (const r of reconciliations) {
    if (r.classification !== "EXACT_MATCH" || r.governedEmployeeId === null) continue;
    // Already current is reported by the classification and deliberately NOT planned: the governed
    // command would only answer NO_CHANGE, and a plan full of no-ops hides the real work.
    if (view.currentQualifications.has(`${r.governedEmployeeId}|${RECONCILED_QUALIFICATION}`)) continue;
    plan.push(Object.freeze({
      operation: "assignEmployeeWorkEligibility" as const,
      input: Object.freeze({
        employeeId: r.governedEmployeeId, qualificationCode: RECONCILED_QUALIFICATION, reason: PLAN_REASON,
      }),
    }));
  }

  return Object.freeze({
    tenantId: view.tenantId,
    qualification: RECONCILED_QUALIFICATION,
    legacyValue: RECONCILED_LEGACY_VALUE,
    holders: Object.freeze(reconciliations),
    counts: Object.freeze(counts),
    unmapped: Object.freeze(reconciliations.filter((r) => r.classification !== "EXACT_MATCH")),
    plan: Object.freeze(plan),
    reconciled: reconciliations.length > 0 && reconciliations.every((r) => r.classification === "EXACT_MATCH"),
    applied: false,
  });
}
