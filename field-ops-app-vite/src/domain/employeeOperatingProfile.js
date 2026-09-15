// EMPLOYEE OPERATING PROFILE (NS2-EMP-05a / NS2-EMP-10, Employee design v4.1) -- the pure layer.
//
// ════════════════════ WHAT THIS MODULE DECIDES ════════════════════
//
// The Employee v4.1 design (docs/atlas/inputs/employee-v4.1/NS2-EMP Profile r1.dc.html on atlas/employee-v41-input)
// asks the profile: who EOS says this person is, whether they are a current Employee, which company they work for,
// how their User Access relates to them, and what they own, are accountable for and are assigned. Since #1913 those
// answers come from the governed PostgreSQL Workforce transport (POST /workforce/employees). This module turns the
// transport's projections and refusals into words, and names the facts that are still NOT served.
//
// The fixed model, none of it a styling choice:
//
//   EMPLOYEE      != USER ACCESS    an Employee may exist with no login; a login may exist with no Employee.
//   CREDENTIAL    != PRINCIPAL != EMPLOYEE   (CREDENTIAL -> PRINCIPAL -> governed EMPLOYEE LINK -> EMPLOYEE)
//   JOB ROLE      != SECURITY ROLE  Job Role has no governed authority: NOT GOVERNED, never inferred from the
//                                   Security Role, eligibility markers, title or department. Retail Sales and
//                                   National Accounts Sales are never one generic Sales role.
//   RECORD OWNER  != ACCOUNTABLE PERSON != ASSIGNED PERSON   three axes, three reads, three states.
//
// PURE. No React, no Firebase, no network.
import { EMPLOYMENT_STATUS_VALUES, employmentStatusLabel } from "./employeeVocabulary.js";
import { ABSENCE, FIELD_KIND, field } from "./structuredFields.js";
import { resolveOperatingCompany } from "./operatingCompanyAuthority.js";

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// ════════════════════ SERVED READS AND REMAINING RUNTIME DEPENDENCIES ════════════════════

/** The governed Workforce reads this profile consumes, by design id. */
export const WORKFORCE_READS = Object.freeze({
  EMPLOYEE_RECORD: Object.freeze({ id: "EMP-RT-01", operation: "readEmployee" }),
  PRINCIPAL_LINK: Object.freeze({ id: "EMP-RT-02", operation: "readEmployeePrincipalLink" }),
  OWNED_RECORDS: Object.freeze({ id: "EMP-RT-03", operation: "listRecordsOwnedByEmployee" }),
  ACCOUNTABILITIES: Object.freeze({ id: "EMP-RT-04", operation: "listAccountabilitiesForEmployee" }),
  MANAGED_EMPLOYEES: Object.freeze({ id: "EMP-RT-06", operation: "listManagedEmployees" }),
  MY_PROFILE: Object.freeze({ id: "EMP-RT-07", operation: "readMyEmployeeProfile" }),
});

export const EMPLOYEE_RUNTIME_DEPENDENCY = "EMPLOYEE_RUNTIME_DEPENDENCY";

/** Facts the design needs that no governed read serves. Each renders as a named, truthful unavailable state. */
export const RUNTIME_DEPENDENCIES = Object.freeze({
  ASSIGNED_WORK_READ: Object.freeze({
    id: "EMP-RT-05",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    serverReason: "ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES",
    fact: "Work assigned to this Employee",
    today:
      "Work assignment authority is not in PostgreSQL, so the Workforce service does not serve assigned work. EOS does not guess it from technician or user ids.",
    requiredApi:
      "Governed read listAssignedWorkForEmployee { employeeId }, over a PostgreSQL assignment authority and a governed Employee ↔ Technician projection.",
  }),
  JOB_ROLE_AUTHORITY: Object.freeze({
    id: "EMP-RT-08",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    serverReason: "JOB_ROLE_AUTHORITY_NOT_IMPLEMENTED",
    fact: "Job Role",
    today:
      "No governed Job Role authority exists. Which Job Roles exist -- including Retail Sales and National Accounts Sales as two separate roles -- is not yet governed.",
    requiredApi:
      "Governed Job Role authority and read listEmployeeJobRoles { employeeId } (requires the Owner's Job Role vocabulary decision first).",
  }),
  PROFILE_WRITER: Object.freeze({
    id: "EMP-RT-W1",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    serverReason: "PROFILE_WRITER_NOT_SERVED",
    fact: "Editing the Employee record",
    today:
      "PostgreSQL is the Employee profile authority after the copy-once cutover, and no governed PostgreSQL profile writer is served. The legacy writer updates the retired Firestore record, which this page no longer reads, so it is not offered here.",
    requiredApi: "Governed Workforce command updateEmployeeProfile { employeeId, changes, idempotencyKey } over eos_workforce.employees, audited in PostgreSQL.",
  }),
  EMPLOYEE_HISTORY_READ: Object.freeze({
    id: "EMP-RT-H1",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    serverReason: "EMPLOYEE_HISTORY_NOT_SERVED",
    fact: "Governed Employee change history",
    today:
      "The change history below is the legacy audit trail (pre-cutover profile changes and account/Role events). No governed PostgreSQL Employee history read is served yet.",
    requiredApi: "Governed read listEmployeeChangeHistory { employeeId } over eos_policy.audit_events for the Employee record.",
  }),
});

// ════════════════════ LIFECYCLE ════════════════════

export const LIFECYCLE_STANDING = Object.freeze({
  CURRENT: "CURRENT",
  NOT_CURRENTLY_ACTIVE: "NOT_CURRENTLY_ACTIVE",
  FORMER: "FORMER",
  UNRECOGNISED: "UNRECOGNISED",
  NOT_RECORDED: "NOT_RECORDED",
});

export const EMPLOYEE_LIFECYCLE = Object.freeze({
  ACTIVE: Object.freeze({ value: "ACTIVE", standing: LIFECYCLE_STANDING.CURRENT, tone: "positive", meaning: "Current Employee." }),
  ON_LEAVE: Object.freeze({ value: "ON_LEAVE", standing: LIFECYCLE_STANDING.CURRENT, tone: "info", meaning: "Current Employee, on leave. Not a former Employee." }),
  INACTIVE: Object.freeze({ value: "INACTIVE", standing: LIFECYCLE_STANDING.NOT_CURRENTLY_ACTIVE, tone: "neutral", meaning: "Not currently active. Distinct from Terminated." }),
  TERMINATED: Object.freeze({ value: "TERMINATED", standing: LIFECYCLE_STANDING.FORMER, tone: "neutral", meaning: "Former Employee. The record and its history remain available." }),
  RETIRED: Object.freeze({ value: "RETIRED", standing: LIFECYCLE_STANDING.FORMER, tone: "neutral", meaning: "Former Employee, retired. The record and its history remain available." }),
  CONTRACTOR: Object.freeze({ value: "CONTRACTOR", standing: LIFECYCLE_STANDING.CURRENT, tone: "info", meaning: "Current contractor." }),
});

export const EMPLOYEE_LIFECYCLE_VALUES = Object.freeze(Object.keys(EMPLOYEE_LIFECYCLE));

if (
  EMPLOYEE_LIFECYCLE_VALUES.length !== EMPLOYMENT_STATUS_VALUES.length ||
  EMPLOYEE_LIFECYCLE_VALUES.some((v, i) => v !== EMPLOYMENT_STATUS_VALUES[i])
) {
  throw new Error("employeeOperatingProfile: lifecycle table drifted from EMPLOYMENT_STATUS_VALUES");
}

export function describeLifecycle(status) {
  if (isBlank(status)) {
    return { value: null, words: "Status not recorded", tone: "warning", standing: LIFECYCLE_STANDING.NOT_RECORDED, meaning: "This record carries no Employee status." };
  }
  const known = EMPLOYEE_LIFECYCLE[status];
  if (!known) {
    return { value: status, words: String(status), tone: "warning", standing: LIFECYCLE_STANDING.UNRECOGNISED, meaning: "This status is not one of the six governed Employee statuses." };
  }
  return { ...known, words: employmentStatusLabel(status) };
}

// ════════════════════ THE GOVERNED EMPLOYEE RECORD ════════════════════
//
// The EMP-RT-01 / EMP-RT-07 projection: { employeeId, employmentStatus, operatingCompanyId, employeeNumber,
// displayName, name{...}, jobTitle, contact{...}, address{...}, hireDate, separationDate, currentManager, ... }.

/** The derived display name, or a truthful generic one. Never the Employee id (DECISIONS #106). */
export function recordDisplayName(record) {
  return isBlank(record?.displayName) ? "Unnamed employee" : String(record.displayName).trim();
}

export function recordNameIsAbsent(record) {
  return isBlank(record?.displayName);
}

export function recordSubtitle(record) {
  const parts = [];
  if (!isBlank(record?.jobTitle)) parts.push(String(record.jobTitle).trim());
  if (!isBlank(record?.employeeNumber)) parts.push(`Employee ${String(record.employeeNumber).trim()}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function recordCompanyName(record) {
  return resolveOperatingCompany(record?.operatingCompanyId ?? null).company?.displayName ?? null;
}

export function recordIdentityFields(record) {
  const n = record?.name ?? {};
  const c = record?.contact ?? {};
  const a = record?.address ?? {};
  return [
    field({ label: "First Name", value: n.firstName, priority: 1 }),
    field({ label: "Middle Name", value: n.middleName, priority: 3 }),
    field({ label: "Last Name", value: n.lastName, priority: 1 }),
    field({ label: "Preferred Name", value: n.preferredName, priority: 2 }),
    field({ label: "Employee ID", value: record?.employeeNumber, kind: FIELD_KIND.IDENTIFIER, priority: 1 }),
    field({ label: "Work Email", value: c.workEmail, priority: 1 }),
    field({ label: "Work Phone", value: c.workPhone, priority: 2 }),
    field({ label: "Mobile Phone", value: c.mobilePhone, priority: 2 }),
    field({ label: "Street", value: a.street, priority: 3 }),
    field({ label: "Unit / Suite", value: a.unit, priority: 3 }),
    field({ label: "City", value: a.city, priority: 3 }),
    field({ label: "State", value: a.state, priority: 3 }),
    field({ label: "ZIP", value: a.postalCode, priority: 3 }),
  ];
}

export function recordEmploymentFields(record) {
  return [
    field({ label: "Job Title", value: record?.jobTitle, priority: 1 }),
    field({
      label: "Operating Company",
      value: recordCompanyName(record),
      raw: record?.operatingCompanyId ?? null,
      absence: isBlank(record?.operatingCompanyId) ? ABSENCE.NOT_RECORDED : ABSENCE.UNRESOLVED,
      priority: 2,
    }),
    field({ label: "Hire Date", value: record?.hireDate, kind: FIELD_KIND.DATE, priority: 2 }),
    field({ label: "Separation Date", value: record?.separationDate, kind: FIELD_KIND.DATE, priority: 3 }),
  ];
}

/** The governed current reporting relationship, as words. Null when none is current. */
export function describeManager(record) {
  const m = record?.currentManager;
  if (!m || isBlank(m.managerEmployeeId)) return null;
  return {
    managerEmployeeId: m.managerEmployeeId,
    name: isBlank(m.displayName) ? "Unnamed employee" : String(m.displayName).trim(),
    since: isBlank(m.effectiveFrom) ? null : String(m.effectiveFrom).slice(0, 10),
  };
}

// ════════════════════ USER ACCESS RELATIONSHIP ════════════════════

export const USER_ACCESS_LINK = Object.freeze({ LINKED: "LINKED", NOT_LINKED: "NOT_LINKED", UNKNOWN: "UNKNOWN" });

/** From EMP-RT-01's `userAccess` (LINKED | UNLINKED): a governed active Employee ↔ Principal link, or none. */
export function describeUserAccessRelationship(userAccess) {
  if (userAccess === "LINKED") {
    return {
      state: USER_ACCESS_LINK.LINKED,
      words: "User Access linked",
      explanation:
        "A governed EOS Principal is linked to this Employee. Signing in, account status and Security Roles are User Access, managed separately from the Employee record.",
    };
  }
  if (userAccess === "UNLINKED") {
    return {
      state: USER_ACCESS_LINK.NOT_LINKED,
      words: "No User Access",
      explanation:
        "No governed Principal is linked to this Employee. That is a legitimate state: an Employee exists as a business record whether or not they can sign in.",
    };
  }
  return { state: USER_ACCESS_LINK.UNKNOWN, words: "User Access not stated", explanation: "The Employee read did not state whether User Access is linked." };
}

// ════════════════════ JOB ROLE ════════════════════

export const JOB_ROLE_STATE = Object.freeze({ NOT_GOVERNED: "NOT_GOVERNED" });

export function describeJobRole() {
  return {
    state: JOB_ROLE_STATE.NOT_GOVERNED,
    words: "Not yet governed",
    explanation:
      "EOS does not yet hold a governed Job Role for anyone. Job Role is business work, not access: it is never taken from the Security Role, operational eligibility, the job title or a department. Retail Sales and National Accounts Sales will be separate Job Roles.",
    dependency: RUNTIME_DEPENDENCIES.JOB_ROLE_AUTHORITY,
  };
}

// ════════════════════ RESPONSIBILITY ════════════════════

export const RESPONSIBILITY_AXIS = Object.freeze({ OWNER: "OWNER", ACCOUNTABLE: "ACCOUNTABLE", ASSIGNED: "ASSIGNED" });

/** Families each served axis reads, mirrored from the server's EMPLOYEE_RECORD_FAMILIES / ACCOUNTABLE_RECORD_FAMILIES. */
export const OWNED_RECORD_FAMILIES = Object.freeze(["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER", "ACCOUNT", "CONTACT", "ACCOUNT_LOCATION"]);
export const ACCOUNTABLE_RECORD_FAMILIES = Object.freeze(["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"]);

export const RECORD_FAMILY_LABEL = Object.freeze({
  OPPORTUNITY: "Opportunities",
  SALES_AGREEMENT: "Sales Agreements",
  SALES_ORDER: "Sales Orders",
  ACCOUNT: "Accounts",
  CONTACT: "Contacts",
  ACCOUNT_LOCATION: "Account locations",
});

const AXES = Object.freeze([
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.OWNER,
    label: "Record Owner",
    heading: { admin: "Records owned", self: "Records I own" },
    question: { admin: "Which records name this Employee as Record Owner?", self: "Which records name me as Record Owner?" },
    why: "You are the Record Owner: the record belongs to you. Owning a record does not make you accountable for its outcome or assign you its work.",
    read: WORKFORCE_READS.OWNED_RECORDS,
    families: OWNED_RECORD_FAMILIES,
    dependency: null,
  }),
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.ACCOUNTABLE,
    label: "Accountable Person",
    heading: { admin: "Accountable outcomes", self: "Outcomes I'm accountable for" },
    question: { admin: "Which outcomes is this Employee the Accountable Person for?", self: "Which outcomes am I the Accountable Person for?" },
    why: "You are the Accountable Person: you answer for the outcome. Accountability is separate from ownership and does not change when work is assigned to someone else.",
    read: WORKFORCE_READS.ACCOUNTABILITIES,
    families: ACCOUNTABLE_RECORD_FAMILIES,
    dependency: null,
  }),
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.ASSIGNED,
    label: "Assigned Person",
    heading: { admin: "Assigned work", self: "My assigned work" },
    question: { admin: "What work is assigned to this Employee?", self: "What work is assigned to me?" },
    why: "You are the Assigned Person: you perform the work. Being assigned does not make you the Record Owner or the Accountable Person.",
    read: null,
    families: Object.freeze([]),
    dependency: RUNTIME_DEPENDENCIES.ASSIGNED_WORK_READ,
  }),
]);

export const RESPONSIBILITY_AXES = AXES;

export function describeResponsibilities(perspective = "admin") {
  const view = perspective === "self" ? "self" : "admin";
  return AXES.map((a) => ({
    axis: a.axis,
    label: a.label,
    heading: a.heading[view],
    question: a.question[view],
    why: a.why,
    available: a.read !== null,
    read: a.read,
    families: a.families,
    dependency: a.dependency,
  }));
}

/** "Why is this in front of me?" -- the TRUE relationships only, in axis order, one sentence each. */
export function explainWhyInFrontOfMe(relationships) {
  const held = new Set(Array.isArray(relationships) ? relationships : []);
  return AXES.filter((a) => held.has(a.axis)).map((a) => ({ axis: a.axis, label: a.label, reason: a.why }));
}

/** One owned/accountable record, as a line. Never the record id (DECISIONS #106). */
export function describeRecordItem(item) {
  const title = !isBlank(item?.recordNumber) ? String(item.recordNumber) : !isBlank(item?.name) ? String(item.name) : "Unnamed record";
  return { title, state: isBlank(item?.state) ? null : String(item.state) };
}

// ════════════════════ FAILURES, IN WORDS ════════════════════

export const READ_FAILURE_KIND = Object.freeze({
  NOT_CONFIGURED: "NOT_CONFIGURED",
  NOT_AVAILABLE_TO_YOU: "NOT_AVAILABLE_TO_YOU",
  NOT_FOUND: "NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * A Workforce failure as { kind, words, retryable }. A refusal (403) is "not available to you", never an outage;
 * an outage is never "not found"; nothing is ever rendered as an empty result.
 */
export function describeWorkforceFailure(error, subject = "This information") {
  const code = error?.code;
  switch (code) {
    case "NOT_CONFIGURED":
      return { kind: READ_FAILURE_KIND.NOT_CONFIGURED, words: "The EOS Workforce service is not configured for this environment, so this is not shown.", retryable: false };
    case "FORBIDDEN":
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return { kind: READ_FAILURE_KIND.NOT_AVAILABLE_TO_YOU, words: `${subject} is not available to you.`, retryable: false };
    case "NOT_FOUND":
      return { kind: READ_FAILURE_KIND.NOT_FOUND, words: `${subject} could not be found.`, retryable: false };
    default:
      return { kind: READ_FAILURE_KIND.UNAVAILABLE, words: `${subject} could not be loaded from the Workforce service. Nothing else was used in its place.`, retryable: true };
  }
}

export const MY_PROFILE_STATE = Object.freeze({
  READY: "READY",
  NOT_LINKED: "NOT_LINKED",
  LINK_AMBIGUOUS: "LINK_AMBIGUOUS",
  LINK_UNRESOLVED: "LINK_UNRESOLVED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNAVAILABLE: "UNAVAILABLE",
});

/** EMP-RT-07's refusals, each its own state. Resolved only through the governed link -- never uid → Employee. */
export function describeMyProfileFailure(error) {
  const reason = error?.reason;
  if (error?.code === "NOT_CONFIGURED") {
    return { state: MY_PROFILE_STATE.NOT_CONFIGURED, words: "The EOS Workforce service is not configured for this environment, so your Employee profile is not shown.", retryable: false };
  }
  if (reason === "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND" || (error?.code === "NOT_FOUND" && !reason)) {
    return { state: MY_PROFILE_STATE.NOT_LINKED, words: "Your sign-in is not linked to an Employee record. EOS knows you as User Access only — an EOS Principal — not as an Employee. An administrator establishes that link; nothing here changes it.", retryable: false };
  }
  if (reason === "EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS" || error?.code === "CONFLICT") {
    return { state: MY_PROFILE_STATE.LINK_AMBIGUOUS, words: "Your sign-in is linked to more than one Employee (or your Employee to more than one sign-in), so EOS will not pick one. An administrator must resolve the link.", retryable: false };
  }
  if (reason === "EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED" || error?.code === "PRECONDITION_FAILED") {
    return { state: MY_PROFILE_STATE.LINK_UNRESOLVED, words: "Your sign-in is linked to an Employee record that does not resolve. An administrator must repair the link.", retryable: false };
  }
  if (error?.code === "FORBIDDEN" || error?.code === "UNAUTHENTICATED" || error?.code === "NOT_SIGNED_IN") {
    return { state: MY_PROFILE_STATE.NOT_A_MEMBER, words: "EOS does not recognise your sign-in as an active member of this company, so no Employee profile is available to you.", retryable: false };
  }
  return { state: MY_PROFILE_STATE.UNAVAILABLE, words: "Your Employee profile could not be loaded from the Workforce service. Nothing else was used in its place.", retryable: true };
}
