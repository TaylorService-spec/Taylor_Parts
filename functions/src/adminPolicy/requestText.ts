// REQUEST TEXT HYGIENE shared by every EOS HTTP transport (Administration, Operations, Commercial, CRM, Workforce).
//
// PostgreSQL `text` cannot store U+0000: a NUL reaching any query is refused by the server (SQLSTATE 22021) and, because
// no domain translator names that state, used to surface as 500 *_FAILED / INTERNAL -- and once as 503
// EMPLOYEE_AUTHORITY_UNAVAILABLE, which a client reads as an outage (L5 XLF-L5-05 / Controller XLF-002, 2026-09-28).
// A NUL is never a legitimate character in any EOS field, so it is a caller error: every transport refuses the whole
// request 400 INVALID_INPUT at the envelope, before identity, authority or any query. Pure; no I/O.

const NUL = "\u0000";

/** True when any string (value OR object key) anywhere in `value` contains U+0000. */
export function containsNulCharacter(value: unknown, depth = 0): boolean {
  if (depth > 64) return true; // absurdly deep input is refused rather than walked
  if (typeof value === "string") return value.includes(NUL);
  if (Array.isArray(value)) return value.some((v) => containsNulCharacter(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => k.includes(NUL) || containsNulCharacter(v, depth + 1));
  }
  return false;
}

export const NUL_CHARACTER_REFUSAL = "text values may not contain the NUL character (U+0000)";
