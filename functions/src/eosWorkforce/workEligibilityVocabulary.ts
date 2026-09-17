// The WORK ELIGIBILITY / QUALIFICATION vocabulary (Owner ruling 2026-09-17, operationalRoles decomposition, step A).
//
// Pure: no Firebase, no database, no I/O. Shared by the governed PostgreSQL qualification writer/read authority and by
// the deterministic migration/census tooling, so the writer and the migration cannot disagree about which codes exist.
//
// ONE QUESTION ONLY. A qualification answers "is this Employee QUALIFIED for this kind of operational work?" It is one
// of three independent authorities the legacy `operationalRoles` field conflated:
//
//   SECURITY CAPABILITY   can this Principal use this application capability?   (eos_policy; the FIRST boundary)
//   WORK ELIGIBILITY      is this Employee qualified for this kind of work?     (this module)
//   OPERATIONAL SCOPE     is this Employee authorized for this warehouse?       (employee_operational_scopes, step B)
//
// A governed command may require one, two or all three, checked SEPARATELY. They are never folded into one boolean.
//
// A QUALIFICATION GRANTS NO APPLICATION ACCESS (Owner ruling). It confers no Security Role, capability, permission,
// Job Role, ownership, assignment, manager/reporting authority or operating-company authority. Security capability
// alone does not prove qualification; qualification alone authorizes nothing.
//
// NOT DERIVED FROM, AND NEVER MIRRORING, Job Role or Security Role. An Employee may hold Job Role `Service Technician`
// and temporarily LACK SERVICE_TECHNICIAN; an Employee may gain or lose a qualification with no Job Role change.
// Presentation/persona uses Job Role; enforcement uses these codes. That distinction is the point of the decomposition.

/**
 * The PLATFORM-DEFINED canonical qualification codes. Deliberately NOT tenant-editable in v1 (Owner ruling): these
 * carry application/domain semantics, so they are enforced by a CHECK constraint rather than a tenant catalog table.
 *
 * Adding a code is a reviewed migration, and is warranted ONLY when a real current consumer proves that neither
 * existing code can truthfully express the required operational eligibility. The eight legacy operationalRole values
 * are NOT reproduced here, and these codes never mirror a Security Role or a Job Role.
 */
export const WORK_ELIGIBILITY_CODES = Object.freeze(["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"] as const);

export type WorkEligibilityCode = (typeof WORK_ELIGIBILITY_CODES)[number];

/**
 * The narrow Administration capability that maintains qualifications. By Owner ruling it is its OWN capability: it
 * deliberately does not reuse `admin.employeeProfile.write` or `admin.employeeJobRole.write`, so granting someone the
 * ability to edit a profile or set a Job Role does not also let them decide who is qualified to perform work.
 */
export const EMPLOYEE_WORK_ELIGIBILITY_WRITE = "admin.employeeWorkEligibility.write";

/** Audit actions for the governed qualification writers (step C). */
export const WORK_ELIGIBILITY_ASSIGN_ACTION = "employee.workEligibility.assign";
export const WORK_ELIGIBILITY_END_ACTION = "employee.workEligibility.end";

/**
 * Administration display text for the two codes. For the Administration qualification surface ONLY -- it is NOT a
 * persona or dashboard mapping. Business-function presentation uses Job Role (`Service Technician`,
 * `Parts / Warehouse`), never a qualification code.
 */
export const WORK_ELIGIBILITY_LABEL: Readonly<Record<WorkEligibilityCode, string>> = Object.freeze({
  SERVICE_TECHNICIAN: "Service Technician (work eligibility)",
  WAREHOUSE_OPERATIONS: "Warehouse Operations (work eligibility)",
});

export function isWorkEligibilityCode(value: unknown): value is WorkEligibilityCode {
  return typeof value === "string" && (WORK_ELIGIBILITY_CODES as readonly string[]).includes(value);
}

/**
 * The ONLY two legacy `operationalRoles` values the Owner ruled deterministic migration CANDIDATES. This is a
 * candidate map for the dry-run/census tooling (steps D/E) -- NOT an applied mapping, and NOT a fallback any runtime
 * path may consult. Every other legacy value requires a proven exact current consumer mapping or Administration
 * remediation; leaving an ambiguous legacy value unmigrated needs no further Owner ruling.
 *
 * Warehouse SCOPE is never derived from a legacy role string: WAREHOUSE_OPERATIONS qualification and warehouse scope
 * are separate authorities, and `assignedWarehouseIds` is the only scope migration evidence (step B).
 */
export const LEGACY_QUALIFICATION_CANDIDATES: Readonly<Record<string, WorkEligibilityCode>> = Object.freeze({
  TECHNICIAN: "SERVICE_TECHNICIAN",
  WAREHOUSE_ASSOCIATE: "WAREHOUSE_OPERATIONS",
});
