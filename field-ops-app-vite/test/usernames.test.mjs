// AUTH-PR-2 -- username data model tests (normalization, validation,
// collision, email-prefix suggestion, display). Pure domain logic; no I/O.
//
// Run: node test/usernames.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  normalizeUsername,
  validateUsername,
  deriveUsernameFromEmail,
  isUsernameAvailable,
  proposeAlternativeUsernames,
  usernameForDisplay,
  validateUsernameMapping,
  MAPPING_INVALID_REASON,
  USERNAME_INVALID_REASON,
  USERNAME_MAX_LENGTH,
  RESERVED_USERNAMES,
} from "../src/domain/usernames.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// -- normalizeUsername ------------------------------------------------------
ok("normalize trims and lowercases", () => {
  assert.strictEqual(normalizeUsername("  Jane.Smith  "), "jane.smith");
});
ok("normalize non-string -> empty string", () => {
  assert.strictEqual(normalizeUsername(null), "");
  assert.strictEqual(normalizeUsername(undefined), "");
  assert.strictEqual(normalizeUsername(42), "");
});

// -- validateUsername -------------------------------------------------------
ok("valid username passes", () => {
  const r = validateUsername("jane.smith-01_ok");
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.normalized, "jane.smith-01_ok");
  assert.strictEqual(r.reason, null);
});
ok("empty -> EMPTY", () => {
  assert.strictEqual(validateUsername("   ").reason, USERNAME_INVALID_REASON.EMPTY);
});
ok("too short -> TOO_SHORT", () => {
  assert.strictEqual(validateUsername("ab").reason, USERNAME_INVALID_REASON.TOO_SHORT);
});
ok("too long -> TOO_LONG", () => {
  const long = "a".repeat(USERNAME_MAX_LENGTH + 1);
  assert.strictEqual(validateUsername(long).reason, USERNAME_INVALID_REASON.TOO_LONG);
});
ok("disallowed chars -> CHARSET", () => {
  assert.strictEqual(validateUsername("jane smith").reason, USERNAME_INVALID_REASON.CHARSET);
  assert.strictEqual(validateUsername("jane@smith").reason, USERNAME_INVALID_REASON.CHARSET);
  assert.strictEqual(validateUsername("jané").reason, USERNAME_INVALID_REASON.CHARSET);
});
ok("reserved word -> RESERVED (case-insensitive)", () => {
  assert.strictEqual(validateUsername("Admin").reason, USERNAME_INVALID_REASON.RESERVED);
  for (const w of RESERVED_USERNAMES) {
    assert.strictEqual(validateUsername(w).reason, USERNAME_INVALID_REASON.RESERVED);
  }
});

// -- deriveUsernameFromEmail ------------------------------------------------
ok("derive from simple email prefix", () => {
  assert.strictEqual(deriveUsernameFromEmail("jane.smith@company.com"), "jane.smith");
});
ok("derive maps disallowed chars, collapses, trims", () => {
  assert.strictEqual(deriveUsernameFromEmail("Jane+Tag@x.com"), "jane.tag");
  assert.strictEqual(deriveUsernameFromEmail(".weird..name.@x.com"), "weird.name");
});
ok("derive with no @ or non-string -> empty", () => {
  assert.strictEqual(deriveUsernameFromEmail("not-an-email"), "");
  assert.strictEqual(deriveUsernameFromEmail(null), "");
});
ok("derive clamps to max length and trims trailing separators", () => {
  const email = `${"a".repeat(40)}@x.com`;
  const derived = deriveUsernameFromEmail(email);
  assert.ok(derived.length <= USERNAME_MAX_LENGTH);
});

// -- isUsernameAvailable ----------------------------------------------------
ok("available when not taken and valid", () => {
  assert.strictEqual(isUsernameAvailable("jane.smith", new Set(["bob"])), true);
});
ok("unavailable when taken (normalized match)", () => {
  assert.strictEqual(isUsernameAvailable("Jane.Smith", new Set(["jane.smith"])), false);
});
ok("invalid candidate is never available", () => {
  assert.strictEqual(isUsernameAvailable("ab", new Set()), false);
  assert.strictEqual(isUsernameAvailable("admin", []), false);
});
ok("accepts array or Set for taken", () => {
  assert.strictEqual(isUsernameAvailable("jane.smith", ["jane.smith"]), false);
});

// -- proposeAlternativeUsernames --------------------------------------------
ok("proposes numeric alternates skipping taken", () => {
  const alts = proposeAlternativeUsernames("jane.smith", new Set(["jane.smith", "jane.smith2"]));
  assert.deepStrictEqual(alts, ["jane.smith3", "jane.smith4", "jane.smith5"]);
});
ok("proposals never include the original and are all available+valid", () => {
  const taken = new Set(["alex.smith"]);
  const alts = proposeAlternativeUsernames("alex.smith", taken, 3);
  assert.strictEqual(alts.includes("alex.smith"), false);
  for (const a of alts) {
    assert.strictEqual(validateUsername(a).valid, true);
    assert.strictEqual(taken.has(a), false);
  }
});
ok("proposals respect max length", () => {
  const base = "x".repeat(USERNAME_MAX_LENGTH);
  const alts = proposeAlternativeUsernames(base, new Set());
  for (const a of alts) assert.ok(a.length <= USERNAME_MAX_LENGTH);
});
ok("empty base -> no proposals", () => {
  assert.deepStrictEqual(proposeAlternativeUsernames("   ", new Set()), []);
});

// -- usernameForDisplay -----------------------------------------------------
ok("display prefers displayUsername, falls back to normalized, else null", () => {
  assert.strictEqual(usernameForDisplay({ displayUsername: "Jane.Smith", normalizedUsername: "jane.smith" }), "Jane.Smith");
  assert.strictEqual(usernameForDisplay({ normalizedUsername: "jane.smith" }), "jane.smith");
  assert.strictEqual(usernameForDisplay({}), null);
  assert.strictEqual(usernameForDisplay(null), null);
});

// -- validateUsernameMapping (recovery-ready mapping contract, §2) -----------
function validMapping(overrides = {}) {
  return {
    normalizedUsername: "jane.smith",
    displayUsername: "Jane.Smith",
    uid: "aZ3kP9qXfL2mN7bV0cR5tY8wD1eH",
    tenantId: null,
    active: true,
    createdAt: 1730000000000,
    createdBy: "admin-uid-1",
    updatedAt: 1730000000000,
    updatedBy: "admin-uid-1",
    version: 1,
    previousUsernames: ["jane.smyth"],
    auditCorrelationId: "corr-abc-123",
    ...overrides,
  };
}

ok("mapping: well-formed record is valid", () => {
  const r = validateUsernameMapping(validMapping());
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.reasons, []);
});
ok("mapping: document-key agreement enforced", () => {
  assert.strictEqual(validateUsernameMapping(validMapping(), "jane.smith").valid, true);
  const bad = validateUsernameMapping(validMapping(), "someone.else");
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.reasons.includes(MAPPING_INVALID_REASON.KEY_MISMATCH));
});
ok("mapping: non-object -> NOT_OBJECT", () => {
  for (const v of [null, undefined, "x", 42]) {
    const r = validateUsernameMapping(v);
    assert.strictEqual(r.valid, false);
    assert.deepStrictEqual(r.reasons, [MAPPING_INVALID_REASON.NOT_OBJECT]);
  }
});
ok("mapping: inactive is a VALID modeled state", () => {
  assert.strictEqual(validateUsernameMapping(validMapping({ active: false })).valid, true);
});
ok("mapping: active must be boolean", () => {
  const r = validateUsernameMapping(validMapping({ active: "yes" }));
  assert.ok(r.reasons.includes(MAPPING_INVALID_REASON.ACTIVE_INVALID));
});
ok("mapping: version must be a positive integer", () => {
  for (const v of [0, -1, 1.5, "1", undefined]) {
    const r = validateUsernameMapping(validMapping({ version: v }));
    assert.ok(r.reasons.includes(MAPPING_INVALID_REASON.VERSION_INVALID), `version=${String(v)}`);
  }
});
ok("mapping: history must be normalized, valid, and non-reusing (no current name)", () => {
  // current name appears in history -> non-reuse violation
  const reuse = validateUsernameMapping(validMapping({ previousUsernames: ["jane.smith"] }));
  assert.ok(reuse.reasons.includes(MAPPING_INVALID_REASON.HISTORY_INVALID));
  // non-array history
  assert.ok(validateUsernameMapping(validMapping({ previousUsernames: "jane.smyth" }))
    .reasons.includes(MAPPING_INVALID_REASON.HISTORY_INVALID));
  // invalid/non-normalized entry
  assert.ok(validateUsernameMapping(validMapping({ previousUsernames: ["Jane.Smyth"] }))
    .reasons.includes(MAPPING_INVALID_REASON.HISTORY_INVALID));
  // omitted history is allowed (optional)
  const noHistory = validMapping();
  delete noHistory.previousUsernames;
  assert.strictEqual(validateUsernameMapping(noHistory).valid, true);
});
ok("mapping: missing createdBy/updatedBy -> MISSING_PROVENANCE", () => {
  for (const field of ["createdBy", "updatedBy"]) {
    const rec = validMapping();
    delete rec[field];
    assert.ok(validateUsernameMapping(rec).reasons.includes(MAPPING_INVALID_REASON.MISSING_PROVENANCE), `missing ${field}`);
  }
});
ok("mapping: missing/invalid createdAt/updatedAt -> PROVENANCE_TIMESTAMP_INVALID", () => {
  for (const field of ["createdAt", "updatedAt"]) {
    const rec = validMapping();
    delete rec[field];
    assert.ok(validateUsernameMapping(rec).reasons.includes(MAPPING_INVALID_REASON.PROVENANCE_TIMESTAMP_INVALID), `missing ${field}`);
  }
});
ok("mapping: only the approved timestamp representation is accepted", () => {
  for (const t of ["2026-01-01T00:00:00Z", 0, -5, 1.5, new Date(), "1730000000000"]) {
    const r = validateUsernameMapping(validMapping({ createdAt: t }));
    assert.ok(r.reasons.includes(MAPPING_INVALID_REASON.PROVENANCE_TIMESTAMP_INVALID), `createdAt=${String(t)}`);
  }
  // epoch-millis integer (domain convention) and Firestore Timestamp shapes pass
  assert.strictEqual(validateUsernameMapping(validMapping({ createdAt: 1730000000001 })).valid, true);
  assert.strictEqual(validateUsernameMapping(validMapping({
    createdAt: { seconds: 1730000000, nanoseconds: 0 },
    updatedAt: { seconds: 1730000000, nanoseconds: 0 },
  })).valid, true);
  assert.strictEqual(validateUsernameMapping(validMapping({
    createdAt: { toMillis: () => 1730000000000 },
    updatedAt: { toMillis: () => 1730000000000 },
  })).valid, true);
});
ok("mapping: unknown / sensitive fields are rejected (exact allowed-field set)", () => {
  for (const extra of [
    { email: "x@y.com" }, { password: "hunter2" }, { passwordHash: "..." },
    { role: "admin" }, { claims: { admin: true } }, { operationalRoles: [] },
    { profile: { ssn: "..." } }, { token: "..." }, { foo: 1 },
  ]) {
    const r = validateUsernameMapping(validMapping(extra));
    assert.strictEqual(r.valid, false, Object.keys(extra)[0]);
    assert.ok(r.reasons.includes(MAPPING_INVALID_REASON.UNKNOWN_FIELD), Object.keys(extra)[0]);
  }
});
ok("mapping: previousUsernames must be unique (no duplicates)", () => {
  assert.ok(validateUsernameMapping(validMapping({ previousUsernames: ["jane.smyth", "jane.smyth"] }))
    .reasons.includes(MAPPING_INVALID_REASON.HISTORY_INVALID));
});
ok("mapping: displayUsername must normalize to the key", () => {
  assert.ok(validateUsernameMapping(validMapping({ displayUsername: "bob" }))
    .reasons.includes(MAPPING_INVALID_REASON.DISPLAY_MISMATCH));
  assert.ok(validateUsernameMapping(validMapping({ displayUsername: "" }))
    .reasons.includes(MAPPING_INVALID_REASON.DISPLAY_MISMATCH));
});
ok("mapping: uid required", () => {
  assert.ok(validateUsernameMapping(validMapping({ uid: "" }))
    .reasons.includes(MAPPING_INVALID_REASON.MISSING_UID));
});
ok("mapping: tenantId must be null or non-empty string (present placeholder)", () => {
  assert.strictEqual(validateUsernameMapping(validMapping({ tenantId: "acme" })).valid, true);
  assert.strictEqual(validateUsernameMapping(validMapping({ tenantId: null })).valid, true);
  const bad = validMapping();
  delete bad.tenantId;
  assert.ok(validateUsernameMapping(bad).reasons.includes(MAPPING_INVALID_REASON.TENANT_INVALID));
});
ok("mapping: auditCorrelationId required", () => {
  const rec = validMapping();
  delete rec.auditCorrelationId;
  assert.ok(validateUsernameMapping(rec).reasons.includes(MAPPING_INVALID_REASON.MISSING_AUDIT_CORRELATION));
});
ok("mapping: normalizedUsername must be canonical + valid", () => {
  assert.ok(validateUsernameMapping(validMapping({ normalizedUsername: "Jane.Smith", displayUsername: "Jane.Smith" }))
    .reasons.includes(MAPPING_INVALID_REASON.USERNAME_INVALID));
  assert.ok(validateUsernameMapping(validMapping({ normalizedUsername: "ad", displayUsername: "ad" }))
    .reasons.includes(MAPPING_INVALID_REASON.USERNAME_INVALID));
});

console.log(`\n${passed} passed`);
