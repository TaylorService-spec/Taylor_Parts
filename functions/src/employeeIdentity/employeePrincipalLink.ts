// Employee ↔ Principal linkage — the VOCABULARY and the refusals.
//
// ════════════════════ WHAT THIS MODULE IS ════════════════════
//
// The canonical business Employee is Firestore's `employees` collection. The security identity is
// `eos_policy.principals` (functions/migrations/1757548800000_tenant-and-identity.sql). A Firebase
// UID is an EXTERNAL IDENTITY KEY ONLY — the `(identity_provider, external_subject)` side of a
// principal — never an EOS-native identifier, and never an Employee id.
//
// This file owns the terms in which those two things may be said to be the same person, and the
// terms in which the answer is refused. Migration 008
// (functions/migrations/1758412800000_employee-principal-linkage.sql) enforces the same closed
// vocabularies in the database; this module is where a caller gets a REASON instead of a constraint
// name, and where the reasons are enumerable by a test.
//
// ════════════════════ IT IMPORTS NOTHING ════════════════════
//
// No Firebase, no Firestore, no `pg`, no clock, no environment. Every function here is pure and
// total: given the same facts it returns the same answer, and it never throws for malformed input —
// malformed input IS one of the answers. That is what lets the planner in
// employeePrincipalLinkPlan.ts be proved against the live census numbers without a database, an
// emulator or a network.
//
// ════════════════════ NEVER GUESS ════════════════════
//
// The rule this module exists to hold is one sentence: an ambiguous mapping is REFUSED, never
// resolved. Two Employees claiming one Firebase UID is not "pick the first"; a technician id that
// happens to equal an employee id is not a link; an Employee with no linked user is not a reason to
// mint a principal. Each of those is a term in `LINK_REFUSAL` below, and each one is a row a human
// has to look at.

/**
 * How a link came to be. CLOSED, and closed on purpose — migration 008's
 * `employee_principal_links_source_known` CHECK carries exactly these two terms.
 *
 *   RECIPROCAL_FIREBASE_UID_LINK — the ONLY derived source. `employees/{employeeId}.userId` and
 *       `users/{uid}.employeeId` agree in BOTH directions, and that uid is the `external_subject`
 *       of the principal being linked. A one-way link is not this; it is
 *       `NON_RECIPROCAL_USER_LINK` below.
 *   OPERATOR_ASSERTED — a named human stated the link, with a reason. Both are mandatory
 *       (`requireAssertionProvenance`), because an assertion with no author is a guess.
 *
 * THERE IS NO THIRD TERM, and in particular no term for "the `fieldops_technicians` id happens to
 * equal the `employees` id". In the live census that coincidence holds for 11 of 13 technician
 * documents and fails for 2 (`tech-sbx-01`, `tech-sbx-02`); a rule inferred from the 11 is provably
 * wrong for the 2. `fieldops_technicians` is temporary compatibility data and must not remain
 * employee-identity authority.
 */
export const LINK_SOURCES = ["RECIPROCAL_FIREBASE_UID_LINK", "OPERATOR_ASSERTED"] as const;
export type EmployeePrincipalLinkSource = (typeof LINK_SOURCES)[number];

/** Link lifecycle. `revoked` rows survive as history; migration 008's partial unique indexes are
 *  declared `WHERE status = 'active'` so history never blocks a later re-link. */
export const LINK_STATUSES = ["active", "revoked"] as const;
export type EmployeePrincipalLinkStatus = (typeof LINK_STATUSES)[number];

/**
 * THE COMPLETE REFUSAL VOCABULARY. Exactly these nine terms; nothing else is ever emitted as a
 * reason a link was not established. A tenth reason is a code change a reviewer reads, not a string
 * a caller invents.
 *
 * Kept as data (not as inline string literals at each throw site) so that a test can assert every
 * term is reachable and that the planner emits nothing outside the set.
 */
export const LINK_REFUSAL = Object.freeze({
  /** `employees/{id}` carries no `userId`. No external subject exists, so no principal can be named. */
  EMPLOYEE_WITHOUT_EXTERNAL_SUBJECT: "EMPLOYEE_WITHOUT_EXTERNAL_SUBJECT",
  /** A `users/{uid}` document with no Employee behind it. A login is not a person record. */
  EXTERNAL_SUBJECT_WITHOUT_EMPLOYEE: "EXTERNAL_SUBJECT_WITHOUT_EMPLOYEE",
  /** The two documents disagree about each other. A one-way link is not a link. */
  NON_RECIPROCAL_USER_LINK: "NON_RECIPROCAL_USER_LINK",
  /** More than one Employee claims the same Firebase UID. Refused; never first-wins. */
  AMBIGUOUS_EXTERNAL_SUBJECT: "AMBIGUOUS_EXTERNAL_SUBJECT",
  /** More than one Employee resolves to the same principal. Refused; never first-wins. */
  AMBIGUOUS_PRINCIPAL: "AMBIGUOUS_PRINCIPAL",
  /** The uid is reciprocally linked, but `eos_policy.principals` has no row for it. Minting a
   *  principal is the identity path's decision, not the linkage planner's. */
  NO_PRINCIPAL_FOR_EXTERNAL_SUBJECT: "NO_PRINCIPAL_FOR_EXTERNAL_SUBJECT",
  /** A `fieldops_technicians` document that corresponds to no Employee. NEVER minted into one. */
  ORPHAN_TECHNICIAN: "ORPHAN_TECHNICIAN",
  /** A business fact that exists ONLY on `fieldops_technicians` (`skills`, dispatch `status`) and
   *  on no Employee. Retiring the collection would destroy it; this names that, and refuses. */
  TECHNICIAN_ONLY_BUSINESS_FACT: "TECHNICIAN_ONLY_BUSINESS_FACT",
  /** The operating company was not stated. It is NEVER inferred — not from a warehouse, a truck,
   *  `homeWarehouseId`, or a job title. */
  OPERATING_COMPANY_NOT_STATED: "OPERATING_COMPANY_NOT_STATED",
});

export type LinkRefusalReason = (typeof LINK_REFUSAL)[keyof typeof LINK_REFUSAL];
export const LINK_REFUSAL_REASONS: readonly LinkRefusalReason[] = Object.freeze(
  Object.values(LINK_REFUSAL).slice().sort(),
) as readonly LinkRefusalReason[];

/**
 * The identifier shape rules, stated once.
 *
 * `employeeId` is a Firestore document id today and a Postgres key tomorrow, so a value containing
 * "/" is a path, and an untrimmed value is a typo that would compare unequal to the trimmed one
 * everywhere else. Migration 008's `employee_principal_links_employee_id_shape` CHECK is the same
 * rule in SQL — deliberately both, because the CHECK protects paths that do not come through here.
 */
export function isEmployeeIdShape(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value && !value.includes("/")
  );
}

/**
 * The governed operating-company id SHAPE — a mirror of
 * functions/src/ownership/operatingCompanyAuthority.ts's `isOperatingCompanyIdShape`, and of
 * migration 008's `employee_principal_links_operating_company_shape` CHECK.
 *
 * SHAPE, never MEMBERSHIP. `taylor` and `ventana` are this deployment's governed ids; encoding them
 * here would make adding a third company a code change, and this module is not the authority for
 * which companies exist. It is mirrored rather than imported so that this file keeps its "imports
 * nothing" property — the mirror is asserted against the original by a test.
 */
const OPERATING_COMPANY_ID_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;
export function isOperatingCompanyIdShape(value: unknown): value is string {
  return typeof value === "string" && OPERATING_COMPANY_ID_PATTERN.test(value);
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function isLinkSource(value: unknown): value is EmployeePrincipalLinkSource {
  return typeof value === "string" && (LINK_SOURCES as readonly string[]).includes(value);
}

/** A refusal carrying one term from `LINK_REFUSAL` plus the detail a human needs to act. */
export class EmployeePrincipalLinkRefused extends Error {
  constructor(
    readonly reason: LinkRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "EmployeePrincipalLinkRefused";
  }
}

/** An input that is malformed rather than ambiguous — a distinct failure from a refusal, because
 *  "you sent me nonsense" and "your data cannot be decided" are different problems with different
 *  owners. */
export class EmployeePrincipalLinkInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeePrincipalLinkInvalid";
  }
}

/** The fields a link is established from. `operatingCompanyId` is required; see migration 008. */
export interface EmployeePrincipalLinkInput {
  readonly tenantId: string;
  readonly principalId: string;
  readonly employeeId: string;
  readonly operatingCompanyId: string;
  readonly linkSource: EmployeePrincipalLinkSource;
  readonly assertedBy?: string | null;
  readonly assertionReason?: string | null;
}

/** A stored link, as the repository returns it. */
export interface EmployeePrincipalLinkRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly employeeId: string;
  readonly operatingCompanyId: string;
  readonly linkSource: EmployeePrincipalLinkSource;
  readonly status: EmployeePrincipalLinkStatus;
  readonly assertedBy: string | null;
  readonly assertionReason: string | null;
}

/**
 * Validate a link input, in full, before any storage is touched.
 *
 * Refusals are raised as `EmployeePrincipalLinkRefused` with a vocabulary term; structural problems
 * (a blank tenant, an unknown source) as `EmployeePrincipalLinkInvalid`. Both are refusals to write;
 * they differ in who has to fix it.
 *
 * A missing operating company is a REFUSAL, not a structural error, precisely because the tempting
 * repair — reach for the Employee's warehouse, or the truck they drive — is the inference this lane
 * exists to forbid. Naming it in the refusal vocabulary keeps it visible in a census.
 */
export function assertValidLinkInput(input: EmployeePrincipalLinkInput): void {
  if (!nonEmpty(input.tenantId)) throw new EmployeePrincipalLinkInvalid("tenantId is required");
  if (!nonEmpty(input.principalId))
    throw new EmployeePrincipalLinkInvalid("principalId is required");
  if (!isEmployeeIdShape(input.employeeId)) {
    throw new EmployeePrincipalLinkInvalid(
      `employeeId ${JSON.stringify(input.employeeId)} is not a well-formed Employee id ` +
        "(non-empty, trimmed, no \"/\")",
    );
  }
  if (!isLinkSource(input.linkSource)) {
    throw new EmployeePrincipalLinkInvalid(
      `linkSource ${JSON.stringify(input.linkSource)} is not one of ${LINK_SOURCES.join(", ")} -- ` +
        "in particular a fieldops_technicians id coincidence is not a link source",
    );
  }
  if (!isOperatingCompanyIdShape(input.operatingCompanyId)) {
    throw new EmployeePrincipalLinkRefused(
      LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED,
      `operatingCompanyId ${JSON.stringify(input.operatingCompanyId)} was not stated as a governed ` +
        "id; it is never inferred from a warehouse, a truck, homeWarehouseId or a job title",
    );
  }
  requireAssertionProvenance(input);
}

/**
 * An OPERATOR_ASSERTED link needs an author AND a reason.
 *
 * Checked here as well as by migration 008's `employee_principal_links_assertion_has_author` CHECK,
 * for the reason migration 007 gives for its own doubled check: a caller that omitted it should get
 * the sentence, not a constraint name — and no code path may quietly supply a placeholder.
 */
export function requireAssertionProvenance(input: EmployeePrincipalLinkInput): void {
  if (input.linkSource !== "OPERATOR_ASSERTED") return;
  if (!nonEmpty(input.assertedBy) || !nonEmpty(input.assertionReason)) {
    throw new EmployeePrincipalLinkInvalid(
      "an OPERATOR_ASSERTED link requires assertedBy and assertionReason -- an assertion with no " +
        "author is a guess",
    );
  }
}
