// THE USER RECORD -- one Employee, presented as the person an administrator is looking at.
//
// ════════════════════ ONE SURFACE, SEVERAL AUTHORITIES UNDERNEATH ════════════════════
//
// Administration presents ONE destination called Users. Underneath, the concepts stay exactly as
// separate as they were, and this module is where that separation is kept honest:
//
//   employees/{employeeId}     the authoritative WORKFORCE identity -- who this person is, what
//                              they do, who they report to. Read client-direct (Rules grant
//                              admin/dispatcher a directory read). Since the copy-once cutover
//                              (#1913) PostgreSQL is the Employee authority: the Administration
//                              editor writes ONLY through the governed Workforce commands
//                              (updateEmployeeProfile, establish/endReportingRelationship,
//                              EMP-RT-W1B), never through a Firebase callable and never Firestore.
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
import { resolveOperatingCompany } from "./operatingCompanyAuthority.js";

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
 * The seventeen Employee PROFILE facts the Administration editor may submit, mirroring PROFILE_FIELD_MAP in
 * functions/src/eosWorkforce/employeeProfileVocabulary.ts -- the vocabulary the governed PostgreSQL writer
 * (updateEmployeeProfile, EMP-RT-W1A) ENFORCES. A key added here and not there is refused by name at the command
 * (400 INPUT_FIELD_NOT_ACCEPTED); the mirror is asserted by test/employeeProfileDomain.test.mjs so the two cannot drift.
 *
 * What is deliberately NOT here, and why, because each absence is a rule rather than an omission:
 *   managerEmployeeId    the reporting relationship is its own governed authority -- the editor changes it through
 *                        establishReportingRelationship / endReportingRelationship, never as a profile key
 *   employmentStatus,
 *   operatingCompanyId   Employee LIFECYCLE facts. The governed lifecycle commands are served (EMP-RT-W2) but no
 *                        control offers them yet (RUNTIME_DEPENDENCIES LIFECYCLE_WRITER in
 *                        employeeOperatingProfile.js); the editor shows them read-only
 *   operationalRoles     not part of the governed Employee record at all (Owner ruling E)
 *   securityRole, userId User Access, not Employee facts
 *
 * `kind` drives which control the form renders and nothing else. Validation is re-run server-side on every save.
 */
export const PROFILE_FIELDS = Object.freeze([
  { key: "employeeNumber", label: "Employee ID", kind: "EMPLOYEE_NUMBER" },
  { key: "displayName", label: "Display Name", kind: "TEXT" },
  { key: "firstName", label: "First Name", kind: "TEXT" },
  { key: "middleName", label: "Middle Name", kind: "TEXT" },
  { key: "lastName", label: "Last Name", kind: "TEXT" },
  { key: "preferredName", label: "Preferred Name", kind: "TEXT" },
  { key: "jobTitle", label: "Job Title", kind: "TEXT" },
  { key: "workEmail", label: "Work Email", kind: "EMAIL" },
  { key: "workPhone", label: "Work Phone", kind: "TEXT" },
  { key: "mobilePhone", label: "Mobile Phone", kind: "TEXT" },
  { key: "address.street", label: "Street", kind: "TEXT" },
  { key: "address.unit", label: "Unit / Suite", kind: "TEXT" },
  { key: "address.city", label: "City", kind: "TEXT" },
  { key: "address.state", label: "State", kind: "TEXT" },
  { key: "address.postalCode", label: "ZIP", kind: "TEXT" },
  { key: "hireDate", label: "Hire Date", kind: "DATE" },
  { key: "separationDate", label: "Separation Date", kind: "DATE" },
]);

/** The editor's Manager control. A RELATIONSHIP, written by its own commands -- never sent as a profile change. */
export const MANAGER_FIELD_KEY = "managerEmployeeId";

/**
 * Keys the editor must NEVER send to any command: lifecycle, eligibility and access facts. Stated as data so a test
 * can prove no save payload carries one, rather than trusting that nobody adds a control for it.
 */
export const NEVER_SENT_EMPLOYEE_KEYS = Object.freeze([
  "employmentStatus",
  "operatingCompanyId",
  "operationalRoles",
  "securityRole",
  "jobRole",
  "userId",
  "principalId",
  "tenantId",
  "capabilities",
]);

// The legacy audit trail (listRecordChangeHistory) still carries pre-cutover Firestore profile events for fields
// the governed editor does not write. They keep their words so an old row never renders a machine key. Declared
// as a plain map, not as editable-field entries: a label is not an editing claim.
const LEGACY_HISTORY_FIELD_LABELS = Object.freeze({
  managerEmployeeId: "Manager",
  operatingCompanyId: "Operating Company",
  employmentStatus: "Employment Status",
  operationalRoles: "Operational Roles",
});

/**
 * Machine field key -> the words a person reads, for the shared Change History component.
 *
 * Supplied BY THIS SURFACE to that component rather than living inside it -- a shared history
 * component holding an employee field map would stop being shared the moment Equipment used it.
 */
export const EMPLOYEE_FIELD_LABELS = Object.freeze({
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f.label])),
  ...LEGACY_HISTORY_FIELD_LABELS,
});

/**
 * Audit ACTION -> the words a person reads, for events that changed no single field.
 *
 * An account enable/disable, a password reset and a Role grant are real entries in this person's
 * history and have no fieldKey, so they read as what they are. Every action listed here is one the
 * existing trusted commands already write; none is invented for display.
 */
export const EMPLOYEE_EVENT_LABELS = Object.freeze({
  updateEmployeeProfile: "Profile change",
  setUserStatus: "Account Status",
  initiateAdminPasswordReset: "Password reset requested",
  deliverAdminPasswordReset: "Password reset delivery",
  revokeUserSessions: "Sessions revoked",
  // "Governed Role", never "Security Role" (Owner ruling 2026-09-06 §2). These three events write
  // roleAssignments; the Security Role on the profile is the legacy users/{uid}.role mirror and is
  // not touched by any of them. Labelling them "Security Role granted" told a reader that the row
  // above had just changed, which it had not.
  grantRole: "Governed Role granted",
  revokeRole: "Governed Role removed",
  assignApprovedRole: "Governed Role added",
});

/**
 * Field-key labels for the record's Change History.
 *
 * `governedRole` is not a stored Employee field -- it is the key the trusted read attaches to a
 * Role add/remove event so it renders in the Field / Previous / New shape (the Role arriving in
 * New, or leaving in Previous) rather than as a bare event with no subject.
 */
export const EMPLOYEE_HISTORY_FIELD_LABELS = Object.freeze({
  governedRole: "Governed Role",
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

// ════════════════════ THE EDIT PAYLOAD (the governed PostgreSQL Employee record) ════════════════════
//
// The editor works on the EMP-RT-01 readEmployee projection -- { employeeNumber, name{...}, jobTitle, contact{...},
// address{...}, hireDate, separationDate, currentManager } -- and never on the retired Firestore document shape.
// A save is at most TWO governed commands, in a fixed order: updateEmployeeProfile with only the changed profile
// keys, then, only if the Manager changed, establishReportingRelationship (a new manager) or
// endReportingRelationship (cleared). Nothing here is optimistic: the page re-reads the record after any write.

/** Where each profile key lives on the readEmployee projection. */
const PROFILE_RECORD_PATH = Object.freeze({
  employeeNumber: ["employeeNumber"],
  displayName: ["name", "displayName"],
  firstName: ["name", "firstName"],
  middleName: ["name", "middleName"],
  lastName: ["name", "lastName"],
  preferredName: ["name", "preferredName"],
  jobTitle: ["jobTitle"],
  workEmail: ["contact", "workEmail"],
  workPhone: ["contact", "workPhone"],
  mobilePhone: ["contact", "mobilePhone"],
  "address.street": ["address", "street"],
  "address.unit": ["address", "unit"],
  "address.city": ["address", "city"],
  "address.state": ["address", "state"],
  "address.postalCode": ["address", "postalCode"],
  hireDate: ["hireDate"],
  separationDate: ["separationDate"],
});

if (PROFILE_FIELDS.some((f) => !PROFILE_RECORD_PATH[f.key]) || Object.keys(PROFILE_RECORD_PATH).length !== PROFILE_FIELDS.length) {
  throw new Error("employeeProfile: PROFILE_RECORD_PATH drifted from PROFILE_FIELDS");
}

/**
 * The value of one profile key on the governed record. `name.displayName` is the STORED display name -- the
 * top-level `displayName` is derived by the read (preferred, display, first + last) and is not what a save writes.
 */
export function readProfileField(record, key) {
  const path = PROFILE_RECORD_PATH[key];
  if (!path || !record) return undefined;
  return path.reduce((node, step) => (node && typeof node === "object" ? node[step] : undefined), record);
}

/** The record's current manager id, or "" when no reporting relationship is current. */
function currentManagerId(record) {
  const id = record?.currentManager?.managerEmployeeId;
  return isBlank(id) ? "" : String(id);
}

/** Seed a form's values from the governed record: the seventeen profile keys plus the Manager, as controls need them. */
export function seedEditValues(record) {
  const values = {};
  for (const f of PROFILE_FIELDS) {
    const raw = readProfileField(record, f.key);
    // "" rather than null because a controlled input needs a string. The payload builder maps "" back to null,
    // so a cleared field is an absence and not an empty string in storage.
    values[f.key] = isBlank(raw) ? "" : String(raw);
  }
  values[MANAGER_FIELD_KEY] = currentManagerId(record);
  return values;
}

function trimmedOrNull(value) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * What actually changed among the PROFILE facts, against the record the form was SEEDED FROM -- never against a
 * re-read record.
 *
 * The reason is the one EquipmentEditModal already learned: a record whose identity changes mid-edit turns the
 * diff into a last-writer-wins overwrite of every field the form happens to be holding, silently reverting a
 * concurrent edit the user never touched. Seeded values are compared to the seed, so a difference always means
 * "the user changed it". Values are normalized the way the command normalizes them (trim, "" -> null), so a save
 * that changes only whitespace is correctly no change at all.
 *
 * Only PROFILE_FIELDS keys can appear in the result. The Manager, lifecycle and access facts cannot be expressed.
 */
export function changedProfileFields(values, base) {
  const seed = seedEditValues(base);
  const changes = {};
  for (const f of PROFILE_FIELDS) {
    const next = trimmedOrNull(values?.[f.key]);
    if (next === trimmedOrNull(seed[f.key])) continue;
    changes[f.key] = next;
  }
  return changes;
}

export const MANAGER_CHANGE = Object.freeze({ NONE: "NONE", ESTABLISH: "ESTABLISH", END: "END" });

/** Whether the Manager changed against the frozen seed, and which governed command that means. */
export function managerChange(values, base) {
  const before = currentManagerId(base);
  const after = trimmedOrNull(values?.[MANAGER_FIELD_KEY]) ?? "";
  if (after === before) return { action: MANAGER_CHANGE.NONE, managerEmployeeId: before || null };
  if (after === "") return { action: MANAGER_CHANGE.END, managerEmployeeId: null };
  return { action: MANAGER_CHANGE.ESTABLISH, managerEmployeeId: after };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Mirrors EMPLOYEE_NUMBER_PATTERN in employeeProfileVocabulary.ts, which is the ENFORCING copy; the command also
// owns the uniqueness rule this cannot check. Here so a malformed number is refused before a round trip.
const EMPLOYEE_NUMBER_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const PROFILE_TEXT_MAX = 200;

/**
 * Client-side validation.
 *
 * A USABILITY layer only. Every rule here is re-enforced by the governed command, which is the security boundary;
 * this exists so a person is told about a malformed date before a round trip, not so the client decides what is
 * acceptable. It is never STRICTER than the command, with one guard: a display name the record holds may not be
 * cleared to nothing here (a record with none stored -- its name derived from first/last -- is not blocked).
 */
export function validateProfileValues(values, base = null) {
  const errors = {};
  if (base && !isBlank(readProfileField(base, "displayName")) && trimmedOrNull(values.displayName) === null) {
    errors.displayName = "Enter a display name.";
  }
  const email = trimmedOrNull(values.workEmail);
  if (email !== null && !EMAIL_SHAPE.test(email)) {
    errors.workEmail = "Enter a valid email address.";
  }
  const employeeNumber = trimmedOrNull(values.employeeNumber);
  if (employeeNumber !== null && !EMPLOYEE_NUMBER_SHAPE.test(employeeNumber)) {
    errors.employeeNumber = "Use up to 32 letters, digits, dots, underscores or hyphens — no spaces.";
  }
  for (const key of ["hireDate", "separationDate"]) {
    const value = trimmedOrNull(values[key]);
    if (value !== null && !CALENDAR_DATE.test(value)) {
      errors[key] = "Enter a date as YYYY-MM-DD.";
    }
  }
  for (const f of PROFILE_FIELDS) {
    const value = trimmedOrNull(values[f.key]);
    if (!errors[f.key] && typeof value === "string" && value.length > PROFILE_TEXT_MAX) {
      errors[f.key] = `Use at most ${PROFILE_TEXT_MAX} characters.`;
    }
  }
  return errors;
}

// ════════════════════ THE SAVE: ONE GOVERNED COMMAND PER SUBMITTED SAVE ════════════════════
//
// A Save is ONE server transaction, whatever it changes:
//   profile only          -> updateEmployeeProfile
//   manager only          -> establishReportingRelationship / endReportingRelationship
//   profile AND manager   -> saveEmployeeEdit -- both effects and their audit events commit together, or neither does
// There is no client-side sequencing of two writes, no compensation, and no partial-success outcome.

export const EMPLOYEE_EDIT_RESULT = Object.freeze({
  /** Nothing differed from the seed; no command was called. */
  NOTHING_CHANGED: "NOTHING_CHANGED",
  /** The one command called succeeded (an UPDATED/CHANGED or a NO_CHANGE convergence). */
  SAVED: "SAVED",
  /** The command was refused or failed. Nothing was written. */
  NOT_SAVED: "NOT_SAVED",
  /** The command's result is unknown (the service could not be reached). Not confirmed either way. */
  NOT_CONFIRMED: "NOT_CONFIRMED",
});

/**
 * Run the save against the injected Workforce client (`{ call(operation, input) }`). Never throws.
 *
 * The input carries ONLY { employeeId, changes } and the manager intent -- never a tenant, principal, capability or
 * lifecycle field. Exactly one command is called per Save.
 */
export async function saveEmployeeEdit({ workforce, employeeId, changes, manager }) {
  const profileKeys = Object.keys(changes ?? {}).filter((k) => PROFILE_RECORD_PATH[k]);
  const managerAction = manager?.action ?? MANAGER_CHANGE.NONE;
  const result = { profile: null, manager: null, managerAction };
  if (profileKeys.length === 0 && managerAction === MANAGER_CHANGE.NONE) return { ...result, state: EMPLOYEE_EDIT_RESULT.NOTHING_CHANGED };

  const call = async (operation, input) => {
    try {
      const outcome = await workforce.call(operation, input);
      return outcome && typeof outcome === "object" ? outcome : { ok: false, code: "INTERNAL" };
    } catch {
      return { ok: false, code: "INTERNAL" };
    }
  };
  const failed = (outcome, part) => ({
    ...result, [part]: outcome, failedPart: part,
    state: outcome.code === "UNREACHABLE" ? EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED : EMPLOYEE_EDIT_RESULT.NOT_SAVED,
  });
  const sent = Object.fromEntries(profileKeys.map((k) => [k, changes[k]]));

  if (profileKeys.length > 0 && managerAction !== MANAGER_CHANGE.NONE) {
    const managerInput = managerAction === MANAGER_CHANGE.ESTABLISH
      ? { action: "ESTABLISH", managerEmployeeId: manager.managerEmployeeId }
      : { action: "END" };
    const combined = await call("saveEmployeeEdit", { employeeId, changes: sent, manager: managerInput });
    if (!combined.ok) return failed(combined, MANAGER_FAILURE_REASONS.has(combined.reason) ? "manager" : "profile");
    return {
      ...result,
      profile: { ok: true, result: combined.result?.profile },
      manager: { ok: true, result: combined.result?.manager },
      state: EMPLOYEE_EDIT_RESULT.SAVED,
    };
  }
  if (profileKeys.length > 0) {
    const profile = await call("updateEmployeeProfile", { employeeId, changes: sent });
    return profile.ok ? { ...result, profile, state: EMPLOYEE_EDIT_RESULT.SAVED } : failed(profile, "profile");
  }
  const managerOutcome = managerAction === MANAGER_CHANGE.ESTABLISH
    ? await call("establishReportingRelationship", { employeeId, managerEmployeeId: manager.managerEmployeeId })
    : await call("endReportingRelationship", { employeeId });
  return managerOutcome.ok ? { ...result, manager: managerOutcome, state: EMPLOYEE_EDIT_RESULT.SAVED } : failed(managerOutcome, "manager");
}

/** Server refusal reasons that are about the manager part of a Save (so the sentence names the manager). */
const MANAGER_FAILURE_REASONS = new Set(["MANAGER_NOT_FOUND", "REPORTING_RELATIONSHIP_NOT_FOUND", "REPORTING_SELF_MANAGER", "REPORTING_CONCURRENT_CHANGE"]);

/** A profile command failure, as a sentence. */
function profileFailureWords(error) {
  switch (error?.code) {
    case "FORBIDDEN":
      return "You are not authorized to edit this Employee.";
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return "Your sign-in could not be verified by the Employee service. Sign in again.";
    case "NOT_FOUND":
      return "This Employee record could not be found.";
    case "CONFLICT":
      return error?.reason === "EMPLOYEE_NUMBER_TAKEN"
        ? "That Employee ID is already held by another Employee. Choose a different one."
        : "The Employee record changed while this save was running. Review the record and try again.";
    case "INVALID_INPUT":
      return error?.message ? `The Employee service refused the change: ${error.message}.` : "The Employee service refused the change.";
    case "NOT_CONFIGURED":
      return "The EOS Workforce service is not configured for this environment.";
    case "UNREACHABLE":
      return "The Employee service could not be reached, so this save is not confirmed. Reload the record to see what is stored.";
    default:
      return "The Employee service could not complete the change.";
  }
}

/** A reporting-relationship command failure, as a clause. */
function managerFailureWords(error) {
  switch (error?.reason) {
    case "MANAGER_NOT_FOUND":
      return "the chosen manager is not an Employee of this company";
    case "REPORTING_RELATIONSHIP_NOT_FOUND":
      return "this Employee no longer has a current manager to remove";
    case "REPORTING_SELF_MANAGER":
      return "an Employee cannot be their own manager";
    case "REPORTING_CONCURRENT_CHANGE":
      return "the reporting relationship changed at the same time — review it and try again";
    default:
      break;
  }
  switch (error?.code) {
    case "FORBIDDEN":
      return "you are not authorized to change this Employee's manager";
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return "your sign-in could not be verified by the Employee service";
    case "NOT_FOUND":
      return "the Employee or the chosen manager could not be found";
    case "CONFLICT":
      return "the reporting relationship changed at the same time — review it and try again";
    case "INVALID_INPUT":
      return error?.message ? `the Employee service refused it: ${error.message}` : "the Employee service refused it";
    case "NOT_CONFIGURED":
      return "the EOS Workforce service is not configured for this environment";
    case "UNREACHABLE":
      return "the Employee service could not be reached";
    default:
      return "the Employee service could not complete it";
  }
}

const listWords = (labels) => labels.join(", ");

/**
 * The save result in words: { state, words, reload }. `reload` is true whenever something MAY have been written,
 * so the page re-reads the authoritative record instead of rendering what was typed.
 *
 * It never claims more than the command returned. One Save is one transaction, so a refusal always means nothing was saved.
 */
export function describeEmployeeEditResult(saved) {
  const state = saved?.state;
  const updated = saved?.profile?.ok ? saved.profile.result?.outcome === "UPDATED" : false;
  const changedLabels = updated
    ? (Array.isArray(saved.profile.result?.changedFields) ? saved.profile.result.changedFields : []).map((k) => EMPLOYEE_FIELD_LABELS[k] ?? k)
    : [];
  switch (state) {
    case EMPLOYEE_EDIT_RESULT.NOTHING_CHANGED:
      return { state, words: "Nothing was changed.", reload: false };
    case EMPLOYEE_EDIT_RESULT.NOT_SAVED:
    case EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED: {
      const outcome = saved[saved.failedPart] ?? {};
      if (saved.failedPart === "profile") {
        const words = profileFailureWords(outcome);
        return { state, words: state === EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED ? words : `${words} Nothing was saved.`, reload: false };
      }
      const clause = managerFailureWords(outcome);
      if (state === EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED) {
        return { state, words: `This save is not confirmed: ${clause}. Reload the record to see what is stored.`, reload: false };
      }
      return { state, words: `Nothing was saved: ${clause}.`, reload: false };
    }
    case EMPLOYEE_EDIT_RESULT.SAVED: {
      const parts = [...changedLabels];
      const managerOutcome = saved.manager?.ok ? saved.manager.result?.outcome : null;
      if (managerOutcome && managerOutcome !== "NO_CHANGE") parts.push("Manager");
      if (parts.length === 0) {
        return { state, words: "Nothing needed saving: the Employee record already holds these values.", reload: true };
      }
      return { state, words: `Saved: ${listWords(parts)}. The record below is re-read from the Employee authority.`, reload: true };
    }
    default:
      return { state: EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED, words: "The save could not be confirmed. Reload the record to see what is stored.", reload: false };
  }
}
