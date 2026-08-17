// Employee — the human-readable label vocabulary for its two closed enums, plus the
// security-role mirror. Created for S-ADM-EMPLOYEES-DEFINITION because no canonical label
// map existed client-side for either enum — the same gap equipmentStatus.js was created to
// close, one entity over.
//
// EMPLOYMENT_STATUS (domain/constants.js) already carries the canonical MACHINE VALUES —
// ACTIVE/ON_LEAVE/INACTIVE/TERMINATED/RETIRED/CONTRACTOR (docs/specifications/
// employee-foundation.md's Data model). Nothing client-side turns any of them into words a
// person reads; domain/employees.js and every consumer render (or compare) the stored value
// verbatim. This module is that missing layer, sourced from the same enum rather than a
// second copy of it — the #1093 lesson.
//
// OPERATIONAL_ROLES HAS NO EXISTING CLIENT COPY OF THE FULL SET. domain/constants.js'
// OPERATIONAL_ROLE object carries only the three values a real eligibility check consumes
// today (PARTS_MANAGER, WAREHOUSE_MANAGER, PARTS_ASSOCIATE) — it was never meant as the
// closed vocabulary for the stored `operationalRoles[]` field itself. The actual write-time
// vocabulary is VALID_OPERATIONAL_ROLES in functions/scripts/provisionEmployeeAccess.js (the
// only writer of this collection), which accepts eight values — the same three plus
// TECHNICIAN, WAREHOUSE_ASSOCIATE, SERVICE_MANAGER, SALES_MANAGER, SALES_ASSOCIATE, five of
// which have no consumer anywhere in this client yet. Declaring only the three
// OPERATIONAL_ROLE values here would mean a stored, legally-written role (e.g.
// "SERVICE_MANAGER") has no label and no place in this enum's declared value set — an
// enumValues list narrower than what can actually be stored is its own kind of lie. All
// eight are mirrored here, by literal value (not imported — functions/ is a separate
// package/runtime from field-ops-app-vite, the same boundary salesOrder.js's server-side
// SALES_CHANNELS mirror already crosses in prose rather than in code).
//
// SECURITY_ROLE_LABEL covers `employees/{employeeId}.securityRole`, a denormalized,
// READ-ONLY mirror of `users/{uid}.role` (Inventory Operational Queue A0,
// docs/BusinessEntityModel.md Section 8a) — not a new vocabulary, just labels for the
// existing ROLES machine values (domain/constants.js), which also had none.
//
// A metadata FieldDefinition imports its enumValues/enumLabels from here. It must never
// carry a second label map of its own.

import { EMPLOYMENT_STATUS, ROLES } from "./constants.js";

export { EMPLOYMENT_STATUS, ROLES };

/** Stored value -> the words a user reads. */
export const EMPLOYMENT_STATUS_LABEL = Object.freeze({
  [EMPLOYMENT_STATUS.ACTIVE]: "Active",
  [EMPLOYMENT_STATUS.ON_LEAVE]: "On Leave",
  [EMPLOYMENT_STATUS.INACTIVE]: "Inactive",
  [EMPLOYMENT_STATUS.TERMINATED]: "Terminated",
  [EMPLOYMENT_STATUS.RETIRED]: "Retired",
  [EMPLOYMENT_STATUS.CONTRACTOR]: "Contractor",
});

/** The canonical machine values, declaration order. */
export const EMPLOYMENT_STATUS_VALUES = Object.freeze(Object.keys(EMPLOYMENT_STATUS_LABEL));

/**
 * Display text for a stored employment status.
 *
 * An unrecognised value is returned VERBATIM rather than mapped to a default — the same
 * fail-closed choice equipmentStatusLabel() makes, for the same #1093 reason.
 */
export function employmentStatusLabel(status) {
  return EMPLOYMENT_STATUS_LABEL[status] ?? status ?? "";
}

// The full write-time vocabulary for `operationalRoles[]`, mirroring
// VALID_OPERATIONAL_ROLES in functions/scripts/provisionEmployeeAccess.js — the sole writer
// of this collection. Kept in this declared order (matching the script) rather than
// alphabetized, so a diff against the script's own list stays a literal comparison.
export const OPERATIONAL_ROLES = Object.freeze([
  "PARTS_MANAGER",
  "PARTS_ASSOCIATE",
  "TECHNICIAN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_ASSOCIATE",
  "SERVICE_MANAGER",
  "SALES_MANAGER",
  "SALES_ASSOCIATE",
]);

/**
 * Stored value -> the words a user reads. Three of these (PARTS_MANAGER,
 * WAREHOUSE_MANAGER, PARTS_ASSOCIATE) already gate a real eligibility check
 * (firestore.rules' isActiveOperationalRole() call sites); the other five are reserved,
 * legally-writable values with no consumer yet — labelled all the same, since an
 * assignment picker or directory rendering an Employee with one of them must still show a
 * word, not a blank.
 */
export const OPERATIONAL_ROLE_LABEL = Object.freeze({
  PARTS_MANAGER: "Parts Manager",
  PARTS_ASSOCIATE: "Parts Associate",
  TECHNICIAN: "Technician",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  WAREHOUSE_ASSOCIATE: "Warehouse Associate",
  SERVICE_MANAGER: "Service Manager",
  SALES_MANAGER: "Sales Manager",
  SALES_ASSOCIATE: "Sales Associate",
});

/**
 * Display text for one stored operational role. Unrecognised values pass through verbatim
 * — the same fail-closed choice every other label function in this program makes.
 */
export function operationalRoleLabel(role) {
  return OPERATIONAL_ROLE_LABEL[role] ?? role ?? "";
}

/**
 * Stored value -> the words a user reads, for the `securityRole` mirror. Sourced from
 * ROLES (domain/constants.js) — the same machine values `users/{uid}.role` already uses —
 * not a fresh vocabulary.
 */
export const SECURITY_ROLE_LABEL = Object.freeze({
  [ROLES.ADMIN]: "Admin",
  [ROLES.DISPATCHER]: "Dispatcher",
  [ROLES.TECHNICIAN]: "Technician",
});

export const SECURITY_ROLE_VALUES = Object.freeze(Object.keys(SECURITY_ROLE_LABEL));

/** Display text for a stored securityRole. Unrecognised/null values pass through verbatim. */
export function securityRoleLabel(role) {
  return SECURITY_ROLE_LABEL[role] ?? role ?? "";
}
