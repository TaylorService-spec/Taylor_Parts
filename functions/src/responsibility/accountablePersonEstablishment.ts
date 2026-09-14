// THE CREATION RULE — establishing the INITIAL accountable person on a new commercial record.
//
// ════════════════════ THE RULE, VERBATIM ════════════════════
//
// Owner ruling #181 (`MI-N`), the canonical creation rule for all three admitted families:
//
//     EXPLICIT VALID ACCOUNTABLE PERSON
//       → GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER
//       → REFUSE
//
// And, in the same ruling: "At creation EOS **may** derive the **initial** accountable person from
// the governed commercial record owner when no explicit governed accountable person is supplied.
// **This is initialization / defaulting. It is NOT permanent equivalence.**"
//
// ════════════════════ WHY THIS IS NOT IN THE PURE BUILDERS ════════════════════
//
// Because the word VALID is load-bearing and cannot be evaluated purely. #182 §5 says so in those
// terms: "The word VALID is load-bearing. It may not be implemented using today's shape-only USER
// resolution." Establishing an accountable person therefore requires an authoritative Employee
// lookup, and #184 (`OD-7`, option (e)) rules where that belongs:
//
//     "Governed orchestration / command boundary — THE AUTHORITATIVE HANDOFF BOUNDARY: authoritative
//      fact resolution, caller authorization, Layer-1/eligibility verification, atomicity."
//     "Pure family/axis builder — RETAINED: pure business validation, no I/O."
//
// So this module does A (authoritative fact resolution) and the eligibility half of B, and hands the
// pure builders a value that is already governed. The builders keep their no-I/O property, and they
// gain no Employee lookup of their own — #184: "Do NOT duplicate authoritative Employee/person
// lookups inside the writer."
//
// ════════════════════ WHY THE PRECEDENT COULD NOT BE REUSED AS-IS ════════════════════
//
// `resolveCreationOwner` (`functions/src/ownership/creationOwnerResolution.ts`) is the same
// EXPLICIT → INHERITED → REFUSE shape and #181 names it as the shipped precedent. It also names why
// it is not enough:
//
//     "That guard is, however, vacuous on the person axis at 64008d5a... `RESOLVED` for a person
//      owner is produced without ever reading the Employee document, so a rule of this shape
//      implemented on today's resolver would inherit an initial accountable person from a terminated,
//      deactivated or non-existent employee and report it as governed. The pattern is right; the
//      predicate it depends on is not yet trustworthy."
//
// This module is the same pattern over a trustworthy predicate: the Wave-2A Employee authority port.
// `resolveCreationOwner` is deliberately NOT called here and NOT changed — it answers the OWNERSHIP
// question, and #182 §1 is explicit that "ACCOUNTABLE PERSON and RECORD OWNER are independently
// validated references. One person's validation is never validation for another person fact."
//
// ════════════════════ AN EXPLICIT INVALID PERSON DOES NOT FALL THROUGH ════════════════════
//
// The ladder's first rung is "EXPLICIT **VALID** ACCOUNTABLE PERSON", and the natural misreading is
// that an explicit id which fails validation drops to the derivation rung. It must not, and the
// reason is a business one rather than a textual one: falling through would silently make somebody
// ELSE accountable for the record than the person the command named, and report success. A caller who
// named the wrong person needs to be told, not quietly overruled. So an explicit id that does not
// resolve, or resolves to a person who is not currently eligible, REFUSES — with its own code, so the
// refusal says which rung failed.
//
// ════════════════════ INITIALIZATION ONLY, AND THE SIGNATURE IS THE PROOF ════════════════════
//
// #181: "Never permanently compute `accountable = owner` after creation. Owner and accountable remain
// independently mutable." This function takes NO record id, NO current accountable person, and NO
// previous value. It is structurally incapable of describing a change to an existing record, so it
// cannot be repurposed into one — the governed CHANGE path is
// `stageGovernedResponsibilityHandoff`'s ACCOUNTABILITY axis
// (`functions/src/responsibility/governedResponsibilityHandoff.ts`), which reads the authoritative
// previous value, requires caller authorization, and stages an audit record. Nothing here does any of
// those, because nothing here is allowed to.
//
// ════════════════════ NO FALLBACK, ANYWHERE ════════════════════
//
// #187 §2: `AUTHORITY_UNAVAILABLE` "must FAIL CLOSED. It must not be interpreted as person missing or
// person invalid, must not be represented as healthy empty data, and must not fall back silently to
// Firestore, to `users`, to `fieldops_technicians`, or to Firebase UID coincidence."
//
// It has its own refusal code here, distinct from both invalid-reference codes, and there is no
// parameter on any type in this file that could express a fallback store. The only way in is the
// injected `EmployeeAuthority` port, and the port has exactly one method.

import {
  EmployeeAuthorityFailure,
  decideAccountabilityEligibility,
  mustResolveEmployeeReference,
  type AccountabilityEligibilityPolicy,
  type EmployeeAuthority,
  type EmployeeFacts,
} from "../employeeIdentity/employeeAuthority";
import { accountabilityFamilyScope } from "./accountabilityFamilyScope";
import {
  mintGovernedAccountablePerson,
  type AccountablePersonSource,
  type EstablishedAccountablePerson,
} from "./accountablePersonStorage";

/** The ports establishing an accountable person needs. ONE, and it is the authority. */
export interface AccountablePersonEstablishmentDeps {
  readonly employeeAuthority: EmployeeAuthority;
}

/**
 * What a creation path asks for.
 *
 * `currentRecordOwnerEmployeeId` is the CURRENT governed commercial record owner of the record being
 * created — for an Opportunity the resolved creation owner, for a downstream record the resolved
 * owner of that record. It is passed IN, read by the caller inside its own transaction, for the same
 * reason `resolveCreationOwner` takes the upstream derivation as an argument: a value read here could
 * drift between the read and the write.
 */
export interface CreationAccountablePersonRequest {
  readonly tenantId: string;
  /** The family key, as `ownershipMatrix` and `accountabilityFamilyScope` name it. */
  readonly family: string;
  /** Rung 1. Absent, empty or non-string falls through to rung 2 — it is not an error on its own. */
  readonly explicitAccountableEmployeeId?: string | null;
  /** Rung 2. The CURRENT governed commercial record owner. Never the actor, never `createdBy`. */
  readonly currentRecordOwnerEmployeeId?: string | null;
  /** REQUIRED. #189 `MI-ε`: the gate consumes a governed policy and must never assume one. */
  readonly eligibilityPolicy: AccountabilityEligibilityPolicy;
}

/** Every way establishment refuses. Distinct codes, because they are distinct facts. */
export type CreationAccountablePersonRefusalCode =
  /** The family carries no governed accountability (#189 `OD-16`). NOT a record defect. */
  | "FAMILY_NOT_ACCOUNTABLE"
  /** The request's own shape is unusable — no tenant, no family. */
  | "REQUEST_INVALID"
  /** No governed eligibility policy was supplied, or it states no author. #189 `MI-ε`. */
  | "ELIGIBILITY_POLICY_REQUIRED"
  /** Rung 1: the EXPLICIT person does not resolve to a governed Employee. #182 state C. */
  | "EXPLICIT_PERSON_INVALID"
  /** Rung 1: the EXPLICIT person is a valid reference but not currently eligible. #189 `MI-ε`. */
  | "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE"
  /** Rung 2: the record owner does not resolve to a governed Employee. */
  | "DERIVED_PERSON_INVALID"
  /** Rung 2: the record owner is valid but not currently eligible to BE accountable. #182 §5. */
  | "DERIVED_PERSON_NOT_CURRENTLY_ELIGIBLE"
  /** Rung 3: no explicit person and no derivable current record owner. The ruling's REFUSE. */
  | "NO_ACCOUNTABLE_PERSON_RESOLVED"
  /** EOS could not obtain an authoritative Employee answer. #187 §2. FAIL CLOSED. */
  | "AUTHORITY_UNAVAILABLE";

export class CreationAccountablePersonError extends Error {
  constructor(
    readonly code: CreationAccountablePersonRefusalCode,
    message: string,
    /** The Employee authority's own failure code, unchanged, when it is what refused. */
    readonly authorityCode?: string,
  ) {
    super(message);
    this.name = "CreationAccountablePersonError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function refuse(
  code: CreationAccountablePersonRefusalCode,
  message: string,
  authorityCode?: string,
): never {
  throw new CreationAccountablePersonError(code, message, authorityCode);
}

/**
 * Resolve one candidate through the authority, mapping its fail-closed failures onto this rung's
 * codes. `AUTHORITY_UNAVAILABLE` keeps ONE code on both rungs, because an outage is not a fact about
 * which rung was being tried.
 */
async function resolveCandidate(
  authority: EmployeeAuthority,
  tenantId: string,
  employeeId: string,
  rung: "EXPLICIT" | "DERIVED",
): Promise<EmployeeFacts> {
  try {
    return await mustResolveEmployeeReference(authority, { tenantId, employeeId });
  } catch (err) {
    if (err instanceof EmployeeAuthorityFailure) {
      if (err.code === "EMPLOYEE_AUTHORITY_UNAVAILABLE") {
        refuse("AUTHORITY_UNAVAILABLE", err.message, err.code);
      }
      refuse(
        rung === "EXPLICIT" ? "EXPLICIT_PERSON_INVALID" : "DERIVED_PERSON_INVALID",
        err.message,
        err.code,
      );
    }
    // An authority that threw something else did not give an authoritative answer either, and #187
    // §2 forbids reading that as a verdict about the person.
    refuse(
      "AUTHORITY_UNAVAILABLE",
      `the Employee authority threw a non-governed error for ${employeeId} in tenant ${tenantId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * THE CREATION RULE. Returns a governed establishment, or refuses having established nothing.
 *
 * Order matters and is the ruling's order: family applicability, then request shape, then policy,
 * then rung 1, then rung 2, then REFUSE. Family first because #189 `OD-16` makes applicability a
 * property of the FAMILY, and asking the Employee authority about a person for a family that carries
 * no accountability would be work done to reach a refusal that was already decided.
 */
export async function establishCreationAccountablePerson(
  deps: AccountablePersonEstablishmentDeps,
  request: CreationAccountablePersonRequest,
): Promise<EstablishedAccountablePerson> {
  if (!request || typeof request !== "object") {
    refuse("REQUEST_INVALID", "missing establishment request");
  }
  if (accountabilityFamilyScope(request.family) !== "IN_SCOPE") {
    refuse(
      "FAMILY_NOT_ACCOUNTABLE",
      `${String(request.family)} is outside the governed accountability scope, so accountability is ` +
        "NOT APPLICABLE to it — not MISSING, not OWNERLESS, not DEFECTIVE (#189 OD-16). Establishing " +
        "an accountable person on it would be the fake personal accountability the ruling forbids.",
    );
  }
  if (!nonEmpty(request.tenantId)) {
    refuse(
      "REQUEST_INVALID",
      "tenantId is required: an Employee is tenant-scoped, and a lookup by bare id could resolve one " +
        "tenant's reference against another tenant's Employee",
    );
  }
  if (!deps || !deps.employeeAuthority) {
    // NOT a silent success and NOT an unvalidated establishment. #187 §2's fail-closed, at the seam.
    refuse(
      "AUTHORITY_UNAVAILABLE",
      "no Employee authority was supplied, so no authoritative answer about the proposed accountable " +
        "person could be obtained. This is NOT a finding that the person is missing or invalid, and " +
        "no other store may be consulted instead.",
    );
  }
  const policy = request.eligibilityPolicy;
  if (!policy || !nonEmpty(policy.policyId) || !Array.isArray(policy.eligibleStatuses)) {
    refuse(
      "ELIGIBILITY_POLICY_REQUIRED",
      "establishing an accountable person requires a governed eligibility policy stating its author " +
        "and the statuses it accepts. Assuming one would be the hidden boolean policy #189 MI-epsilon " +
        "forbids.",
    );
  }

  const attempt = async (
    employeeId: string,
    rung: "EXPLICIT" | "DERIVED",
    source: AccountablePersonSource,
  ): Promise<EstablishedAccountablePerson> => {
    const employee = await resolveCandidate(deps.employeeAuthority, request.tenantId, employeeId, rung);
    const eligibility = decideAccountabilityEligibility(employee, policy);
    if (!eligibility.eligible) {
      refuse(
        rung === "EXPLICIT"
          ? "EXPLICIT_PERSON_NOT_CURRENTLY_ELIGIBLE"
          : "DERIVED_PERSON_NOT_CURRENTLY_ELIGIBLE",
        `Employee ${employee.employeeId} is a VALID reference but is NOT CURRENTLY ELIGIBLE to ` +
          `receive accountability under governed policy ${policy.policyId} (lifecycle status ` +
          `${employee.employmentStatus}). ` +
          (rung === "DERIVED"
            ? "The record owner may remain the owner; #182 s5 forbids treating a structurally " +
              "resolved but ineligible person as suitable for NEW responsibility, so the derivation " +
              "is refused rather than substituted."
            : "The reference and any historical accountability remain valid (#186 s7); this new " +
              "accountability is refused (#189 MI-epsilon)."),
      );
    }
    // The mint re-checks the verdict and refuses a negative one. Belt and braces at the one place a
    // future edit here could otherwise let an ineligible person through.
    return mintGovernedAccountablePerson(employee, eligibility, source);
  };

  // ── RUNG 1 — EXPLICIT VALID ACCOUNTABLE PERSON ─────────────────────────────────────────────────
  if (nonEmpty(request.explicitAccountableEmployeeId)) {
    return attempt(request.explicitAccountableEmployeeId.trim(), "EXPLICIT", "EXPLICIT");
  }

  // ── RUNG 2 — GOVERNED DERIVATION FROM THE CURRENT COMMERCIAL RECORD OWNER ──────────────────────
  if (nonEmpty(request.currentRecordOwnerEmployeeId)) {
    return attempt(
      request.currentRecordOwnerEmployeeId.trim(),
      "DERIVED",
      "DERIVED_FROM_RECORD_OWNER",
    );
  }

  // ── RUNG 3 — REFUSE ────────────────────────────────────────────────────────────────────────────
  // The same discipline `creationOwnerResolution.ts` records for the ownership axis: "when nothing
  // resolves, this throws rather than picking someone". The forbidden picks are the same six, and
  // the actor is not among the inputs of this function at all.
  refuse(
    "NO_ACCOUNTABLE_PERSON_RESOLVED",
    `no accountable person: none was supplied for this ${request.family} and it has no current ` +
      "governed commercial record owner to derive one from. Accountability is never assigned to the " +
      "caller, the creator, an arbitrary employee, or an administrator (#181, #180 invariant 1).",
  );
}
