// EMPLOYEE OPERATING PROFILE (NS2-EMP-05a / NS2-EMP-10, Employee design v4.1) -- the pure layer.
//
// ════════════════════ WHAT THIS MODULE DECIDES, AND WHAT IT REFUSES TO ════════════════════
//
// The Employee v4.1 design (docs/atlas/inputs/employee-v4.1/NS2-EMP Profile r1.dc.html, reconciled in
// docs/atlas/reconciliation/EMPLOYEE-V41-RECONCILIATION.md on atlas/employee-v41-input) asks the
// profile to answer: who EOS says this person is, whether they are a current Employee, which company
// they work for, how their User Access relates to them, what their Security Role is as an ACCESS
// concept, and what they own, are accountable for, and are assigned. This module turns what the
// client can truthfully know into those answers -- and, for every answer the client cannot know
// today, names the missing governed backend read instead of guessing.
//
// The fixed model it encodes, none of which is a styling choice:
//
//   EMPLOYEE      != USER ACCESS    a business person may exist with no login, and a login may exist
//                                   with no Employee (a service account). Linked, never merged.
//   CREDENTIAL    != PRINCIPAL != EMPLOYEE   (#185: CREDENTIAL -> PRINCIPAL -> EMPLOYEE LINK -> EMPLOYEE)
//   JOB ROLE      != SECURITY ROLE  a Security Role is access; a Job Role is business. Job Role has no
//                                   governed PostgreSQL authority yet, so it is NOT GOVERNED -- never
//                                   inferred from the Security Role, never from the operational
//                                   eligibility markers, and Retail Sales and National Accounts Sales
//                                   are never collapsed into one generic Sales role.
//   RECORD OWNER  != ACCOUNTABLE PERSON != ASSIGNED PERSON   three axes, three labels, three sources,
//                                   three dependencies. Never one "owner" field, never one queue.
//
// PURE. No React, no Firebase, no network. Everything here is a function of its arguments.
import { EMPLOYMENT_STATUS_VALUES, employmentStatusLabel } from "./employeeVocabulary.js";

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// ════════════════════ RUNTIME DEPENDENCIES ════════════════════
//
// EMPLOYEE_RUNTIME_DEPENDENCY: a fact the design needs that the client can only obtain today through a
// Firebase business path (or not at all). The profile does NOT add another Firestore read to fill the
// gap; the section renders a truthful unavailable state that names the dependency, and the dependency
// names the governed Render/PostgreSQL read that would retire it. The ids are stable -- tests and the
// PR record refer to them.
export const EMPLOYEE_RUNTIME_DEPENDENCY = "EMPLOYEE_RUNTIME_DEPENDENCY";

export const RUNTIME_DEPENDENCIES = Object.freeze({
  EMPLOYEE_RECORD_READ: Object.freeze({
    id: "EMP-RT-01",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Employee business record",
    today:
      "Read through the existing Administration employee directory subscription (Firestore employees), not from the canonical PostgreSQL Employee authority.",
    requiredApi:
      "Governed Render read over the PostgreSQL Employee authority: readEmployee { employeeId } and listEmployees (tenant-scoped, every lifecycle status, including former Employees).",
  }),
  EMPLOYEE_PRINCIPAL_LINK_READ: Object.freeze({
    id: "EMP-RT-02",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Principal linked to this Employee",
    today:
      "No governed read of employee_principal_links is served to this client. The only visible linkage is the legacy account pointer on the Employee record, which is not the governed Employee ↔ Principal link.",
    requiredApi:
      "Governed Render read: readEmployeePrincipalLink { employeeId } → { principalId, principal display name and status, link source, linked at, linked by }.",
  }),
  OWNED_RECORDS_READ: Object.freeze({
    id: "EMP-RT-03",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Records this Employee owns",
    today:
      "Record ownership is only readable family by family through Firebase reads on each record page; no per-Employee ownership read exists.",
    requiredApi:
      "Governed Render read: listRecordsOwnedByEmployee { employeeId } → per record family (Account, Opportunity, Sales Agreement, Sales Order) the records whose Record Owner is this Employee.",
  }),
  ACCOUNTABILITY_READ: Object.freeze({
    id: "EMP-RT-04",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Outcomes this Employee is accountable for",
    today:
      "Accountable Person is held by the PostgreSQL commercial accountability authority, which serves no per-Employee read to this client.",
    requiredApi:
      "Governed Render read: listAccountabilitiesForEmployee { employeeId } → current accountability periods naming this Employee as Accountable Person, per record.",
  }),
  ASSIGNED_WORK_READ: Object.freeze({
    id: "EMP-RT-05",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Work assigned to this Employee",
    today:
      "Work assignment is keyed to technician and user ids in Firebase work reads; no governed Employee ↔ Technician projection or per-Employee assignment read exists.",
    requiredApi:
      "Governed Render read: listAssignedWorkForEmployee { employeeId } → open work whose Assigned Person is this Employee, resolved through a governed Employee ↔ Technician projection.",
  }),
  MANAGED_EMPLOYEES_READ: Object.freeze({
    id: "EMP-RT-06",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Employees this person manages",
    today:
      "The recorded manager is stored on the Employee record but read by no server decision; no governed person-level reporting relation exists.",
    requiredApi:
      "Governed Render read: listManagedEmployees { managerEmployeeId } over a governed person-level reporting relation.",
  }),
  SELF_EMPLOYEE_READ: Object.freeze({
    id: "EMP-RT-07",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Your full Employee record",
    today:
      "Your session carries only your name, Employee status and operational eligibility. Operating company, job title and manager are not part of it.",
    requiredApi:
      "Governed Render read: readMyEmployeeProfile → the caller's Employee resolved Credential → Principal → Employee link → Employee, including operating company, job title and recorded manager.",
  }),
  JOB_ROLE_AUTHORITY: Object.freeze({
    id: "EMP-RT-08",
    kind: EMPLOYEE_RUNTIME_DEPENDENCY,
    fact: "Job Role",
    today:
      "No governed Job Role authority exists in PostgreSQL. Which Job Roles exist -- including Retail Sales and National Accounts Sales as two separate roles -- is not yet governed.",
    requiredApi:
      "Governed Job Role authority and read: listEmployeeJobRoles { employeeId } (requires the Owner's Job Role vocabulary decision first).",
  }),
});

// ════════════════════ LIFECYCLE ════════════════════
//
// Exactly six values, in the canonical order. Each is its own words AND its own meaning: INACTIVE is
// not TERMINATED, ON_LEAVE is not a former Employee, and a CONTRACTOR is a current worker. A former
// Employee stays RESOLVABLE -- their record, name and history display normally; only their current
// standing differs.
export const LIFECYCLE_STANDING = Object.freeze({
  CURRENT: "CURRENT",
  NOT_CURRENTLY_ACTIVE: "NOT_CURRENTLY_ACTIVE",
  FORMER: "FORMER",
  UNRECOGNISED: "UNRECOGNISED",
  NOT_RECORDED: "NOT_RECORDED",
});

export const EMPLOYEE_LIFECYCLE = Object.freeze({
  ACTIVE: Object.freeze({
    value: "ACTIVE",
    standing: LIFECYCLE_STANDING.CURRENT,
    tone: "positive",
    meaning: "Current Employee.",
  }),
  ON_LEAVE: Object.freeze({
    value: "ON_LEAVE",
    standing: LIFECYCLE_STANDING.CURRENT,
    tone: "info",
    meaning: "Current Employee, on leave. Not a former Employee.",
  }),
  INACTIVE: Object.freeze({
    value: "INACTIVE",
    standing: LIFECYCLE_STANDING.NOT_CURRENTLY_ACTIVE,
    tone: "neutral",
    meaning: "Not currently active. Distinct from Terminated.",
  }),
  TERMINATED: Object.freeze({
    value: "TERMINATED",
    standing: LIFECYCLE_STANDING.FORMER,
    tone: "neutral",
    meaning: "Former Employee. The record and its history remain available.",
  }),
  RETIRED: Object.freeze({
    value: "RETIRED",
    standing: LIFECYCLE_STANDING.FORMER,
    tone: "neutral",
    meaning: "Former Employee, retired. The record and its history remain available.",
  }),
  CONTRACTOR: Object.freeze({
    value: "CONTRACTOR",
    standing: LIFECYCLE_STANDING.CURRENT,
    tone: "info",
    meaning: "Current contractor.",
  }),
});

export const EMPLOYEE_LIFECYCLE_VALUES = Object.freeze(Object.keys(EMPLOYEE_LIFECYCLE));

// The lifecycle table must describe exactly the governed vocabulary -- a seventh value here, or a
// missing one, is a second vocabulary rather than a description of the first.
if (
  EMPLOYEE_LIFECYCLE_VALUES.length !== EMPLOYMENT_STATUS_VALUES.length ||
  EMPLOYEE_LIFECYCLE_VALUES.some((v, i) => v !== EMPLOYMENT_STATUS_VALUES[i])
) {
  throw new Error("employeeOperatingProfile: lifecycle table drifted from EMPLOYMENT_STATUS_VALUES");
}

/**
 * The Employee's lifecycle, as words, tone, standing and meaning.
 *
 * An unrecognised stored value is returned VERBATIM with standing UNRECOGNISED -- never mapped to a
 * neighbouring status, never blanked. An absent value is NOT_RECORDED.
 */
export function describeLifecycle(status) {
  if (isBlank(status)) {
    return {
      value: null,
      words: "Status not recorded",
      tone: "warning",
      standing: LIFECYCLE_STANDING.NOT_RECORDED,
      meaning: "This record carries no Employee status.",
    };
  }
  const known = EMPLOYEE_LIFECYCLE[status];
  if (!known) {
    return {
      value: status,
      words: String(status),
      tone: "warning",
      standing: LIFECYCLE_STANDING.UNRECOGNISED,
      meaning: "This status is not one of the six governed Employee statuses.",
    };
  }
  return { ...known, words: employmentStatusLabel(status) };
}

// ════════════════════ USER ACCESS RELATIONSHIP ════════════════════
//
// What the Employee record can prove is whether a legacy application-account pointer is present. It
// is presented as exactly that. The governed Employee ↔ Principal link is a different, stronger fact
// that no read serves yet, so the Principal is never inferred from the pointer (no uid coincidence).
export const USER_ACCESS_LINK = Object.freeze({
  LINKED: "LINKED",
  NOT_LINKED: "NOT_LINKED",
});

export function describeUserAccessRelationship(employee) {
  const linked = !isBlank(employee?.userId);
  return {
    state: linked ? USER_ACCESS_LINK.LINKED : USER_ACCESS_LINK.NOT_LINKED,
    words: linked ? "User Access linked" : "No User Access",
    explanation: linked
      ? "An application account is linked to this Employee record. Signing in, account status and Security Roles are managed under User Access, not by editing the Employee."
      : "This Employee has no linked application account. That is a legitimate state: an Employee exists as a business record whether or not they can sign in.",
    // Stated, never guessed. See RUNTIME_DEPENDENCIES.EMPLOYEE_PRINCIPAL_LINK_READ.
    principal: { available: false, dependency: RUNTIME_DEPENDENCIES.EMPLOYEE_PRINCIPAL_LINK_READ },
  };
}

// ════════════════════ JOB ROLE ════════════════════
//
// There is no argument. Job Role is not governed, so nothing about this person -- not their Security
// Role, not their operational eligibility markers (one of which is a single generic SALES_ASSOCIATE),
// not their free-text job title -- is allowed to produce one.
export const JOB_ROLE_STATE = Object.freeze({ NOT_GOVERNED: "NOT_GOVERNED" });

export function describeJobRole() {
  return {
    state: JOB_ROLE_STATE.NOT_GOVERNED,
    words: "Not yet governed",
    explanation:
      "EOS does not yet hold a governed Job Role for anyone. Job Role is business work, not access: it is never taken from the Security Role, the operational eligibility markers or the job title. Retail Sales and National Accounts Sales will be separate Job Roles.",
    dependency: RUNTIME_DEPENDENCIES.JOB_ROLE_AUTHORITY,
  };
}

// ════════════════════ RESPONSIBILITY ════════════════════
//
// Three axes, each a separate fact with its own label, question, reason-in-front-of-me sentence and
// source. The order is fixed and the labels are the product vocabulary.
export const RESPONSIBILITY_AXIS = Object.freeze({
  OWNER: "OWNER",
  ACCOUNTABLE: "ACCOUNTABLE",
  ASSIGNED: "ASSIGNED",
});

const AXES = Object.freeze([
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.OWNER,
    label: "Record Owner",
    heading: { admin: "Records owned", self: "Records I own" },
    question: { admin: "Which records name this Employee as Record Owner?", self: "Which records name me as Record Owner?" },
    why: "You are the Record Owner: the record belongs to you. Owning a record does not make you accountable for its outcome or assign you its work.",
    dependency: RUNTIME_DEPENDENCIES.OWNED_RECORDS_READ,
  }),
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.ACCOUNTABLE,
    label: "Accountable Person",
    heading: { admin: "Accountable outcomes", self: "Outcomes I'm accountable for" },
    question: {
      admin: "Which outcomes is this Employee the Accountable Person for?",
      self: "Which outcomes am I the Accountable Person for?",
    },
    why: "You are the Accountable Person: you answer for the outcome. Accountability is separate from ownership and does not change when work is assigned to someone else.",
    dependency: RUNTIME_DEPENDENCIES.ACCOUNTABILITY_READ,
  }),
  Object.freeze({
    axis: RESPONSIBILITY_AXIS.ASSIGNED,
    label: "Assigned Person",
    heading: { admin: "Assigned work", self: "My assigned work" },
    question: { admin: "What work is assigned to this Employee?", self: "What work is assigned to me?" },
    why: "You are the Assigned Person: you perform the work. Being assigned does not make you the Record Owner or the Accountable Person.",
    dependency: RUNTIME_DEPENDENCIES.ASSIGNED_WORK_READ,
  }),
]);

export const RESPONSIBILITY_AXES = AXES;

/**
 * The responsibility summary, one entry per axis, for a perspective ("admin" | "self").
 *
 * Every axis is UNAVAILABLE today and carries its OWN dependency. There is no count slot at all on an
 * unavailable axis, so no caller can print a 0 beside a sentence saying the answer is unknown.
 */
export function describeResponsibilities(perspective = "admin") {
  const view = perspective === "self" ? "self" : "admin";
  return AXES.map((a) => ({
    axis: a.axis,
    label: a.label,
    heading: a.heading[view],
    question: a.question[view],
    why: a.why,
    available: false,
    dependency: a.dependency,
  }));
}

/**
 * "Why is this in front of me?" -- for one item, the TRUE relationships only, one sentence each.
 *
 * `relationships` is a set of axes the item actually carries for the viewer. Unknown axes are ignored
 * rather than guessed at; no relationship yields no reasons (the caller says the item has no
 * responsibility relationship to the viewer, it does not invent one). Order follows the axis order,
 * never the caller's, so the same item always explains itself the same way.
 */
export function explainWhyInFrontOfMe(relationships) {
  const held = new Set(Array.isArray(relationships) ? relationships : []);
  return AXES.filter((a) => held.has(a.axis)).map((a) => ({ axis: a.axis, label: a.label, reason: a.why }));
}

// ════════════════════ MANAGER CONTEXT ════════════════════

export function describeManagedEmployees() {
  return {
    available: false,
    explanation:
      "EOS records who an Employee's manager is, but no governed reporting relation decides who manages whom, so a managed-employee view is not shown.",
    dependency: RUNTIME_DEPENDENCIES.MANAGED_EMPLOYEES_READ,
  };
}

// ════════════════════ SELF VIEW ════════════════════
//
// Built from the session the application already resolves at sign-in (AuthContext) -- no new read.
export const SELF_IDENTITY = Object.freeze({
  LINKED: "LINKED",
  NOT_LINKED: "NOT_LINKED",
});

export function describeSelf(session) {
  const employeeId = isBlank(session?.employeeId) ? null : session.employeeId;
  const name = isBlank(session?.displayName) ? null : String(session.displayName).trim();
  return {
    identity: employeeId ? SELF_IDENTITY.LINKED : SELF_IDENTITY.NOT_LINKED,
    name,
    // A linked Employee whose record did not resolve at sign-in keeps its id but no name or status.
    recordResolved: Boolean(employeeId && (name || !isBlank(session?.employmentStatus))),
    lifecycle: employeeId ? describeLifecycle(session?.employmentStatus) : null,
    operationalRoles: Array.isArray(session?.operationalRoles) ? [...session.operationalRoles] : [],
    securityRole: isBlank(session?.role) ? null : session.role,
  };
}
