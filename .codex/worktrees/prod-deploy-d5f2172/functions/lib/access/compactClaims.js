"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleAccessVersionError = exports.CompactClaimsValidationError = void 0;
exports.isValidAccessVersionValue = isValidAccessVersionValue;
exports.buildCompactClaims = buildCompactClaims;
exports.isAccessVersionStale = isAccessVersionStale;
exports.assertFreshAccessVersion = assertFreshAccessVersion;
class CompactClaimsValidationError extends Error {
}
exports.CompactClaimsValidationError = CompactClaimsValidationError;
// Spec sec11: "Custom claims are limited to" exactly these four keys.
// Never detailed permissions, Scopes, Conditions, approval limits, or
// territory lists (hard prohibition) -- enforced here by construction:
// buildCompactClaims only ever reads these four keys off its input and
// throws if the input carries anything else, so a caller cannot smuggle
// an extra field into a claims payload through this module.
const ALLOWED_CLAIM_KEYS = ["companyId", "platformAdmin", "companyAdmin", "accessVersion"];
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// The one shape an accessVersion (from EITHER side of a comparison, or
// from claims-build input) is ever allowed to have: a finite,
// non-negative integer. `unknown` in, not `number` in -- a decoded JWT
// claim or a value read back from storage is untrusted data, never
// something a TypeScript parameter annotation actually validates at
// runtime (Customer review round 3 finding). Number.isInteger() alone
// already excludes NaN/Infinity/fractions/strings/objects/arrays;
// Number.isFinite() is kept alongside it for explicitness matching the
// Specification's "finite, non-negative integer" wording exactly.
function isValidAccessVersionValue(value) {
    return (typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= 0);
}
// Builds a validated CompactClaims payload. Throws (fail-closed) on:
// any key outside the four permitted ones; a wrong-typed permitted
// key; or a missing/invalid accessVersion (the one required field --
// every claims payload this platform ever mints carries it, per Spec
// sec11's revocation-latency design).
function buildCompactClaims(input) {
    if (!isPlainObject(input)) {
        throw new CompactClaimsValidationError("claims input must be an object");
    }
    const extraKeys = Object.keys(input).filter((key) => !ALLOWED_CLAIM_KEYS.includes(key));
    if (extraKeys.length > 0) {
        throw new CompactClaimsValidationError(`claims may only contain ${ALLOWED_CLAIM_KEYS.join(", ")} -- rejected extra key(s): ${extraKeys.join(", ")}`);
    }
    if (!isValidAccessVersionValue(input.accessVersion)) {
        throw new CompactClaimsValidationError("accessVersion must be a non-negative integer");
    }
    if (input.companyId !== undefined && typeof input.companyId !== "string") {
        throw new CompactClaimsValidationError("companyId must be a string when present");
    }
    if (input.platformAdmin !== undefined && typeof input.platformAdmin !== "boolean") {
        throw new CompactClaimsValidationError("platformAdmin must be a boolean when present");
    }
    if (input.companyAdmin !== undefined && typeof input.companyAdmin !== "boolean") {
        throw new CompactClaimsValidationError("companyAdmin must be a boolean when present");
    }
    const claims = { accessVersion: input.accessVersion };
    if (input.companyId !== undefined)
        claims.companyId = input.companyId;
    if (input.platformAdmin !== undefined)
        claims.platformAdmin = input.platformAdmin;
    if (input.companyAdmin !== undefined)
        claims.companyAdmin = input.companyAdmin;
    return claims;
}
// Spec sec11: "A mismatch (stale token) fails closed -- the request is
// denied until the client refreshes." Spec sec13: malformed access data
// must fail closed too. Both values arrive as `unknown` -- a decoded
// JWT claim (tokenAccessVersion) is untrusted data by definition, and
// the "authoritative" value may itself come from an untrusted read
// path upstream of this function; a TypeScript `number` annotation
// does NOT validate either one at runtime (Customer review round 3
// finding: identical malformed values, e.g. `-1 === -1` or `"1" === "1"`,
// previously compared equal and were wrongly treated as fresh).
//
// Correction: EITHER value failing the finite/non-negative/integer
// shape check makes the pair stale, full stop -- never reached by the
// equality comparison at all. Only when BOTH values are validly
// shaped does this fall through to the equality check, which remains
// a strict inequality (not less-than-only): a token accessVersion
// GREATER than the authoritative value is impossible under a correctly
// operating writer and must never be treated as more-trusted-than-
// authoritative, so both lower AND higher valid values are stale.
function isAccessVersionStale(tokenAccessVersion, authoritativeAccessVersion) {
    if (!isValidAccessVersionValue(tokenAccessVersion) ||
        !isValidAccessVersionValue(authoritativeAccessVersion)) {
        return true;
    }
    return tokenAccessVersion !== authoritativeAccessVersion;
}
class StaleAccessVersionError extends Error {
}
exports.StaleAccessVersionError = StaleAccessVersionError;
// Fail-closed helper an enforcement point calls before trusting any
// claim beyond accessVersion itself (Spec sec13). Rejects missing,
// malformed, or mismatched values -- distinguished only in the thrown
// message, never in the fail-closed outcome.
function assertFreshAccessVersion(tokenAccessVersion, authoritativeAccessVersion) {
    if (!isValidAccessVersionValue(tokenAccessVersion) ||
        !isValidAccessVersionValue(authoritativeAccessVersion)) {
        throw new StaleAccessVersionError(`accessVersion comparison failed closed -- malformed or missing value (token=${JSON.stringify(tokenAccessVersion)}, authoritative=${JSON.stringify(authoritativeAccessVersion)})`);
    }
    if (isAccessVersionStale(tokenAccessVersion, authoritativeAccessVersion)) {
        throw new StaleAccessVersionError(`token accessVersion (${tokenAccessVersion}) does not match the authoritative value (${authoritativeAccessVersion}) -- refresh required`);
    }
}
//# sourceMappingURL=compactClaims.js.map