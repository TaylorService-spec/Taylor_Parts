// EMPLOYEE AUTHORITY — the PORT. The permanent contract governed business commands speak.
//
// ════════════════════ WHAT THIS MODULE IS ════════════════════
//
// Owner ruling #185 (`MI-ι`) made the canonical Employee authority a PostgreSQL relation and required
// that the port in front of it "hide storage from governed business commands" so that a transitional
// implementation can be replaced "without changing `OD-7` orchestration semantics". This file is that
// contract: the reference type, the outcome vocabulary, and the pure decisions. It is the half that is
// meant to outlive every adapter.
//
// IT IMPORTS NOTHING. No `firebase-admin`, no `firebase-functions`, no `firebase/firestore`, no `pg`,
// no clock, no environment, no `node:` module. Every function here is pure and total. That is the same
// discipline employeePrincipalLink.ts holds beside it, and it is what makes the storage-hiding claim
// checkable rather than asserted — a contract that imported a driver would already have leaked one.
//
// ════════════════════ NO FIRESTORE CONCEPT APPEARS IN THIS CONTRACT ════════════════════
//
// Deliberately, and it is a permanence decision rather than a style one. There is no `DocumentSnapshot`,
// no `exists`, no `data()`, no `QuerySnapshot`, no Firestore error shape, and no `collection` anywhere
// in these types. #185 classifies Firestore `employees` as TRANSITIONAL business compatibility, so a
// contract phrased in its vocabulary would make the transitional store's shape the permanent interface
// — and the whole point of the port is that replacing the implementation is not an interface change.
//
// The specific word worth naming is `exists`. A Firestore-shaped resolver returns a snapshot whose
// `exists` is a boolean, and that boolean is precisely the collapse #182 refuses: "A PERSON reference
// is not valid merely because it is a non-empty string, has type `USER`, or parses." So this contract
// has no boolean for it. It has an OUTCOME, and the outcome carries the facts.
//
// ════════════════════ THREE SEPARATE FACTS, AND THE PORT NEVER COLLAPSES THEM ════════════════════
//
// #186 (`MI-S`) is binding and is the reason this file is shaped the way it is:
//
//     "REFERENCE VALIDITY · EMPLOYEE LIFECYCLE STATUS · CURRENT ACCOUNTABILITY ELIGIBILITY are three
//      separate facts... Do not encode `NOT ELIGIBLE` as `INVALID PERSON REFERENCE`. Do not encode
//      `VALID REFERENCE` as `CURRENTLY ELIGIBLE`."
//
// So they are three separate things here:
//
//   REFERENCE VALIDITY   → the resolution OUTCOME (`RESOLVED` vs `NOT_FOUND`)
//   LIFECYCLE STATUS     → `EmployeeFacts.employmentStatus`, one of the six governed values
//   ELIGIBILITY          → NOT RETURNED BY THE RESOLVER AT ALL. It is `decideAccountabilityEligibility`,
//                          a separate pure function that requires a GOVERNED POLICY argument.
//
// A `RESOLVED` outcome means the reference is valid. It says nothing about eligibility, and there is no
// field on it that could. A TERMINATED or RETIRED Employee resolves — #186 §1: "a FORMER / INACTIVE /
// TERMINATED employee may remain a VALID REFERENCE while separately being NOT CURRENTLY ELIGIBLE FOR
// NEW ACCOUNTABILITY" — and #186 §7 requires that, because invalidating the reference would rewrite
// the history #182 §2 protects.
//
// ════════════════════ WHY THERE IS NO DEFAULT ELIGIBILITY POLICY IN THIS FILE ════════════════════
//
// This is the single most load-bearing absence in the module, so it is argued rather than left as a
// gap. #189 (`MI-ε`) rules:
//
//     "Do NOT implement this as `status != ACTIVE → refuse` unless the governed eligibility policy for
//      that operation explicitly says so... The gate consumes the governed eligibility result and must
//      not flatten the six-value vocabulary into a hidden boolean policy."
//
// A default exported from here — `ELIGIBLE_STATUSES = ["ACTIVE"]`, say — WOULD BE that hidden boolean
// policy. Every caller that did not think about it would inherit `status !== "ACTIVE"`, and the ruling
// would be violated by the convenience rather than by anybody's decision. So
// `decideAccountabilityEligibility` takes the policy as a REQUIRED argument and this module exports no
// policy value of any kind. A caller with no governed policy cannot call it, which is the correct
// outcome: #182 §4 places those constraints "per family — do not invent them globally", and this wave
// rules on no family.
//
// The consumer that already gets this wrong is named by #186 §4:
// functions/src/access/operationalRoleContext.ts:123 reads all six governed values through one
// `!== "ACTIVE"` test. That is a CONSUMER defect, which is where the ruling says the policy belongs and
// where it must be fixed. This module does not change it and does not reproduce it.
//
// ════════════════════ AUTHORITY_UNAVAILABLE IS A THIRD OUTCOME, AND IT FAILS CLOSED ════════════════════
//
// #187 §2 rules it distinct from INVALID / MISSING, and the distinction is the difference between two
// sentences that are not the same sentence:
//
//   NOT_FOUND              the authoritative Employee system SUCCESSFULLY ANSWERED, and the reference
//                          does not validly resolve
//   AUTHORITY_UNAVAILABLE  EOS COULD NOT OBTAIN AN AUTHORITATIVE ANSWER — no authority configured,
//                          database unreachable, read failure, or the authority answering with
//                          something this contract does not recognise
//
// It "must FAIL CLOSED. It must not be interpreted as person missing or person invalid, must not be
// represented as healthy empty data, and must not fall back silently to Firestore, to `users`, to
// `fieldops_technicians`, or to Firebase UID coincidence. No silent fallback."
//
// Three mechanisms hold that here, none of which is a comment:
//
//   1. IT IS ITS OWN OUTCOME, not `NOT_FOUND` and not a thrown generic error. A caller that switches on
//      the outcome has to name it; a caller that forgets it fails the exhaustiveness check in
//      `assertExhaustive` at compile time.
//   2. `mustResolveEmployeeReference` THROWS for it, with its own error class and its own code — so the
//      fail-closed path is the default path for a caller that wants a resolved Employee, and the audit
//      record distinguishes "we could not ask" from "the answer was no".
//   3. THERE IS NO FALLBACK PARAMETER, anywhere. This contract offers no way to express "if the
//      authority is unavailable, use this instead", because an interface that could express it is an
//      interface somebody will eventually point at Firestore.
//
// ════════════════════ WHY THE EMPLOYMENT VOCABULARY IS MIRRORED HERE, NOT IMPORTED ════════════════════
//
// The same boundary employeeProfileCommands.ts itself crosses in prose. `EMPLOYMENT_STATUS_VALUES` lives
// at functions/src/access/employeeProfileCommands.ts:122-129, but that module's line 61 imports
// `firebase-admin/firestore` — so importing the constant would pull the Admin SDK into a contract whose
// whole claim is that it imports nothing and knows nothing about storage. The values are therefore
// mirrored below by literal.
//
// THE MIRROR IS GUARDED, not trusted. functions/test/employeeAuthorityPort.test.mjs asserts this list
// against the TypeScript export AND against its canonical home,
// field-ops-app-vite/src/domain/constants.js's `EMPLOYMENT_STATUS`, and
// functions/test/employeeBusinessAuthorityMigration.test.mjs asserts migration 019's SQL enum against
// the same source. So the vocabulary is stated in three places and cannot drift silently in any of them.
//
// ONE CORRECTION, because it changes which file a guard must point at. employeeProfileCommands.ts's own
// header (`:116-121`) claims functions/scripts/provisionEmployeeAccess.js mirrors the same closed set.
// It does not — that script holds only `EMPLOYMENT_STATUS_ACTIVE`. Ruling #186 §4 records the same
// finding and names the real canonical home, which is what the guards here use.

/**
 * The governed Employee lifecycle vocabulary — SIX values, and all six are real answers.
 *
 * Mirrored by literal from functions/src/access/employeeProfileCommands.ts:122-129, whose canonical home
 * is field-ops-app-vite/src/domain/constants.js's EMPLOYMENT_STATUS. Order is theirs.
 *
 * #186 §4: "Do NOT collapse every non-`ACTIVE` Employee into one generic historical state. At minimum
 * `INACTIVE` and `TERMINATED` must remain distinguishable." Nothing here groups them, ranks them, or
 * derives a boolean from them.
 */
export const EMPLOYMENT_STATUS_VALUES = Object.freeze([
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
  "TERMINATED",
  "RETIRED",
  "CONTRACTOR",
] as const);

/** One governed Employee lifecycle status. */
export type EmploymentStatus = (typeof EMPLOYMENT_STATUS_VALUES)[number];

/** Is this a governed lifecycle status? Total, and never throws — the caller decides what to do. */
export function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return typeof value === "string" && (EMPLOYMENT_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * A person reference, as a governed business command holds one.
 *
 * TENANT-SCOPED, because an Employee is. Migration 008's header states this as the first of its three
 * reasons the crosswalk is a table rather than a column on `principals`, and migration 019 carries
 * `tenant_id` NOT NULL for the same reason. A lookup by bare id with no tenant would be able to resolve
 * tenant A's reference against tenant B's Employee, which migration 003's Ruling B calls a cross-tenant
 * identity leak rather than a dangling row.
 */
export interface EmployeeReference {
  readonly tenantId: string;
  readonly employeeId: string;
}

/**
 * What the authority knows about one Employee — the FACTS, and only facts.
 *
 * No `isEligible`, no `isActive`, no `canBeAccountable`, and no `isHistorical`. Each of those would be
 * the resolver deciding an eligibility question that #186 §2 assigns to another layer.
 */
export interface EmployeeFacts {
  readonly employeeId: string;
  readonly tenantId: string;
  /** The LIFECYCLE fact. One of six. Never reduced to a boolean by this module. */
  readonly employmentStatus: EmploymentStatus;
  /** Stated on the Employee record, never derived (migration 019, following 008:96-107). */
  readonly operatingCompanyId: string;
}

/** Why EOS could not obtain an authoritative answer. Each is a DIFFERENT operational failure. */
export type AuthorityUnavailableReason =
  /** No Employee authority is configured in this process. NOT "the Employee is missing". */
  | "NO_AUTHORITY_CONFIGURED"
  /** The authority was asked and the read failed — unreachable, timed out, refused. */
  | "AUTHORITY_READ_FAILED"
  /** The authority answered with something this contract does not recognise (e.g. a lifecycle status
   *  outside the governed six). Code and schema disagree; that is not a verdict about the person. */
  | "AUTHORITY_CONTRACT_VIOLATION";

/**
 * The outcome of resolving one person reference. THREE outcomes, never two and never one boolean.
 *
 * `RESOLVED` is REFERENCE VALIDITY and carries the LIFECYCLE STATUS. It is NOT an eligibility verdict —
 * see `decideAccountabilityEligibility`, which is where that question is answered, with a policy.
 */
export type EmployeeReferenceResolution =
  | {
      readonly outcome: "RESOLVED";
      readonly reference: EmployeeReference;
      readonly employee: EmployeeFacts;
    }
  | {
      /** The authority ANSWERED and no governed Employee resolves this reference. #182 state C. */
      readonly outcome: "NOT_FOUND";
      readonly reference: EmployeeReference;
    }
  | {
      /** EOS could not obtain an authoritative answer. #187 §2. FAIL CLOSED. */
      readonly outcome: "AUTHORITY_UNAVAILABLE";
      readonly reference: EmployeeReference;
      readonly reason: AuthorityUnavailableReason;
      /** Operator-facing detail for the audit record. Never a credential, never a connection string. */
      readonly detail: string;
    };

/**
 * The port. ONE method, because one question is all a person reference asks.
 *
 * There is deliberately no `resolveOrDefault`, no `tryResolve`, and no options bag with a fallback in
 * it. #185: "One authoritative implementation at a time. No long-lived dual authority. No silent
 * fallback from PostgreSQL to Firestore after cutover." An interface that cannot express a fallback is
 * the strongest form that rule can take in code.
 */
export interface EmployeeAuthority {
  resolveEmployeeReference(reference: EmployeeReference): Promise<EmployeeReferenceResolution>;
}

/** A reference that could never identify an Employee, whatever the authority holds. */
export function isEmployeeReferenceShape(reference: EmployeeReference): boolean {
  const wellShaped = (value: unknown): boolean =>
    typeof value === "string" && value !== "" && value.trim() === value && !value.includes("/");
  return wellShaped(reference.tenantId) && wellShaped(reference.employeeId);
}

// ════════════════════ ELIGIBILITY — SEPARATE, AND POLICY-DRIVEN ════════════════════

/**
 * A GOVERNED eligibility policy, as the operation that owns it states it.
 *
 * `eligibleStatuses` is an explicit list, never a predicate and never a default. Two consequences,
 * both intended:
 *
 *   * the policy is DATA, so it can be audited, compared and reported on. #189 requires the gate to
 *     "consume the governed eligibility result"; a function pointer cannot be consumed as a result.
 *   * writing the policy requires naming which of the six statuses are eligible FOR THIS OPERATION.
 *     There is no way to express it as "not ACTIVE", which is the formulation #189 forbids.
 *
 * `policyId` is required because #189 makes the eligibility answer a governed fact, and a governed fact
 * with no stated author is the guess with better handwriting that migration 008's header names.
 */
export interface AccountabilityEligibilityPolicy {
  /** Which governed policy decided this, for the audit record. */
  readonly policyId: string;
  /** The statuses this operation accepts. Stated, never derived, never inverted. */
  readonly eligibleStatuses: readonly EmploymentStatus[];
}

/** The eligibility answer — a fact about an operation, carrying the policy that produced it. */
export interface AccountabilityEligibility {
  readonly eligible: boolean;
  readonly policyId: string;
  /** The lifecycle status the decision was made against. Kept so the fact stays independently visible. */
  readonly employmentStatus: EmploymentStatus;
}

/**
 * Is this Employee currently eligible to RECEIVE the accountability this operation establishes?
 *
 * Takes FACTS and a GOVERNED POLICY. Requires both. Defaults neither.
 *
 * #189 (`MI-ε`): "A real Employee may simultaneously be a VALID REFERENCE and NOT CURRENTLY ELIGIBLE
 * FOR NEW/CURRENT ACCOUNTABILITY." This function is the second half of that sentence, and the resolver
 * is the first; they are separate calls on purpose, so a caller cannot obtain one by accident while
 * asking for the other.
 */
export function decideAccountabilityEligibility(
  employee: EmployeeFacts,
  policy: AccountabilityEligibilityPolicy,
): AccountabilityEligibility {
  return {
    eligible: policy.eligibleStatuses.includes(employee.employmentStatus),
    policyId: policy.policyId,
    employmentStatus: employee.employmentStatus,
  };
}

// ════════════════════ THE COMPOSED CONSUMER STATE ════════════════════

/**
 * What a consumer or census may PRESENT, per #186 §3 — and the underlying facts stay available.
 *
 *     "VALID HISTORICAL / NOT CURRENTLY ELIGIBLE remains a valid business semantic, but it is a
 *      COMPOSED state — not a primitive referential-resolution result. A consumer or census may present
 *      the composed result while the underlying facts remain independently available."
 *
 * So this is a function over the two facts rather than a fourth resolver outcome, and it returns them
 * alongside the composed label rather than instead of it. #186 §6 is the reason the labels are this
 * grain: the UI must be able to tell "Former employee" from "Inactive" from "could not be resolved"
 * from "authority unavailable", and "These must not be forced into one `NOT ELIGIBLE`."
 */
export type ComposedPersonReferenceState =
  /** #182 state A. Exists, and eligible for current use of this fact under the stated policy. */
  | "VALID_CURRENT"
  /** #182 state B. Exists and the reference is valid; not eligible to receive NEW accountability. */
  | "VALID_NOT_CURRENTLY_ELIGIBLE"
  /** #182 state C. No governed Employee resolves the reference. */
  | "MISSING_OR_INVALID_REFERENCE"
  /** #187 §2. Not a verdict about the person at all. */
  | "AUTHORITY_UNAVAILABLE";

export interface ComposedPersonReference {
  readonly state: ComposedPersonReferenceState;
  /** The resolution, unchanged. The composed label never replaces the facts it was computed from. */
  readonly resolution: EmployeeReferenceResolution;
  /** Present only when the reference resolved AND a policy was supplied. */
  readonly eligibility?: AccountabilityEligibility;
}

/**
 * Compose the presentable state from a resolution plus a governed policy.
 *
 * The policy is REQUIRED here too. Composing without one would have to guess which statuses are
 * eligible, and guessing is the hidden boolean policy #189 forbids.
 */
export function composePersonReferenceState(
  resolution: EmployeeReferenceResolution,
  policy: AccountabilityEligibilityPolicy,
): ComposedPersonReference {
  switch (resolution.outcome) {
    case "RESOLVED": {
      const eligibility = decideAccountabilityEligibility(resolution.employee, policy);
      return {
        state: eligibility.eligible ? "VALID_CURRENT" : "VALID_NOT_CURRENTLY_ELIGIBLE",
        resolution,
        eligibility,
      };
    }
    case "NOT_FOUND":
      // #186 case D: "eligibility NOT APPLICABLE -- must not be represented as merely 'not eligible'".
      // So there is no `eligibility` on this branch at all, rather than one saying `eligible: false`.
      return { state: "MISSING_OR_INVALID_REFERENCE", resolution };
    case "AUTHORITY_UNAVAILABLE":
      return { state: "AUTHORITY_UNAVAILABLE", resolution };
    default:
      return assertExhaustive(resolution);
  }
}

// ════════════════════ FAIL CLOSED ════════════════════

/** Why a required Employee reference could not be used. Distinct codes, because they are distinct facts. */
export type EmployeeAuthorityFailureCode =
  /** The authority answered and the reference does not resolve. */
  | "EMPLOYEE_REFERENCE_NOT_FOUND"
  /** The reference could never identify an Employee — empty, untrimmed, or path-shaped. */
  | "EMPLOYEE_REFERENCE_MALFORMED"
  /** EOS could not obtain an authoritative answer. NOT a verdict about the person. */
  | "EMPLOYEE_AUTHORITY_UNAVAILABLE";

/**
 * The refusal a governed command raises, carrying the code the audit record needs.
 *
 * The code is the point. #187 §2 requires the distinction be preserved in "resolver contract · census ·
 * enforcement · audit/error semantics · UI outcome vocabulary where applicable · tests" — so an
 * unavailable authority and a missing Employee must not arrive at the audit log as the same error.
 */
export class EmployeeAuthorityFailure extends Error {
  constructor(
    readonly code: EmployeeAuthorityFailureCode,
    message: string,
    /** Set only for EMPLOYEE_AUTHORITY_UNAVAILABLE, so an outage can be told apart from a bad read. */
    readonly unavailableReason?: AuthorityUnavailableReason,
  ) {
    super(message);
    this.name = "EmployeeAuthorityFailure";
  }
}

/**
 * Resolve, or REFUSE. The fail-closed entry point.
 *
 * A governed command that needs a real Employee calls this, and an unavailable authority refuses the
 * command rather than letting it proceed on an absent answer. That is #187 §2's "FAIL CLOSED", and
 * there is no variant of this function that returns a default, an empty record, or a fallback.
 */
export async function mustResolveEmployeeReference(
  authority: EmployeeAuthority,
  reference: EmployeeReference,
): Promise<EmployeeFacts> {
  if (!isEmployeeReferenceShape(reference)) {
    throw new EmployeeAuthorityFailure(
      "EMPLOYEE_REFERENCE_MALFORMED",
      `employee reference ${JSON.stringify(reference)} is not a well-shaped tenant/employee id pair; ` +
        "an id that is empty, untrimmed or path-shaped is not an id",
    );
  }
  const resolution = await authority.resolveEmployeeReference(reference);
  switch (resolution.outcome) {
    case "RESOLVED":
      return resolution.employee;
    case "NOT_FOUND":
      throw new EmployeeAuthorityFailure(
        "EMPLOYEE_REFERENCE_NOT_FOUND",
        `no governed Employee resolves ${reference.employeeId} in tenant ${reference.tenantId}`,
      );
    case "AUTHORITY_UNAVAILABLE":
      throw new EmployeeAuthorityFailure(
        "EMPLOYEE_AUTHORITY_UNAVAILABLE",
        `the Employee authority could not answer for ${reference.employeeId} in tenant ` +
          `${reference.tenantId} (${resolution.reason}): ${resolution.detail}. This is NOT a finding ` +
          "that the Employee is missing or invalid, and no other store may be consulted instead.",
        resolution.reason,
      );
    default:
      return assertExhaustive(resolution);
  }
}

/**
 * The authority that has no authority — every reference resolves to AUTHORITY_UNAVAILABLE.
 *
 * THIS IS NOT A FALLBACK AND NOT A STUB. It is the correct answer when no authority is configured:
 * #187 §2 lists "authority adapter unavailable" as an AUTHORITY_UNAVAILABLE cause, and the alternative
 * — a process with no Employee authority quietly consulting Firestore `employees`, `users` or
 * `fieldops_technicians` — is the silent fallback the same ruling forbids.
 *
 * It is also what makes the fail-closed behaviour provable with no database, which is why the absence
 * of a configured authority is a first-class object here rather than a thrown startup error.
 */
export function createUnavailableEmployeeAuthority(detail: string): EmployeeAuthority {
  return {
    async resolveEmployeeReference(reference: EmployeeReference): Promise<EmployeeReferenceResolution> {
      return {
        outcome: "AUTHORITY_UNAVAILABLE",
        reference,
        reason: "NO_AUTHORITY_CONFIGURED",
        detail,
      };
    },
  };
}

/** A `never` that names what was unhandled, so a new outcome breaks the build rather than a request. */
function assertExhaustive(value: never): never {
  throw new Error(`unhandled Employee authority outcome: ${JSON.stringify(value)}`);
}
