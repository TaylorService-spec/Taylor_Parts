// SEC-ROSTER-01 (2026-11-15). Kept OUTSIDE eosWorkforce/reads on purpose: the Workforce reads are fenced from naming any
// Job Role or Security Role (employeeRuntimeReads.test.mjs), and one of these keys administers Job Roles. The reads import
// the set, they do not spell it.
/**
 * THE PEOPLE-ADMINISTRATION KEYS: the existing keys that ADMINISTER an Employee's access, profile, Job Role, Operational
 * Scope, Work Eligibility or Functional Roles. Holding ANY of them is what reads another Employee's Work Eligibility and
 * Operational Scope (the dedicated reads and the roster columns) and opens Administration -> Users. employee.record.read
 * alone (the directory read) does neither. Asserted equal to the administration.users door by test.
 */
export const PEOPLE_ADMINISTRATION_KEYS: readonly string[] = Object.freeze([
  "admin.principalAccess.read", "admin.employeeProfile.write", "admin.employeeJobRole.write", "admin.employeeOperationalScope.write",
  "admin.employeeWorkEligibility.write", "admin.employeeFunctionalRole.write",
]);

export function holdsPeopleAdministration(capabilities: ReadonlySet<string>): boolean {
  return PEOPLE_ADMINISTRATION_KEYS.some((k) => capabilities.has(k));
}

