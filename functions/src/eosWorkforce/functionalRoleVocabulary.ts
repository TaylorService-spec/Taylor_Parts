// FUNCTIONAL ROLE -- an Employee's BUSINESS RESPONSIBILITY / FUNCTION (migration 1762819200000; pass8 §8.3).
//
// FOUR independent Employee facts, none derived from another (Owner: Job Role != Security Role != Functional Role):
//
//   JOB ROLE           the position (one current)                  admin.employeeJobRole.write
//   WORK ELIGIBILITY   QUALIFIED for a kind of work                admin.employeeWorkEligibility.write
//   OPERATIONAL SCOPE  WHERE the Employee works                    admin.employeeOperationalScope.write
//   FUNCTIONAL ROLE    what the Employee is RESPONSIBLE for        admin.employeeFunctionalRole.write   <- this
//
// A FUNCTIONAL ROLE GRANTS NOTHING. No capability, permission, Security Role, ownership, assignment or
// operating-company authority derives from it, and no grant table can reference it. Its one runtime consumer is the
// workflow engine, where a FUNCTIONAL_ROLE binding can only NARROW an action a Security Role capability already
// authorizes (workflowEngine.authorizeWorkflowAction).
//
// NOT the capability-granting Security Roles older prose calls "functional Roles" (cycle-count counter/reconciler,
// bin administrator, put-away operator, ...). Those are Security Roles and stay Security Roles; nothing here renames,
// reclassifies or reads them.
//
// The catalog is TENANT-OPEN (a tenant names its own responsibilities) and starts EMPTY. The one closed rule is the
// collision rule: a key may not equal -- ignoring case and punctuation -- a Security Role key of the tenant or a Work
// Eligibility code, so "assign X" can never be ambiguous between the catalogs. The database enforces it in both
// directions (functional_roles_guard, roles_key_not_functional_role).
import { WORK_ELIGIBILITY_CODES } from "./workEligibilityVocabulary";

/** The ONE capability every Functional Role mutation requires. Its own key, by the precedent of every Employee fact. */
export const EMPLOYEE_FUNCTIONAL_ROLE_WRITE = "admin.employeeFunctionalRole.write";

export const FUNCTIONAL_ROLE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"] as const);
export type FunctionalRoleStatus = (typeof FUNCTIONAL_ROLE_STATUSES)[number];

/** Audit actions. Catalog events target the Functional Role; assignment events target the Employee. */
export const FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION = "functionalRole.catalog.create";
export const FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION = "functionalRole.catalog.update";
export const FUNCTIONAL_ROLE_CATALOG_STATUS_ACTION = "functionalRole.catalog.status";
export const FUNCTIONAL_ROLE_ASSIGN_ACTION = "employee.functionalRole.assign";
export const FUNCTIONAL_ROLE_END_ACTION = "employee.functionalRole.end";
export const FUNCTIONAL_ROLE_AUDIT_TARGET_KIND = "functionalRole";

export const FUNCTIONAL_ROLE_KEY_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;
export const FUNCTIONAL_ROLE_ID_SHAPE = /^fr_[a-z0-9-]{8,64}$/;
export const MAX_FUNCTIONAL_ROLE_NAME = 100;
export const MAX_FUNCTIONAL_ROLE_DESCRIPTION = 500;
/** How far ahead an assignment may be scheduled to start. Backdating is refused: a past fact is never rewritten. */
export const MAX_FUNCTIONAL_ROLE_SCHEDULE_DAYS = 366;

/** The collision rule's one spelling: case and punctuation do not make two identities. Mirrors functional_role_key_norm. */
export const normalizeFunctionalRoleKey = (value: string): string => value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

/** The Work Eligibility codes a Functional Role key may not collide with. Derived, never retyped. */
export const FUNCTIONAL_ROLE_RESERVED_ELIGIBILITY_CODES: readonly string[] = WORK_ELIGIBILITY_CODES;

/** The reserved code this key collides with, or null. */
export function collidingEligibilityCode(key: string): string | null {
  const norm = normalizeFunctionalRoleKey(key);
  return FUNCTIONAL_ROLE_RESERVED_ELIGIBILITY_CODES.find((c) => normalizeFunctionalRoleKey(c) === norm) ?? null;
}
