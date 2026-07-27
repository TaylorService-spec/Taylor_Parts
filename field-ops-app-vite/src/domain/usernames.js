// AUTH-PR-2 -- username data model: normalization, validation, collision,
// and email-prefix suggestion. Pure, dependency-free domain logic per this
// codebase's "pure logic lives in domain/" pattern (matches
// actorDisplayName.js), so it is unit-testable by the node test runner.
//
// SCOPE / SAFETY (docs/assessments/auth-modernization-architecture.md):
// - Username is an application login ALIAS; the Firebase Auth UID stays the
//   stable identity key. Nothing here is an identity or a credential.
// - Username LOGIN and the login resolver are DEFERRED (D-RESOLVER). Nothing
//   in this module authenticates, signs in, or resolves username -> email.
// - Username MAPPINGS (`usernames/{normalizedUsername}`) are trusted-writer
//   only and are NOT created here (creating production mappings is a hard
//   stop). These helpers perform NO I/O -- callers supply any "taken" set
//   from a trusted read.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

// Allowed set: lowercase letters, digits, period, hyphen, underscore.
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// Names that must never be assigned as a username.
export const RESERVED_USERNAMES = Object.freeze([
  "admin", "administrator", "root", "superuser", "support",
  "system", "security", "owner", "billing", "help",
  "null", "undefined", "me", "self", "api", "firebase",
]);

export const USERNAME_INVALID_REASON = Object.freeze({
  EMPTY: "empty",
  TOO_SHORT: "too_short",
  TOO_LONG: "too_long",
  CHARSET: "charset",
  RESERVED: "reserved",
});

// Canonical key form: trim + lowercase. Does NOT validate -- the returned
// string may still be invalid; use validateUsername for that.
export function normalizeUsername(input) {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

// Validate a raw candidate. Returns { valid, normalized, reason } where
// reason is a USERNAME_INVALID_REASON value when invalid, else null.
export function validateUsername(input) {
  const normalized = normalizeUsername(input);
  if (!normalized) {
    return { valid: false, normalized, reason: USERNAME_INVALID_REASON.EMPTY };
  }
  // Reserved is checked before length so any reserved word is always reported
  // as reserved (e.g. "me" is reserved even though it is also below the
  // minimum length) -- the "no reserved word is ever valid" guarantee holds
  // regardless of the word's length.
  if (RESERVED_USERNAMES.includes(normalized)) {
    return { valid: false, normalized, reason: USERNAME_INVALID_REASON.RESERVED };
  }
  if (normalized.length < USERNAME_MIN_LENGTH) {
    return { valid: false, normalized, reason: USERNAME_INVALID_REASON.TOO_SHORT };
  }
  if (normalized.length > USERNAME_MAX_LENGTH) {
    return { valid: false, normalized, reason: USERNAME_INVALID_REASON.TOO_LONG };
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: USERNAME_INVALID_REASON.CHARSET };
  }
  return { valid: true, normalized, reason: null };
}

// Derive a *suggested* username from an email prefix. A suggestion only --
// not an identity guarantee; the result must still be validated and
// collision-checked before use. Strips the domain, maps disallowed chars to
// a separator, collapses repeated separators, trims leading/trailing
// separators, and clamps to the max length.
export function deriveUsernameFromEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "";
  const prefix = email.slice(0, email.indexOf("@"));
  let candidate = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (candidate.length > USERNAME_MAX_LENGTH) {
    candidate = candidate.slice(0, USERNAME_MAX_LENGTH).replace(/[._-]+$/g, "");
  }
  return candidate;
}

// Collision check against a set/array of ALREADY-TAKEN normalized usernames.
// Pure -- the caller supplies the taken set (e.g. from a trusted read); this
// performs NO I/O. Invalid candidates are never "available".
export function isUsernameAvailable(candidate, taken) {
  const { valid, normalized } = validateUsername(candidate);
  if (!valid) return false;
  const takenSet = taken instanceof Set
    ? taken
    : new Set(Array.isArray(taken) ? taken : []);
  return !takenSet.has(normalized);
}

// Propose alternative usernames when the desired one collides. Deterministic:
// appends numeric suffixes (base2, base3, ...), always respecting max length,
// skipping any that are taken or invalid. Returns up to `limit` suggestions
// (default 3); never returns the original.
export function proposeAlternativeUsernames(desired, taken, limit = 3) {
  const base = normalizeUsername(desired).replace(/[._-]+$/g, "");
  if (!base) return [];
  const takenSet = taken instanceof Set
    ? taken
    : new Set(Array.isArray(taken) ? taken : []);
  const out = [];
  for (let n = 2; out.length < limit && n < 1000; n += 1) {
    const suffix = String(n);
    const trimmedBase = base
      .slice(0, USERNAME_MAX_LENGTH - suffix.length)
      .replace(/[._-]+$/g, "");
    const candidate = `${trimmedBase}${suffix}`;
    const { valid, normalized } = validateUsername(candidate);
    if (valid && !takenSet.has(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

// Display helper: the human-facing username for a mapping record, or null
// when none is present. Prefers displayUsername (as chosen), falls back to
// the normalized key. Never invents a value.
export function usernameForDisplay(mapping) {
  if (!mapping) return null;
  return mapping.displayUsername ?? mapping.normalizedUsername ?? null;
}
