// Employee ↔ Principal linkage — THE PLAN. Evidence in, decisions out, nothing written.
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// A pure planner. It takes the four collections that between them hold every claim about who an
// Employee is — `employees`, `users`, `fieldops_technicians` and an `eos_policy.principals` export
// — and returns, for every identity subject, either a link that may be established or a REFUSAL
// naming why it may not. It opens no connection, writes nothing, and reads no clock or environment.
//
// It is the same shape, and deliberately the same discipline, as
// scripts/employeeTruckCrosswalk.lib.mjs: plain `[{ id, data }]` arrays in (exactly what a
// read-only QuerySnapshot yields and exactly what a fixture can be written by hand), a closed
// outcome vocabulary out, a readiness verdict that can REFUSE. The crosswalk already encodes the
// correct R4 semantics for the employee/truck chain; this reuses its approach for the one question
// it does not answer — where the Employee↔Principal mapping is allowed to come from.
//
// ════════════════════ THE FOUR AUTHORITIES, AND WHICH IS WHICH ════════════════════
//
//   `employees`                — CANONICAL business Employee. `employees/{id}.userId` is the
//                                Employee record's own statement about its external subject.
//   `users/{uid}`              — the Firebase side. `users/{uid}.employeeId` is the back-link.
//   `eos_policy.principals`    — SECURITY identity. Keyed by (identity_provider, external_subject).
//                                A Firebase UID is the external_subject; it is never an EOS id.
//   `fieldops_technicians`     — TEMPORARY COMPATIBILITY. Never employee-identity authority, never
//                                assignment authority, and never a link source here.
//
// ════════════════════ WHAT IT REFUSES TO DO ════════════════════
//
// It never mints anything. Not an Employee for an orphan technician, not a principal for an
// unlinked uid, not an operating company for an Employee that was not given one. Every one of those
// is a decision with an owner, and a planner that makes them quietly is a planner that has decided
// the migration on its own.
//
// It never resolves ambiguity. Two Employees claiming one Firebase UID produce two refusals, not a
// winner — and the same for two Employees resolving to one principal. `AMBIGUOUS_*` is the only
// honest answer to "which of these two is it", and it refuses the whole plan (see `linkageReadiness`).
//
// It never derives a link from a `fieldops_technicians` id. In the live census 11 of 13 technician
// ids coincide exactly with employee ids; that is authoring history, not a rule, and the 2 that do
// not (`tech-sbx-01`, `tech-sbx-02`) are what a rule inferred from the 11 would get wrong. The
// coincidence is COUNTED in the summary, as evidence, and is reachable by no code path that
// produces a link.
//
// ════════════════════ TWO READINESS VERDICTS, NOT ONE ════════════════════
//
// `linkageReadiness` answers "may the Employee↔Principal links be established". `technicianRetirementReadiness`
// answers "may `fieldops_technicians` be retired". They are separate because the live data makes
// them separate: the 60 Employees can be linked long before the collection can be dropped, and
// collapsing the two would either block the linkage on an unrelated data question or let the
// collection be retired with facts still in it. In the live census `fieldops_technicians.skills`
// exists on 0 of 60 Employee documents — so a cutover treating `employees` as complete DESTROYS it,
// and `tech-sbx-02` (no `userId`, present in no other collection) would simply cease to exist.
// Both are reported here as refusals rather than repaired by invention.

import {
  LINK_REFUSAL,
  LINK_REFUSAL_REASONS,
  isEmployeeIdShape,
  isOperatingCompanyIdShape,
  type EmployeePrincipalLinkSource,
  type LinkRefusalReason,
} from "./employeePrincipalLink.js";

/** A Firestore document as evidence: an id and its raw data. No Firestore type crosses this line. */
export interface RawDocument {
  readonly id: string;
  readonly data?: Record<string, unknown> | null;
}

/** A row of `eos_policy.principals`, in either snake_case (a psql/CSV export) or camelCase (the
 *  repository's own record shape). Both are accepted because both are things an operator actually
 *  has in hand, and normalizing here beats making the caller reshape evidence. */
export interface RawPrincipal {
  readonly id?: unknown;
  readonly external_subject?: unknown;
  readonly externalSubject?: unknown;
  readonly identity_provider?: unknown;
  readonly identityProvider?: unknown;
  readonly status?: unknown;
}

export interface EmployeePrincipalPlanInput {
  readonly tenantId: string;
  /** The provider whose subjects the `users` collection holds. `"firebase"` today; named rather
   *  than assumed, because the principal key is (identity_provider, external_subject) and matching
   *  a subject against the wrong provider's principals is exactly the mistake that mints a second
   *  principal for one human. */
  readonly identityProvider: string;
  readonly employees?: readonly RawDocument[];
  readonly users?: readonly RawDocument[];
  readonly technicians?: readonly RawDocument[];
  readonly principals?: readonly RawPrincipal[];
  /**
   * The operating company for each Employee, STATED. Never inferred — not from a warehouse, a
   * truck, `homeWarehouseId`, or a job title. An Employee absent from this map is refused with
   * `OPERATING_COMPANY_NOT_STATED` rather than given a default, because a default is a claim the
   * data cannot support and is indistinguishable afterwards from a deliberate assignment.
   */
  readonly operatingCompanyIdByEmployeeId?: Readonly<Record<string, string>>;
}

export interface EmployeePrincipalLinkProposal {
  readonly employeeId: string;
  readonly principalId: string;
  readonly externalSubject: string;
  readonly identityProvider: string;
  readonly operatingCompanyId: string;
  readonly linkSource: EmployeePrincipalLinkSource;
  /** True when a `fieldops_technicians` document happens to share this Employee's id. EVIDENCE
   *  ONLY: nothing in this module reads it back, and it is never a reason a link exists. */
  readonly technicianIdCoincides: boolean;
}

export interface EmployeePrincipalRefusal {
  /** `employee:<id>` / `uid:<subject>` / `technician:<id>` / `technicianField:<key>`. The prefix is
   *  part of the key so two different kinds of subject can never collide on a bare id. */
  readonly subject: string;
  readonly reason: LinkRefusalReason;
  readonly detail: string;
}

export const PLAN_READINESS = Object.freeze({ PROCEED: "PROCEED", REFUSE: "REFUSE" });
export type PlanReadiness = (typeof PLAN_READINESS)[keyof typeof PLAN_READINESS];

/** The refusals that mean "this data cannot be decided", as opposed to "this subject is not ready".
 *  Only these refuse the linkage as a whole: an Employee with no login is simply not linkable yet,
 *  while two Employees claiming one login means nothing may be trusted until a human looks. */
const LINKAGE_BLOCKING_REFUSALS: ReadonlySet<LinkRefusalReason> = new Set([
  LINK_REFUSAL.AMBIGUOUS_EXTERNAL_SUBJECT,
  LINK_REFUSAL.AMBIGUOUS_PRINCIPAL,
  LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED,
]);

/** The refusals that mean `fieldops_technicians` still holds something nothing else holds. */
const TECHNICIAN_RETIREMENT_BLOCKING_REFUSALS: ReadonlySet<LinkRefusalReason> = new Set([
  LINK_REFUSAL.ORPHAN_TECHNICIAN,
  LINK_REFUSAL.TECHNICIAN_ONLY_BUSINESS_FACT,
]);

export interface EmployeePrincipalPlan {
  readonly schema: "eos.w1c5.employee-principal-link-plan/1";
  readonly tenantId: string;
  readonly identityProvider: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly links: readonly EmployeePrincipalLinkProposal[];
  readonly refusals: readonly EmployeePrincipalRefusal[];
  readonly refusalCounts: Readonly<Record<LinkRefusalReason, number>>;
  readonly linkageReadiness: PlanReadiness;
  readonly technicianRetirementReadiness: PlanReadiness;
  /** Field keys carried by at least one `fieldops_technicians` document and by NO Employee
   *  document. Computed from the evidence, not asserted from a prior census. */
  readonly technicianOnlyFieldKeys: readonly string[];
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function indexById(records: readonly RawDocument[] | undefined): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const record of records ?? []) {
    if (!isEmployeeIdShape(record?.id)) continue;
    map.set(record.id, (record.data ?? {}) as Record<string, unknown>);
  }
  return map;
}

/**
 * Build the plan.
 *
 * Deterministic: `links` sorted by `employeeId`, `refusals` sorted by `subject` then `reason`. The
 * determinism is asserted by the test suite, because a plan whose order varies cannot be diffed
 * between two runs, and diffing two runs is how an operator sees what changed.
 */
export function buildEmployeePrincipalLinkPlan(
  input: EmployeePrincipalPlanInput,
): EmployeePrincipalPlan {
  const employeeById = indexById(input.employees);
  const userByUid = indexById(input.users);
  const technicianById = indexById(input.technicians);
  const companyByEmployeeId = input.operatingCompanyIdByEmployeeId ?? {};

  // ---- principals, keyed by external subject WITHIN the named provider ----------------------
  // Provider-scoped, exactly as `principals_provider_subject_unique` is: the same subject string
  // from two providers is two different people as far as this mapping is concerned.
  const principalBySubject = new Map<string, { id: string; status: string | null }>();
  const duplicateSubjects = new Set<string>();
  for (const principal of input.principals ?? []) {
    const provider =
      stringOrNull(principal?.identity_provider) ?? stringOrNull(principal?.identityProvider);
    if (provider !== input.identityProvider) continue;
    const subject =
      stringOrNull(principal?.external_subject) ?? stringOrNull(principal?.externalSubject);
    const id = stringOrNull(principal?.id);
    if (subject === null || id === null) continue;
    if (principalBySubject.has(subject)) {
      duplicateSubjects.add(subject);
      continue;
    }
    principalBySubject.set(subject, { id, status: stringOrNull(principal?.status) });
  }

  // ---- Employee -> its claimed external subject, and the UIDs claimed more than once ---------
  const employeeIdsBySubject = new Map<string, string[]>();
  for (const [employeeId, data] of employeeById) {
    const subject = stringOrNull(data?.userId);
    if (subject === null) continue;
    const list = employeeIdsBySubject.get(subject) ?? [];
    list.push(employeeId);
    employeeIdsBySubject.set(subject, list);
  }

  const links: EmployeePrincipalLinkProposal[] = [];
  const refusals: EmployeePrincipalRefusal[] = [];
  const refuse = (subject: string, reason: LinkRefusalReason, detail: string) =>
    refusals.push({ subject, reason, detail });

  // ---- one decision per Employee -------------------------------------------------------------
  for (const employeeId of [...employeeById.keys()].sort()) {
    const data = employeeById.get(employeeId) ?? {};
    const subject = stringOrNull(data?.userId);

    if (subject === null) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.EMPLOYEE_WITHOUT_EXTERNAL_SUBJECT,
        `employees/${employeeId} carries no userId, so no external subject names a principal`,
      );
      continue;
    }

    const claimants = employeeIdsBySubject.get(subject) ?? [];
    if (claimants.length > 1) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.AMBIGUOUS_EXTERNAL_SUBJECT,
        `external subject ${subject} is claimed by ${claimants.length} Employees ` +
          `(${[...claimants].sort().join(", ")}); the mapping is not decidable`,
      );
      continue;
    }

    // The reciprocal contract, the SAME one firestore.rules' isActiveOperationalRole() and
    // functions/src/access/adminCredentialCommands.ts's resolveEmployeeLinkFacts() already use:
    // users/{uid}.employeeId -> employees/{employeeId}.userId === uid. No alias fields
    // (`authUid`, `uid`) are accepted, same posture as both precedents.
    const userData = userByUid.get(subject) ?? null;
    const backLink = stringOrNull(userData?.employeeId);
    if (userData === null || backLink !== employeeId) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.NON_RECIPROCAL_USER_LINK,
        userData === null
          ? `employees/${employeeId}.userId=${subject} names no users document`
          : `users/${subject}.employeeId=${backLink ?? "unset"} does not point back at ${employeeId}`,
      );
      continue;
    }

    if (duplicateSubjects.has(subject)) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.AMBIGUOUS_PRINCIPAL,
        `more than one principal carries external subject ${subject} for provider ` +
          `${input.identityProvider}; the identity model forbids this and it is not repaired here`,
      );
      continue;
    }

    const principal = principalBySubject.get(subject) ?? null;
    if (principal === null) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.NO_PRINCIPAL_FOR_EXTERNAL_SUBJECT,
        `no eos_policy.principals row has (identity_provider=${input.identityProvider}, ` +
          `external_subject=${subject}); minting one is the identity path's decision, not this plan's`,
      );
      continue;
    }

    const operatingCompanyId = companyByEmployeeId[employeeId];
    if (!isOperatingCompanyIdShape(operatingCompanyId)) {
      refuse(
        `employee:${employeeId}`,
        LINK_REFUSAL.OPERATING_COMPANY_NOT_STATED,
        `no operating company was stated for employees/${employeeId}; it is never inferred from a ` +
          "warehouse, a truck, homeWarehouseId or a job title",
      );
      continue;
    }

    links.push({
      employeeId,
      principalId: principal.id,
      externalSubject: subject,
      identityProvider: input.identityProvider,
      operatingCompanyId,
      linkSource: "RECIPROCAL_FIREBASE_UID_LINK",
      // EVIDENCE ONLY. Recorded because the coincidence is real (11 of 13 in the live census) and a
      // reader deserves to see that it was noticed and not used.
      technicianIdCoincides: technicianById.has(employeeId),
    });
  }

  // ---- UIDs with no Employee behind them -----------------------------------------------------
  for (const uid of [...userByUid.keys()].sort()) {
    if (employeeIdsBySubject.has(uid)) continue;
    const userData = userByUid.get(uid) ?? {};
    // `users/{uid}.employeeId` is reported, never trusted: a back-link naming an Employee that does
    // not exist is still an external subject with no Employee.
    const claimed = stringOrNull(userData?.employeeId);
    refuse(
      `uid:${uid}`,
      LINK_REFUSAL.EXTERNAL_SUBJECT_WITHOUT_EMPLOYEE,
      claimed === null
        ? `users/${uid} is linked to no Employee`
        : `users/${uid}.employeeId=${claimed} names no employees document that links back`,
    );
  }

  // ---- orphan technicians: named, never minted ------------------------------------------------
  for (const technicianId of [...technicianById.keys()].sort()) {
    if (employeeById.has(technicianId)) continue;
    const data = technicianById.get(technicianId) ?? {};
    const uid = stringOrNull(data?.userId);
    refuse(
      `technician:${technicianId}`,
      LINK_REFUSAL.ORPHAN_TECHNICIAN,
      `fieldops_technicians/${technicianId} corresponds to no employees document` +
        (uid === null
          ? " and carries no userId, so nothing else in the system names this person"
          : `; its userId=${uid} is reported but never used to mint an Employee`),
    );
  }

  // ---- business facts that live ONLY on fieldops_technicians ----------------------------------
  // Computed, not asserted: a key carried by at least one technician document and by no Employee
  // document is a fact that retiring the collection would destroy. The live census's finding
  // (`skills` on 0 of 60 Employees, dispatch `status` likewise) is what this arithmetic produces on
  // the live data; hard-coding the two field names instead would silently miss a third.
  const employeeFieldKeys = new Set<string>();
  for (const data of employeeById.values()) for (const key of Object.keys(data)) employeeFieldKeys.add(key);

  const technicianFieldCounts = new Map<string, number>();
  for (const data of technicianById.values()) {
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      technicianFieldCounts.set(key, (technicianFieldCounts.get(key) ?? 0) + 1);
    }
  }

  const technicianOnlyFieldKeys = [...technicianFieldCounts.keys()]
    .filter((key) => !employeeFieldKeys.has(key))
    .sort();

  for (const key of technicianOnlyFieldKeys) {
    refuse(
      `technicianField:${key}`,
      LINK_REFUSAL.TECHNICIAN_ONLY_BUSINESS_FACT,
      `fieldops_technicians.${key} is carried by ${technicianFieldCounts.get(key)} technician ` +
        "document(s) and by no employees document; retiring the collection would destroy it, and " +
        "this plan will not invent an Employee field to hold it",
    );
  }

  // ---- summary --------------------------------------------------------------------------------
  refusals.sort((a, b) => a.subject.localeCompare(b.subject) || a.reason.localeCompare(b.reason));
  links.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const refusalCounts = Object.fromEntries(
    LINK_REFUSAL_REASONS.map((reason) => [reason, 0]),
  ) as Record<LinkRefusalReason, number>;
  for (const refusal of refusals) refusalCounts[refusal.reason] += 1;

  const linkageReadiness: PlanReadiness = refusals.some((r) =>
    LINKAGE_BLOCKING_REFUSALS.has(r.reason),
  )
    ? PLAN_READINESS.REFUSE
    : PLAN_READINESS.PROCEED;

  const technicianRetirementReadiness: PlanReadiness = refusals.some((r) =>
    TECHNICIAN_RETIREMENT_BLOCKING_REFUSALS.has(r.reason),
  )
    ? PLAN_READINESS.REFUSE
    : PLAN_READINESS.PROCEED;

  return {
    schema: "eos.w1c5.employee-principal-link-plan/1",
    tenantId: input.tenantId,
    identityProvider: input.identityProvider,
    counts: Object.freeze({
      employees: employeeById.size,
      users: userByUid.size,
      technicians: technicianById.size,
      principals: principalBySubject.size,
      links: links.length,
      refusals: refusals.length,
      // EVIDENCE ONLY, and labelled as such: how many technician ids happen to equal an employee
      // id. Nothing branches on it.
      technicianIdCoincidences: [...technicianById.keys()].filter((id) => employeeById.has(id))
        .length,
    }),
    links: Object.freeze(links),
    refusals: Object.freeze(refusals),
    refusalCounts: Object.freeze(refusalCounts),
    linkageReadiness,
    technicianRetirementReadiness,
    technicianOnlyFieldKeys: Object.freeze(technicianOnlyFieldKeys),
  };
}
