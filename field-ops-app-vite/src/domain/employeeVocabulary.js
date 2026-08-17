// Employee — the human-readable label vocabulary for its three closed enums.
//
// domain/constants.js already carries the canonical MACHINE VALUES for all three
// (EMPLOYMENT_STATUS, OPERATIONAL_ROLE, ROLES) — it needs them for Rules-mirroring client
// logic (useAssignableEmployees.js's VALID_SECURITY_ROLES, firestore.rules'
// isActiveOperationalRole()). What it does NOT carry is a word for any of them: nothing in
// this client has ever turned "ON_LEAVE" or "WAREHOUSE_MANAGER" into something a person
// reads — S-ADM-EMPLOYEES-DEFINITION's own scouting (grep across src/) found zero existing
// label maps for any of the three. This module is that missing layer, sourced from the
// same values rather than a second copy of them — the #1093 lesson (a label map that
// drifts from the values it labels is how "0 Active" ends up beside a table of ACTIVE
// rows), mirroring how partVocabulary.js bundles several enums for one entity in one file
// rather than one file per enum.
//
// A metadata FieldDefinition imports its enumValues and enumLabels from here. It must
// never carry a second label map of its own — that is exactly the mistake this file
// exists to stop repeating.
//
// ROLES IS employees.securityRole'S VOCABULARY, NOT users.role's alone. ROLES
// (domain/constants.js) already names the three security roles the whole app uses
// (admin/dispatcher/technician); this module labels the SAME three values for their
// second, denormalized appearance on employees/{employeeId}.securityRole (the read-only
// mirror provisionEmployeeAccess.js writes — see that script's SECURITY-ROLE MIRROR
// note). One vocabulary, two storage locations; not two vocabularies.

import { EMPLOYMENT_STATUS, OPERATIONAL_ROLE, ROLES } from "./constants.js";

export { EMPLOYMENT_STATUS, OPERATIONAL_ROLE, ROLES };

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

export const OPERATIONAL_ROLE_LABEL = Object.freeze({
  [OPERATIONAL_ROLE.PARTS_MANAGER]: "Parts Manager",
  [OPERATIONAL_ROLE.WAREHOUSE_MANAGER]: "Warehouse Manager",
  [OPERATIONAL_ROLE.PARTS_ASSOCIATE]: "Parts Associate",
});

export const OPERATIONAL_ROLE_VALUES = Object.freeze(Object.keys(OPERATIONAL_ROLE_LABEL));

/**
 * The security-role mirror's label map. Stored values are already lowercase words
 * ("admin", "dispatcher", "technician") — labelled here (not left unlabelled) purely for
 * the #1093 machine-value/display-label separation the whole program enforces; the words
 * themselves barely change.
 */
export const SECURITY_ROLE_LABEL = Object.freeze({
  [ROLES.ADMIN]: "Admin",
  [ROLES.DISPATCHER]: "Dispatcher",
  [ROLES.TECHNICIAN]: "Technician",
});

export const SECURITY_ROLE_VALUES = Object.freeze(Object.keys(SECURITY_ROLE_LABEL));

/**
 * Display text for a stored employment status.
 *
 * An unrecognised value is returned VERBATIM rather than mapped to a default — the same
 * fail-closed choice equipmentStatusLabel() makes, for the same reason: a status this
 * vocabulary does not know about is a data question, and silently relabelling it would
 * hide exactly the kind of mismatch #1093 was.
 */
export function employmentStatusLabel(status) {
  return EMPLOYMENT_STATUS_LABEL[status] ?? status ?? "";
}
