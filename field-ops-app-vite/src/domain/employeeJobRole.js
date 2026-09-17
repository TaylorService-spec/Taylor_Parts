// EMPLOYEE JOB ROLE (EMP-RT-08, Owner ruling 2026-09-16) -- the pure layer behind the Job Role section, the Job Role
// control on the Administration Employee record, and the Users directory's "no Job Role" remediation count.
//
// ════════════════════ WHAT A JOB ROLE IS, AND IS NOT ════════════════════
//
// A Job Role is an Employee's BUSINESS FUNCTION only. It grants no Security Role or permission and establishes no
// Account/customer ownership, accountability, assignment, manager/reporting or operating-company authority. Retail
// Sales and National Accounts Sales are distinct catalog entries. An Employee has at most one current primary Job
// Role, with append-only history, and may have none: nothing is inferred from the Security Role, operational
// eligibility, the job title, a department, a uid or anything else. Every word below says only what the governed
// PostgreSQL reads returned.
//
//   listJobRoles                  { items: [{ jobRoleId, displayName, status }] }                employee.record.read
//   listEmployeeJobRoleHistory    { employeeId, current, items: [...], truncated }                employee.record.read
//   listEmployeesWithoutJobRole   { count, items: [directory items], truncated, nextCursor }      employee.record.read
//   assignEmployeeJobRole         { employeeId, jobRoleId, reason? } -> ASSIGNED|CHANGED|NO_CHANGE  admin.employeeJobRole.write
//
// The write capability is admin.employeeJobRole.write -- deliberately NOT admin.employeeProfile.write. The client's
// capability test only decides what to OFFER; the server re-checks it and its refusal is rendered exactly.
//
// PURE. No React, no Firebase, no network.

/** The one Job Role command this client sends. The reads are named in WORKFORCE_READS (employeeOperatingProfile.js). */
export const JOB_ROLE_ASSIGN_OPERATION = "assignEmployeeJobRole";

/** The capability that governs assigning or changing an Employee's Job Role. Never admin.employeeProfile.write. */
export const EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY = "admin.employeeJobRole.write";

/** The server's reason bound (optionalReason in the command kernel). */
export const JOB_ROLE_REASON_MAX = 500;

export const JOB_ROLE_CAPTION =
  "A Job Role describes the Employee's business function. It does not change access: it grants no Security Role or permission, and sets no ownership, assignment, manager or operating company.";

export const JOB_ROLE_STATE = Object.freeze({ ASSIGNED: "ASSIGNED", NONE: "NONE" });

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const dateOf = (iso) => (isBlank(iso) ? null : String(iso).slice(0, 10));
const roleName = (name) => (isBlank(name) ? "Unnamed Job Role" : String(name).trim());

function describeHistoryItem(item) {
  const inactive = item?.jobRoleStatus === "INACTIVE";
  const from = dateOf(item?.effectiveFrom);
  const to = dateOf(item?.effectiveTo);
  const current = item?.current === true;
  return Object.freeze({
    key: item?.assignmentId ?? `${item?.jobRoleId}-${item?.effectiveFrom}`,
    jobRoleId: item?.jobRoleId ?? null,
    name: roleName(item?.displayName),
    inactive,
    current,
    from,
    to,
    period: current ? `From ${from ?? "an unrecorded date"} · current` : `${from ?? "Unrecorded"} to ${to ?? "an unrecorded date"}`,
    reason: isBlank(item?.reason) ? null : String(item.reason),
  });
}

/**
 * One Employee's Job Role, from listEmployeeJobRoleHistory. `current` is the server's own current row; the history is
 * in the server's order (newest first). An Employee with no current Job Role is NONE -- stated, never guessed.
 */
export function describeEmployeeJobRole(result) {
  const items = (Array.isArray(result?.items) ? result.items : []).map(describeHistoryItem);
  const current = result?.current ? describeHistoryItem(result.current) : null;
  return Object.freeze({
    state: current ? JOB_ROLE_STATE.ASSIGNED : JOB_ROLE_STATE.NONE,
    current,
    words: current ? current.name : "No Job Role assigned",
    inactiveNote: current?.inactive
      ? "This Job Role is inactive in the catalog. It remains this Employee's current Job Role until it is changed, and it cannot be newly assigned."
      : null,
    noneNote: current
      ? null
      : "No current Job Role is recorded for this Employee. EOS does not infer one from the Security Role, operational eligibility, job title or department; an administrator assigns it explicitly.",
    history: Object.freeze(items),
    truncated: Boolean(result?.truncated),
  });
}

/** The choices the assign control may offer: ACTIVE catalog roles only, by name. Inactive roles are never offered. */
export function assignableJobRoles(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  return items
    .filter((r) => r && r.status === "ACTIVE" && !isBlank(r.jobRoleId))
    .map((r) => Object.freeze({ value: r.jobRoleId, label: roleName(r.displayName) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/**
 * The exact command input: { employeeId, jobRoleId } plus `reason` only when one was written. Never a tenant,
 * principal, actor, capability, Security Role or anything else.
 */
export function jobRoleAssignInput({ employeeId, jobRoleId, reason }) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed ? { employeeId, jobRoleId, reason: trimmed } : { employeeId, jobRoleId };
}

export const JOB_ROLE_ASSIGN_RESULT = Object.freeze({
  ASSIGNED: "ASSIGNED",
  CHANGED: "CHANGED",
  NO_CHANGE: "NO_CHANGE",
  NOT_SAVED: "NOT_SAVED",
  NOT_CONFIRMED: "NOT_CONFIRMED",
});

const ACCESS_UNCHANGED = "Access, Security Roles and permissions are unchanged.";

/**
 * An assignEmployeeJobRole outcome as { state, words, reread }. `reread` is true whenever the stored Job Role may
 * differ from what the section last read -- the page then re-reads the history and never renders the choice itself.
 */
export function describeJobRoleAssignResult(outcome, chosenLabel = "the chosen Job Role") {
  if (outcome?.ok) {
    switch (outcome.result?.outcome) {
      case "ASSIGNED":
        return { state: JOB_ROLE_ASSIGN_RESULT.ASSIGNED, words: `Job Role assigned: ${chosenLabel}. ${ACCESS_UNCHANGED}`, reread: true };
      case "CHANGED":
        return { state: JOB_ROLE_ASSIGN_RESULT.CHANGED, words: `Job Role changed to ${chosenLabel}; the previous one is kept in the history. ${ACCESS_UNCHANGED}`, reread: true };
      case "NO_CHANGE":
        return { state: JOB_ROLE_ASSIGN_RESULT.NO_CHANGE, words: `Nothing changed: ${chosenLabel} is already this Employee's current Job Role.`, reread: false };
      default:
        return { state: JOB_ROLE_ASSIGN_RESULT.NOT_CONFIRMED, words: "The Job Role change could not be confirmed. The Job Role below is re-read from the Employee authority.", reread: true };
    }
  }
  const code = outcome?.code;
  const reason = outcome?.reason;
  const notSaved = (words, reread = false) => ({ state: JOB_ROLE_ASSIGN_RESULT.NOT_SAVED, words: `${words} Nothing was saved.`, reread });
  switch (code) {
    case "FORBIDDEN":
      return notSaved(`You are not authorized to change this Employee's Job Role (${EMPLOYEE_JOB_ROLE_WRITE_CAPABILITY}).`);
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return notSaved("Your sign-in could not be verified by the Employee service. Sign in again.");
    case "NOT_FOUND":
      return reason === "JOB_ROLE_NOT_FOUND"
        ? notSaved("That Job Role does not exist in this company's Job Role catalog.", true)
        : notSaved("This Employee record could not be found.");
    case "PRECONDITION_FAILED":
      return reason === "JOB_ROLE_INACTIVE"
        ? notSaved("That Job Role is inactive and cannot be assigned.", true)
        : notSaved("The Employee service refused the change because a precondition was not met.", true);
    case "CONFLICT":
      return notSaved("This Employee's Job Role was changed by someone else at the same time. Review the current Job Role and try again.", true);
    case "INVALID_INPUT":
      return notSaved(outcome?.message ? `The Employee service refused the change: ${outcome.message}.` : "The Employee service refused the change.");
    case "NOT_CONFIGURED":
      return notSaved("The EOS Workforce service is not configured for this environment.");
    default:
      return {
        state: JOB_ROLE_ASSIGN_RESULT.NOT_CONFIRMED,
        words: "The Employee service could not complete or confirm the Job Role change. The Job Role below is re-read from the Employee authority.",
        reread: true,
      };
  }
}

/** The Users directory remediation line: "N Employees have no Job Role". Null when there is nothing to remediate. */
export function describeJobRoleRemediation(result) {
  const count = Number.isSafeInteger(result?.count) && result.count > 0 ? result.count : 0;
  if (count === 0) return null;
  return Object.freeze({
    count,
    words: count === 1 ? "1 Employee has no Job Role" : `${count} Employees have no Job Role`,
    note: "A Job Role is assigned explicitly on each Employee's record. Nothing is inferred, and assigning one does not change access.",
  });
}
