// THE USER RECORD -- one Employee, presented as the person an administrator is looking at.
//
// ════════════════════ ONE SURFACE, SEVERAL AUTHORITIES UNDERNEATH ════════════════════
//
// Administration presents ONE destination called Users. Underneath, the concepts stay exactly as
// separate as they were, and this module is where that separation is kept honest:
//
//   employees/{employeeId}     the authoritative WORKFORCE identity -- who this person is, what
//                              they do, who they report to. Read client-direct (Rules grant
//                              admin/dispatcher a directory read); written ONLY by the trusted
//                              updateEmployeeProfile command.
//   operationalRoles[]         what an employee IS ELIGIBLE TO DO operationally. Never a security
//                              grant -- firestore.rules' isActiveOperationalRole() is an
//                              additional condition on a permission, never a permission itself.
//   securityRole               a denormalized, READ-ONLY mirror of users/{uid}.role. Rendered as
//                              a mirror, labelled as a mirror, and editable nowhere.
//   users/{uid} + Auth         application-access identity and account enable/disable. Not
//                              readable by this client at all (Rules allow a self-read only), and
//                              writable only by the setUserStatus trusted command.
//
// The product invariants that follow from this are not styling choices. Employment Status does not
// switch access on or off. Operational Roles do not change Security Role. A job title determines
// nothing. Nothing in this file derives any one of them from any other, and the edit payload
// builder below cannot express such a derivation.
//
// PURE. No React, no Firebase.
import {
  EMPLOYMENT_STATUS_VALUES,
  OPERATIONAL_ROLES,
  employmentStatusLabel,
  operationalRoleLabel,
  securityRoleLabel,
} from "./employeeVocabulary.js";
import { newIdempotencyKey } from "./adminPasswordReset.js";
import { ABSENCE, FIELD_KIND, field, statusField } from "./structuredFields.js";
import { resolveOperatingCompany, OPERATING_COMPANIES } from "./operatingCompanyAuthority.js";

export { EMPLOYMENT_STATUS_VALUES, OPERATIONAL_ROLES };

/** The audit trail's targetType for an Employee record. Matches EMPLOYEE_TARGET_TYPE server-side. */
export const EMPLOYEE_TARGET_TYPE = "employee";

/**
 * An idempotency key the Issue #226 trusted commands will accept.
 *
 * newIdempotencyKey() produces the reset command's alphabet ([A-Za-z0-9._:-]); the trusted-writer
 * commands accept a NARROWER one ([A-Za-z0-9_-]). One generator, one narrowing, in one place --
 * two call sites each doing their own regex is how one of them ends up producing keys the server
 * rejects only under a value nobody tested.
 */
export function newTrustedIdempotencyKey() {
  return newIdempotencyKey().replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * Every field the Edit User form may submit, mirroring EDITABLE_EMPLOYEE_FIELDS in
 * functions/src/access/employeeProfileCommands.ts -- which is the ENFORCING copy. A key added here
 * and not there is rejected by name at the command; the mirror is asserted by
 * test/employeeProfileContract.test.mjs so the two cannot drift silently.
 *
 * `kind` drives which control the form renders and nothing else. Validation is re-run server-side
 * on every save regardless of what this says.
 */
export const EDITABLE_FIELDS = Object.freeze([
  { key: "displayName", label: "Display Name", kind: "TEXT", required: true },
  { key: "firstName", label: "First Name", kind: "TEXT" },
  { key: "middleName", label: "Middle Name", kind: "TEXT" },
  { key: "lastName", label: "Last Name", kind: "TEXT" },
  { key: "preferredName", label: "Preferred Name", kind: "TEXT" },
  { key: "employeeNumber", label: "Employee ID", kind: "TEXT" },
  { key: "workEmail", label: "Work Email", kind: "EMAIL" },
  { key: "workPhone", label: "Work Phone", kind: "TEXT" },
  { key: "mobilePhone", label: "Mobile Phone", kind: "TEXT" },
  { key: "address.street", label: "Street", kind: "TEXT" },
  { key: "address.unit", label: "Unit / Suite", kind: "TEXT" },
  { key: "address.city", label: "City", kind: "TEXT" },
  { key: "address.state", label: "State", kind: "TEXT" },
  { key: "address.postalCode", label: "ZIP", kind: "TEXT" },
  { key: "jobTitle", label: "Job Title", kind: "TEXT" },
  { key: "managerEmployeeId", label: "Manager", kind: "MANAGER" },
  { key: "operatingCompanyId", label: "Operating Company", kind: "OPERATING_COMPANY" },
  { key: "hireDate", label: "Hire Date", kind: "DATE" },
  { key: "separationDate", label: "Separation Date", kind: "DATE" },
  { key: "employmentStatus", label: "Employment Status", kind: "EMPLOYMENT_STATUS", required: true },
  { key: "operationalRoles", label: "Operational Roles", kind: "OPERATIONAL_ROLES" },
]);

/**
 * Machine field key -> the words a person reads, for the shared Change History component.
 *
 * Supplied BY THIS SURFACE to that component rather than living inside it -- a shared history
 * component holding an employee field map would stop being shared the moment Equipment used it.
 */
export const EMPLOYEE_FIELD_LABELS = Object.freeze(
  Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f.label])),
);

/**
 * Audit ACTION -> the words a person reads, for events that changed no single field.
 *
 * An account enable/disable, a password reset and a Role grant are real entries in this person's
 * history and have no fieldKey, so they read as what they are. Every action listed here is one the
 * existing trusted commands already write; none is invented for display.
 */
export const EMPLOYEE_EVENT_LABELS = Object.freeze({
  updateEmployeeProfile: "Profile change",
  setUserStatus: "EOS Access Status",
  initiateAdminPasswordReset: "Password reset requested",
  deliverAdminPasswordReset: "Password reset delivery",
  revokeUserSessions: "Sessions revoked",
  grantRole: "Security Role granted",
  revokeRole: "Security Role revoked",
  assignApprovedRole: "Security Role assigned",
});

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** The value at a possibly-dotted key, matching the command's own `readAt`. */
export function readField(employee, key) {
  if (!employee) return undefined;
  if (!key.includes(".")) return employee[key];
  const [head, tail] = key.split(".");
  const nested = employee[head];
  return nested && typeof nested === "object" ? nested[tail] : undefined;
}

/**
 * The person's name.
 *
 * `displayName` is this collection's declared human reference and the only name every write path
 * sets. A record without one renders a truthful generic name -- NEVER the document id, which is
 * the fallback DECISIONS #106 forbids and which this function structurally cannot produce because
 * it is never passed one.
 */
export function employeeDisplayName(employee) {
  const preferred = employee?.preferredName;
  if (!isBlank(preferred)) return String(preferred).trim();
  const name = employee?.displayName;
  return isBlank(name) ? "Unnamed employee" : String(name).trim();
}

/** True when the record carries no human name at all -- the caller renders the generic one. */
export function employeeNameIsAbsent(employee) {
  return isBlank(employee?.preferredName) && isBlank(employee?.displayName);
}

/**
 * The header's subtitle: what they do, and their business Employee ID where one exists.
 *
 * `employeeNumber`, NOT `employeeId`. The document id is a technical identifier and the employee
 * specification says so in its own words ("doc ID, technical, immutable -- never a name");
 * presenting it as Taylor's Employee ID would teach people to quote a Firestore key on the phone.
 * A record with no employeeNumber shows none -- old records legitimately have none, and inventing
 * numbers for them would be fabricating business data.
 */
export function employeeSubtitle(employee) {
  const parts = [];
  if (!isBlank(employee?.jobTitle)) parts.push(String(employee.jobTitle).trim());
  if (!isBlank(employee?.employeeNumber)) parts.push(`Employee ${String(employee.employeeNumber).trim()}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The operating company's display name, or null. Resolved through the governed authority. */
export function employeeCompanyName(employee) {
  const resolved = resolveOperatingCompany(employee?.operatingCompanyId ?? null);
  return resolved.company?.displayName ?? null;
}

export const OPERATING_COMPANY_OPTIONS = Object.freeze(
  OPERATING_COMPANIES.filter((c) => c.active).map((c) => ({ value: c.id, label: c.displayName })),
);

// ════════════════════ EOS ACCESS -- THE HONEST STATE ════════════════════
//
// "Is this person's EOS account enabled or disabled" is Firebase Auth state. NOTHING in this
// client can read it: firestore.rules allows a signed-in user to read users/{uid} only for their
// OWN uid, and no governed target-user read exists for anyone else's. The password-reset candidate
// listing is not it either -- it is scoped and audited for credential-reset eligibility
// specifically, and reusing it to populate a directory column would write a false action into the
// immutable trail.
//
// What the employee record CAN prove is the LINKAGE: whether this person has an application
// identity at all (`userId`). So that is what is shown, under its own words, and the account's
// enabled/disabled state is reported as unavailable rather than guessed from employment status --
// which would be the exact conflation this product forbids (a CONTRACTOR who legitimately holds
// access would be shown as switched off).
export const EOS_ACCESS = Object.freeze({
  NO_ACCOUNT: "NO_ACCOUNT",
  LINKED: "LINKED",
});

export const EOS_ACCESS_LABEL = Object.freeze({
  [EOS_ACCESS.NO_ACCOUNT]: "No account",
  [EOS_ACCESS.LINKED]: "Account linked",
});

export const EOS_ACCESS_STATE_UNAVAILABLE =
  "Whether this account is enabled or disabled is Firebase Auth state. No governed read of another user's account status exists yet, so it is not shown rather than guessed.";

export function eosAccessState(employee) {
  return isBlank(employee?.userId) ? EOS_ACCESS.NO_ACCOUNT : EOS_ACCESS.LINKED;
}

export function eosAccessLabel(employee) {
  return EOS_ACCESS_LABEL[eosAccessState(employee)];
}

// ════════════════════ THE RECORD'S FIELDS, BY SECTION ════════════════════
//
// Each returns structuredFields rows, so absence renders as which KIND of absence it is rather
// than as a blank cell -- "not recorded" and "not available to you" are different facts about a
// person's record and a reader acts differently on each.

export function identityFields(employee) {
  return [
    field({ label: "First Name", value: employee?.firstName, priority: 1 }),
    field({ label: "Middle Name", value: employee?.middleName, priority: 3 }),
    field({ label: "Last Name", value: employee?.lastName, priority: 1 }),
    field({ label: "Preferred Name", value: employee?.preferredName, priority: 2 }),
    field({
      label: "Employee ID",
      value: employee?.employeeNumber,
      kind: FIELD_KIND.IDENTIFIER,
      priority: 1,
    }),
    field({ label: "Work Email", value: employee?.workEmail, priority: 1 }),
    field({ label: "Work Phone", value: employee?.workPhone, priority: 2 }),
    field({ label: "Mobile Phone", value: employee?.mobilePhone, priority: 2 }),
    field({ label: "Street", value: readField(employee, "address.street"), priority: 3 }),
    field({ label: "Unit / Suite", value: readField(employee, "address.unit"), priority: 3 }),
    field({ label: "City", value: readField(employee, "address.city"), priority: 3 }),
    field({ label: "State", value: readField(employee, "address.state"), priority: 3 }),
    field({ label: "ZIP", value: readField(employee, "address.postalCode"), priority: 3 }),
  ];
}

/**
 * Employment.
 *
 * Manager is deliberately NOT here: it is a RELATIONSHIP, and the record page renders it as a link
 * to that person's own User Detail. A definition list cell cannot carry a link, and flattening a
 * governed employee reference into display text is how a manager name becomes unfollowable and,
 * eventually, stale.
 */
export function employmentFields(employee) {
  return [
    statusField(employee?.employmentStatus, { label: "Employment Status", priority: 1 }),
    field({ label: "Job Title", value: employee?.jobTitle, priority: 1 }),
    field({
      label: "Operating Company",
      value: employeeCompanyName(employee),
      raw: employee?.operatingCompanyId ?? null,
      // A recorded-but-unresolvable company id is UNAVAILABLE, not "not recorded" -- the record
      // says something we could not resolve, which is a different fact from saying nothing.
      absence: isBlank(employee?.operatingCompanyId) ? ABSENCE.NOT_RECORDED : ABSENCE.UNRESOLVED,
      priority: 2,
    }),
    field({ label: "Hire Date", value: employee?.hireDate, kind: FIELD_KIND.DATE, priority: 2 }),
    field({
      label: "Separation Date",
      value: employee?.separationDate,
      kind: FIELD_KIND.DATE,
      priority: 3,
    }),
  ];
}

/** The employment-status word, for the identity header's status treatment. */
export function employmentStatusWords(employee) {
  return isBlank(employee?.employmentStatus) ? null : employmentStatusLabel(employee.employmentStatus);
}

export function employmentStatusTone(employee) {
  switch (employee?.employmentStatus) {
    case "ACTIVE":
      return "positive";
    case "ON_LEAVE":
    case "CONTRACTOR":
      return "info";
    case "TERMINATED":
    case "RETIRED":
    case "INACTIVE":
      return "neutral";
    default:
      return "neutral";
  }
}

/** The operational roles, as words. An employee with none holds none -- that is a real answer. */
export function operationalRoleLabels(employee) {
  const roles = Array.isArray(employee?.operationalRoles) ? employee.operationalRoles : [];
  return roles.map(operationalRoleLabel);
}

export const OPERATIONAL_ROLE_OPTIONS = Object.freeze(
  OPERATIONAL_ROLES.map((value) => ({ value, label: operationalRoleLabel(value) })),
);

export const EMPLOYMENT_STATUS_OPTIONS = Object.freeze(
  EMPLOYMENT_STATUS_VALUES.map((value) => ({ value, label: employmentStatusLabel(value) })),
);

/**
 * The Security Role, presented for exactly what it is.
 *
 * `securityRole` on the employee document is a denormalized mirror of users/{uid}.role, holding
 * only the three legacy values. It is NOT the governed Role, and an employee showing "dispatcher"
 * here may hold a different governed Role entirely. Saying so in the caption is the whole
 * difference between a useful column and a confident wrong claim.
 */
export const SECURITY_ROLE_MIRROR_CAPTION =
  "Mirrors the legacy identity role (admin, dispatcher, technician), not the governed Role this person holds.";

export function securityRoleWords(employee) {
  return isBlank(employee?.securityRole) ? null : securityRoleLabel(employee.securityRole);
}

// ════════════════════ THE EDIT PAYLOAD ════════════════════

/** Seed a form's values from a record: every editable key, as the control needs it. */
export function seedEditValues(employee) {
  const values = {};
  for (const f of EDITABLE_FIELDS) {
    const raw = readField(employee, f.key);
    if (f.kind === "OPERATIONAL_ROLES") {
      values[f.key] = Array.isArray(raw) ? [...raw] : [];
    } else {
      // "" rather than null because a controlled input needs a string. The payload builder maps
      // "" back to null, so a cleared field is an absence and not an empty string in storage.
      values[f.key] = isBlank(raw) ? "" : String(raw);
    }
  }
  return values;
}

function sameSeededValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * What actually changed, against the record the form was SEEDED FROM -- never against a live
 * subscription.
 *
 * The reason is the one EquipmentEditModal already learned: a live record whose identity changes
 * mid-edit turns the diff into a last-writer-wins overwrite of every field the form happens to be
 * holding, silently reverting a concurrent edit the user never touched. Seeded values are compared
 * to the seed, so a difference always means "the user changed it".
 *
 * Values are normalized the same way the command normalizes them (trim, "" -> null, roles in
 * declared order), so a save that changes only whitespace is correctly no change at all.
 */
export function changedProfileFields(values, base) {
  const seed = seedEditValues(base);
  const changes = {};
  for (const f of EDITABLE_FIELDS) {
    const next = values[f.key];
    if (sameSeededValue(normalizeForCompare(f, next), normalizeForCompare(f, seed[f.key]))) continue;
    changes[f.key] = f.kind === "OPERATIONAL_ROLES" ? normalizeRoles(next) : trimmedOrNull(next);
  }
  return changes;
}

function normalizeRoles(value) {
  const chosen = new Set(Array.isArray(value) ? value : []);
  return OPERATIONAL_ROLES.filter((r) => chosen.has(r));
}

function trimmedOrNull(value) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeForCompare(f, value) {
  return f.kind === "OPERATIONAL_ROLES" ? normalizeRoles(value) : trimmedOrNull(value);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Client-side validation.
 *
 * A USABILITY layer only. Every rule here is re-enforced by the trusted command, which is the
 * security boundary; this exists so a person is told about a malformed date before a round trip,
 * not so the client decides what is acceptable.
 */
export function validateProfileValues(values) {
  const errors = {};
  if (trimmedOrNull(values.displayName) === null) {
    errors.displayName = "Enter a display name.";
  }
  if (trimmedOrNull(values.employmentStatus) === null) {
    errors.employmentStatus = "Choose an employment status.";
  } else if (!EMPLOYMENT_STATUS_VALUES.includes(values.employmentStatus)) {
    errors.employmentStatus = "Choose an employment status from the list.";
  }
  const email = trimmedOrNull(values.workEmail);
  if (email !== null && !EMAIL_SHAPE.test(email)) {
    errors.workEmail = "Enter a valid email address.";
  }
  for (const key of ["hireDate", "separationDate"]) {
    const value = trimmedOrNull(values[key]);
    if (value !== null && !CALENDAR_DATE.test(value)) {
      errors[key] = "Enter a date as YYYY-MM-DD.";
    }
  }
  const roles = Array.isArray(values.operationalRoles) ? values.operationalRoles : [];
  if (roles.some((r) => !OPERATIONAL_ROLES.includes(r))) {
    errors.operationalRoles = "Choose operational roles from the list.";
  }
  return errors;
}
