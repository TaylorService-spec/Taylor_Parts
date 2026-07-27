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
//
// SCOPE: a PURE helper for a FUTURE display surface. AUTH-PR-2 wires no
// application display and adds NO mapping read to feed it -- reading the
// trusted-writer-only mapping is a separate, later concern (and would need
// its own Rules decision, §10). This helper exists so that surface can format
// a value it already holds, without re-implementing the fallback rule.
export function usernameForDisplay(mapping) {
  if (!mapping) return null;
  return mapping.displayUsername ?? mapping.normalizedUsername ?? null;
}

// -- Recovery-ready mapping contract (architecture §2) ----------------------
// Pure validator for a `usernames/{normalizedUsername}` mapping RECORD. Models
// the trusted-writer-only mapping so future writer/reader code has one
// authoritative shape to check against. Performs NO I/O and creates NO
// mapping -- callers pass a candidate record (and its intended document key).

export const MAPPING_INVALID_REASON = Object.freeze({
  NOT_OBJECT: "not_object",
  UNKNOWN_FIELD: "unknown_field",
  USERNAME_INVALID: "username_invalid",
  KEY_MISMATCH: "key_mismatch",
  DISPLAY_MISMATCH: "display_mismatch",
  MISSING_UID: "missing_uid",
  TENANT_INVALID: "tenant_invalid",
  ACTIVE_INVALID: "active_invalid",
  MISSING_PROVENANCE: "missing_provenance",
  PROVENANCE_TIMESTAMP_INVALID: "provenance_timestamp_invalid",
  VERSION_INVALID: "version_invalid",
  HISTORY_INVALID: "history_invalid",
  MISSING_AUDIT_CORRELATION: "missing_audit_correlation",
});

// The EXACT set of fields a mapping record may contain. Anything else -- email,
// password, role/claims, raw profile data, etc. -- is rejected so the mapping
// cannot silently accumulate unapproved or sensitive fields.
export const MAPPING_ALLOWED_FIELDS = Object.freeze([
  "normalizedUsername",
  "displayUsername",
  "uid",
  "tenantId",
  "active",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "version",
  "previousUsernames",
  "auditCorrelationId",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// Repository-approved timestamp representation: an epoch-millis positive integer
// (the domain-layer convention, e.g. `Date.now()` used across accounts/contacts/
// locations/reports), OR a Firestore Timestamp (a server trusted-writer value:
// has a toMillis() method, or integer seconds+nanoseconds). Strings, Dates,
// floats, zero, and negatives are rejected.
function isApprovedTimestamp(v) {
  if (typeof v === "number") return Number.isInteger(v) && v > 0;
  if (v && typeof v === "object") {
    if (typeof v.toMillis === "function") return true;
    if (Number.isInteger(v.seconds) && Number.isInteger(v.nanoseconds)) return true;
  }
  return false;
}

// Validate a mapping record against the §2 contract. When `expectedKey` is
// supplied, the record's normalizedUsername must equal it (document-key
// agreement). Returns { valid, reasons } -- reasons is an array of
// MAPPING_INVALID_REASON values (empty when valid). An `active: false`
// record is a VALID, modeled state (inactive is not a validation error).
export function validateUsernameMapping(record, expectedKey) {
  if (!record || typeof record !== "object") {
    return { valid: false, reasons: [MAPPING_INVALID_REASON.NOT_OBJECT] };
  }
  const reasons = [];

  // Exact allowed-field enforcement: reject any field outside the approved set
  // so the mapping cannot silently accumulate unapproved or sensitive fields
  // (email, password/credentials, role/claims, raw profile records, etc.).
  for (const key of Object.keys(record)) {
    if (!MAPPING_ALLOWED_FIELDS.includes(key)) {
      reasons.push(MAPPING_INVALID_REASON.UNKNOWN_FIELD);
      break;
    }
  }

  const usernameCheck = validateUsername(record.normalizedUsername);
  if (!usernameCheck.valid) {
    reasons.push(MAPPING_INVALID_REASON.USERNAME_INVALID);
  } else if (record.normalizedUsername !== usernameCheck.normalized) {
    // normalizedUsername must already be in canonical (normalized) form.
    reasons.push(MAPPING_INVALID_REASON.USERNAME_INVALID);
  }

  if (expectedKey !== undefined && record.normalizedUsername !== expectedKey) {
    reasons.push(MAPPING_INVALID_REASON.KEY_MISMATCH);
  }

  // displayUsername must be present and normalize to the same identity.
  if (!isNonEmptyString(record.displayUsername)
      || normalizeUsername(record.displayUsername) !== record.normalizedUsername) {
    reasons.push(MAPPING_INVALID_REASON.DISPLAY_MISMATCH);
  }

  if (!isNonEmptyString(record.uid)) {
    reasons.push(MAPPING_INVALID_REASON.MISSING_UID);
  }

  // tenantId is an inert placeholder: must be present as either null or a
  // non-empty string (never undefined -- the field must exist for tenant
  // readiness), and tenant BEHAVIOR is out of scope until Issue #140.
  if (!(record.tenantId === null || isNonEmptyString(record.tenantId))) {
    reasons.push(MAPPING_INVALID_REASON.TENANT_INVALID);
  }

  if (typeof record.active !== "boolean") {
    reasons.push(MAPPING_INVALID_REASON.ACTIVE_INVALID);
  }

  if (!isNonEmptyString(record.createdBy) || !isNonEmptyString(record.updatedBy)) {
    reasons.push(MAPPING_INVALID_REASON.MISSING_PROVENANCE);
  }
  if (!isApprovedTimestamp(record.createdAt) || !isApprovedTimestamp(record.updatedAt)) {
    reasons.push(MAPPING_INVALID_REASON.PROVENANCE_TIMESTAMP_INVALID);
  }

  if (!Number.isInteger(record.version) || record.version < 1) {
    reasons.push(MAPPING_INVALID_REASON.VERSION_INVALID);
  }

  // previousUsernames is optional; when present it must be an array of valid
  // normalized usernames, and MUST NOT contain the current normalizedUsername
  // (non-reuse: a name cannot be listed as its own predecessor).
  if (record.previousUsernames !== undefined) {
    const history = record.previousUsernames;
    const seen = new Set();
    const historyValid = Array.isArray(history) && history.every((h) => {
      if (!(validateUsername(h).valid && h === normalizeUsername(h))) return false;
      if (h === record.normalizedUsername) return false; // non-reuse: not the current name
      if (seen.has(h)) return false;                     // uniqueness: no duplicate entries
      seen.add(h);
      return true;
    });
    if (!historyValid) reasons.push(MAPPING_INVALID_REASON.HISTORY_INVALID);
  }

  if (!isNonEmptyString(record.auditCorrelationId)) {
    reasons.push(MAPPING_INVALID_REASON.MISSING_AUDIT_CORRELATION);
  }

  return { valid: reasons.length === 0, reasons };
}
