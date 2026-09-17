// The Employee PROFILE vocabulary: the seventeen governed profile facts on eos_workforce.employees, the field keys the
// Firestore profile command and the Administration form address them by, and the command's normalization
// (access/employeeProfileCommands.ts normalizeValue, Firebase-free). Pure: no Firebase, no database, no I/O.
//
// Shared by the one-time profile copy (migration/employeeProfileSnapshot.ts) and the governed PostgreSQL profile writer
// (commands/employeeProfileCommand.ts), so the copy and the writer cannot disagree about which key lands in which column
// or what a valid value is.

/** The PostgreSQL profile columns, in a fixed order. */
export const PROFILE_COLUMNS = Object.freeze([
  "employee_number", "display_name", "first_name", "middle_name", "last_name", "preferred_name", "job_title", "work_email",
  "work_phone", "mobile_phone", "address_street", "address_unit", "address_city", "address_state", "address_postal_code",
  "hire_date", "separation_date",
] as const);
export type ProfileColumn = (typeof PROFILE_COLUMNS)[number];

export type ProfileFieldKind = "TEXT" | "EMAIL" | "DATE" | "EMPLOYEE_NUMBER";

/** Firestore / Administration dotted field key -> PostgreSQL column, and the command's validator kind. */
export const PROFILE_FIELD_MAP: readonly (readonly [string, ProfileColumn, ProfileFieldKind])[] = Object.freeze([
  ["employeeNumber", "employee_number", "EMPLOYEE_NUMBER"],
  ["displayName", "display_name", "TEXT"],
  ["firstName", "first_name", "TEXT"],
  ["middleName", "middle_name", "TEXT"],
  ["lastName", "last_name", "TEXT"],
  ["preferredName", "preferred_name", "TEXT"],
  ["jobTitle", "job_title", "TEXT"],
  ["workEmail", "work_email", "EMAIL"],
  ["workPhone", "work_phone", "TEXT"],
  ["mobilePhone", "mobile_phone", "TEXT"],
  ["address.street", "address_street", "TEXT"],
  ["address.unit", "address_unit", "TEXT"],
  ["address.city", "address_city", "TEXT"],
  ["address.state", "address_state", "TEXT"],
  ["address.postalCode", "address_postal_code", "TEXT"],
  ["hireDate", "hire_date", "DATE"],
  ["separationDate", "separation_date", "DATE"],
]);

const EMPLOYEE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isRealCalendarDay(text: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** The command's normalization. Returns [value] or a finding code. */
export function normalizeProfileValue(kind: ProfileFieldKind, raw: unknown): { value: string | null } | { code: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { code: "NOT_A_STRING" };
  const text = raw.trim();
  if (text === "") return { value: null };
  if (text.length > 200) return { code: "TOO_LONG" };
  if (kind === "EMAIL" && !EMAIL_SHAPE.test(text)) return { code: "EMAIL_SHAPE_INVALID" };
  if (kind === "DATE" && !isRealCalendarDay(text)) return { code: "CALENDAR_DATE_INVALID" };
  if (kind === "EMPLOYEE_NUMBER" && !EMPLOYEE_NUMBER_PATTERN.test(text)) return { code: "EMPLOYEE_NUMBER_SHAPE_INVALID" };
  return { value: text };
}
