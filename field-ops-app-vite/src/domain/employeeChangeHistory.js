// THE GOVERNED EMPLOYEE CHANGE HISTORY (EMP-RT-H1) -- listEmployeeChangeHistory items, as Change History rows.
//
// The Workforce read returns one item per governed PostgreSQL audit event for the Employee:
//   { eventId, action, occurredAt (ISO), before, after, reason, changedBy: { displayName } | null }
// with `before` / `after` already projected by the server to the action's named keys (and manager / Job Role names
// resolved). This module turns each item into the SHARED Change History row shape (domain/changeHistory.js) so the
// governed trail renders in the same grammar as the legacy one: Field / Previous / New / Changed By.
//
// RULES:
//   * CLOSED. Only the six governed Employee actions are rows; anything else the server might someday return is not
//     rendered as history (it would render without words).
//   * WORDS, NOT IDS. Manager and Job Role read as their names, Employment Status as its label, Operating Company as
//     its governed display name. An id appears only where no label exists at all (an unrecognised company code).
//   * CHANGED BY is the server's display name when present. It is never a Principal id -- the read never returns one.
//
// PURE. No React, no Firebase, no I/O.
import { EMPLOYEE_FIELD_LABELS, PROFILE_FIELDS } from "./employeeProfile.js";
import { employmentStatusLabel } from "./employeeVocabulary.js";
import { operatingCompanyDisplayName } from "./operatingCompanyAuthority.js";

export const GOVERNED_EMPLOYEE_HISTORY_ACTION = Object.freeze({
  PROFILE_UPDATE: "employee.profile.update",
  MANAGER_ESTABLISH: "employee.reportingRelationship.establish",
  MANAGER_END: "employee.reportingRelationship.end",
  EMPLOYMENT_STATUS_CHANGE: "employee.employmentStatus.change",
  OPERATING_COMPANY_CHANGE: "employee.operatingCompany.change",
  JOB_ROLE_ASSIGN: "employee.jobRole.assign",
});

/** Action -> words, for the Field / Event column when an event changed no single field. */
export const GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS = Object.freeze({
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.PROFILE_UPDATE]: "Profile change",
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_ESTABLISH]: "Manager assigned",
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_END]: "Manager removed",
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.EMPLOYMENT_STATUS_CHANGE]: "Employment Status change",
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.OPERATING_COMPANY_CHANGE]: "Operating Company change",
  [GOVERNED_EMPLOYEE_HISTORY_ACTION.JOB_ROLE_ASSIGN]: "Job Role assigned",
});

/** The field key a Job Role change is filed under. Not an Employee profile key: the Job Role is its own authority. */
export const JOB_ROLE_HISTORY_FIELD_KEY = "jobRole";

/** Field key -> words: the profile labels, Manager / Employment Status / Operating Company, and Job Role. */
export const GOVERNED_EMPLOYEE_HISTORY_FIELD_LABELS = Object.freeze({
  ...EMPLOYEE_FIELD_LABELS,
  [JOB_ROLE_HISTORY_FIELD_KEY]: "Job Role",
});

const PROFILE_ORDER = PROFILE_FIELDS.map((f) => f.key);
const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const side = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

function managerWords(value) {
  const s = side(value);
  if (!s) return null;
  return isBlank(s.managerDisplayName) ? "Unnamed employee" : String(s.managerDisplayName);
}
function jobRoleWords(value) {
  const s = side(value);
  if (!s) return null;
  return isBlank(s.jobRoleDisplayName) ? "Unnamed Job Role" : String(s.jobRoleDisplayName);
}
function statusWords(value) {
  const s = side(value);
  return s && !isBlank(s.employmentStatus) ? employmentStatusLabel(s.employmentStatus) : null;
}
function companyWords(value) {
  const s = side(value);
  if (!s || isBlank(s.operatingCompanyId)) return null;
  // No label exists for an unrecognised code, so the code itself is the only truthful thing to show.
  return operatingCompanyDisplayName(s.operatingCompanyId) ?? `Unrecognised company (${s.operatingCompanyId})`;
}

/**
 * One governed item -> zero or more raw Change History rows (normalizeHistoryRow input).
 * A profile update that changed three fields is three rows, exactly like the legacy per-field trail.
 */
export function governedHistoryRowsForItem(item) {
  if (!item || typeof item !== "object" || isBlank(item.eventId)) return [];
  const occurredAt = typeof item.occurredAt === "string" ? Date.parse(item.occurredAt) : NaN;
  const actorName = isBlank(item.changedBy?.displayName) ? null : String(item.changedBy.displayName);
  const base = {
    occurredAt: Number.isNaN(occurredAt) ? null : occurredAt,
    eventType: item.action,
    outcome: "",
    // The Changed By filter groups by the name the server returned. There is no Principal id to group by, by design.
    changedById: actorName ?? "",
    changedByLabel: actorName,
    summary: isBlank(item.reason) ? "" : String(item.reason),
  };
  const row = (fieldKey, previousValue, newValue) => ({ ...base, id: `${item.eventId}:${fieldKey}`, fieldKey, previousValue, newValue });
  const before = side(item.before);
  const after = side(item.after);

  switch (item.action) {
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.PROFILE_UPDATE: {
      const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
      const ordered = [...PROFILE_ORDER.filter((k) => keys.has(k)), ...[...keys].filter((k) => !PROFILE_ORDER.includes(k)).sort()];
      if (ordered.length === 0) return [{ ...base, id: item.eventId, fieldKey: null, previousValue: null, newValue: null }];
      return ordered.map((key) => row(key, before?.[key] ?? null, after?.[key] ?? null));
    }
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_ESTABLISH:
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.MANAGER_END:
      return [row("managerEmployeeId", managerWords(before), managerWords(after))];
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.EMPLOYMENT_STATUS_CHANGE:
      return [row("employmentStatus", statusWords(before), statusWords(after))];
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.OPERATING_COMPANY_CHANGE:
      return [row("operatingCompanyId", companyWords(before), companyWords(after))];
    case GOVERNED_EMPLOYEE_HISTORY_ACTION.JOB_ROLE_ASSIGN:
      return [row(JOB_ROLE_HISTORY_FIELD_KEY, jobRoleWords(before), jobRoleWords(after))];
    default:
      return [];
  }
}

/** Every item of every loaded page, in server order (newest first). */
export function governedHistoryRows(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap(governedHistoryRowsForItem);
}
