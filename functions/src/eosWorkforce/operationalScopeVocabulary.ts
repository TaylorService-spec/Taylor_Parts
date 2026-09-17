// The OPERATIONAL SCOPE vocabulary (Owner ruling 2026-09-17, operationalRoles decomposition, step B).
//
// Pure: no Firebase, no database, no I/O. Shared by the governed PostgreSQL scope writer/read authority and by the
// deterministic migration/census tooling, so the writer and the migration cannot disagree about which scope types exist.
//
// ONE QUESTION ONLY. A scope answers "is this Employee authorized for THIS particular warehouse/location/context?"
// It is one of three independent authorities the legacy `operationalRoles` field conflated:
//
//   SECURITY CAPABILITY   can this Principal use this application capability?   (eos_policy; the FIRST boundary)
//   WORK ELIGIBILITY      is this Employee qualified for this kind of work?     (workEligibilityVocabulary.ts)
//   OPERATIONAL SCOPE     is this Employee authorized for this warehouse?       (this module)
//
// A governed command may require one, two or all three, checked SEPARATELY. Ending the old fused boolean is the point:
// `firestore.rules` isAssignedToWarehouse() answered "holds WAREHOUSE_MANAGER AND assignedWarehouseIds contains this
// warehouse" in one opaque test. The replacement predicate answers only the scope half:
//
//   employeeHasWarehouseScope(employeeId, warehouseId)  ->  "is this Employee explicitly scoped to this warehouse?"
//
// It does NOT answer "does the Principal have permission?" and it does NOT answer "is the Employee qualified for
// warehouse operations?" SCOPE NEVER SUBSTITUTES FOR QUALIFICATION, and qualification never substitutes for scope.
//
// A SCOPE GRANTS NO APPLICATION ACCESS (Owner ruling). It confers no Security Role, capability, permission, Job Role,
// qualification, ownership, assignment, manager/reporting authority or operating-company authority.

/**
 * The PLATFORM-DEFINED scope types. WAREHOUSE alone, deliberately: the ruling forbids building arbitrary scope types
 * before a live consumer requires them.
 *
 * While WAREHOUSE is the only type, the database carries a real composite FOREIGN KEY from (tenant_id, scope_id) to
 * eos_ops.warehouses, so a scope can only ever name a warehouse that exists in the same tenant. Adding a second type
 * is a reviewed migration that must revisit that foreign key -- which is the intended cost, not an oversight.
 *
 * Operating Company is NOT a scope type here: it already has its own governed Employee authority
 * (eos_workforce.employees.operating_company_id), and is not duplicated to make the abstraction look complete.
 */
export const OPERATIONAL_SCOPE_TYPES = Object.freeze(["WAREHOUSE"] as const);

export type OperationalScopeType = (typeof OPERATIONAL_SCOPE_TYPES)[number];

/**
 * The narrow Administration capability that maintains operational scopes. By Owner ruling it is SEPARATE from
 * `admin.employeeWorkEligibility.write`: deciding which warehouses an Employee covers is not the same authority as
 * deciding what kind of work they are qualified to perform.
 */
export const EMPLOYEE_OPERATIONAL_SCOPE_WRITE = "admin.employeeOperationalScope.write";

/** Audit actions for the governed scope writers (step C). */
export const OPERATIONAL_SCOPE_ASSIGN_ACTION = "employee.operationalScope.assign";
export const OPERATIONAL_SCOPE_END_ACTION = "employee.operationalScope.end";

/** Administration display text. Presentation only -- never a persona or authorization mapping. */
export const OPERATIONAL_SCOPE_TYPE_LABEL: Readonly<Record<OperationalScopeType, string>> = Object.freeze({
  WAREHOUSE: "Warehouse",
});

export function isOperationalScopeType(value: unknown): value is OperationalScopeType {
  return typeof value === "string" && (OPERATIONAL_SCOPE_TYPES as readonly string[]).includes(value);
}

/**
 * The ONLY legacy field the Owner ruled admissible as scope migration EVIDENCE -- and it is evidence, not authority.
 * The array itself never becomes the authority; the normalized effective-dated rows do.
 *
 * A legacy value may be copied into a governed WAREHOUSE scope ONLY when every one of these holds (steps D/E):
 * the Employee resolves exactly, the warehouse id resolves exactly, both are in the same tenant, the warehouse is a
 * governed ACTIVE location, and there is no ambiguity. Unknown, stale, cross-tenant or non-resolving ids become
 * remediation findings. Nothing is guessed.
 *
 * Warehouse scope is NEVER derived from a legacy role string: a WAREHOUSE_MANAGER or WAREHOUSE_ASSOCIATE value proves
 * nothing about WHICH warehouse, and WAREHOUSE_OPERATIONS qualification is a separate authority.
 */
export const LEGACY_SCOPE_EVIDENCE_FIELD = "assignedWarehouseIds";
