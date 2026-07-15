// Enterprise Access & Administration Platform (Issue #226) -- the
// compact-claims shape validator + accessVersion freshness comparison.
// Fixed by docs/specifications/enterprise-access-and-administration-
// platform.md sec11 and sequenced by docs/implementation-plans/
// enterprise-access-and-administration-platform.md (Row 6 / Task 11).
//
// PURE, dependency-free (no firebase-admin import) -- this module only
// validates/compares; it does not mint, refresh, or revoke a real
// token (that is claimsWriter.ts, the server-side counterpart). Claims
// are NOT activated in production by this row -- see claimsWriter.ts's
// own header for the #15-gating this Task explicitly preserves.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/access/compactClaims.ts. If either
// file changes, change the other to match.
import type { CompactClaims } from "../types/access";

export class CompactClaimsValidationError extends Error {}

// Spec sec11: "Custom claims are limited to" exactly these four keys.
// Never detailed permissions, Scopes, Conditions, approval limits, or
// territory lists (hard prohibition) -- enforced here by construction:
// buildCompactClaims only ever reads these four keys off its input and
// throws if the input carries anything else, so a caller cannot smuggle
// an extra field into a claims payload through this module.
const ALLOWED_CLAIM_KEYS = ["companyId", "platformAdmin", "companyAdmin", "accessVersion"] as const;

export interface CompactClaimsInput {
  companyId?: string;
  platformAdmin?: boolean;
  companyAdmin?: boolean;
  accessVersion: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Builds a validated CompactClaims payload. Throws (fail-closed) on:
// any key outside the four permitted ones; a wrong-typed permitted
// key; or a missing/invalid accessVersion (the one required field --
// every claims payload this platform ever mints carries it, per Spec
// sec11's revocation-latency design).
export function buildCompactClaims(input: unknown): CompactClaims {
  if (!isPlainObject(input)) {
    throw new CompactClaimsValidationError("claims input must be an object");
  }
  const extraKeys = Object.keys(input).filter(
    (key) => !ALLOWED_CLAIM_KEYS.includes(key as (typeof ALLOWED_CLAIM_KEYS)[number]),
  );
  if (extraKeys.length > 0) {
    throw new CompactClaimsValidationError(
      `claims may only contain ${ALLOWED_CLAIM_KEYS.join(", ")} -- rejected extra key(s): ${extraKeys.join(", ")}`,
    );
  }
  if (
    typeof input.accessVersion !== "number" ||
    !Number.isInteger(input.accessVersion) ||
    input.accessVersion < 0
  ) {
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

  const claims: CompactClaims = { accessVersion: input.accessVersion };
  if (input.companyId !== undefined) claims.companyId = input.companyId;
  if (input.platformAdmin !== undefined) claims.platformAdmin = input.platformAdmin;
  if (input.companyAdmin !== undefined) claims.companyAdmin = input.companyAdmin;
  return claims;
}

// Spec sec11: "A mismatch (stale token) fails closed -- the request is
// denied until the client refreshes." Any mismatch (not merely
// "token is behind") is treated as stale: a token accessVersion GREATER
// than the authoritative value is impossible under a correctly
// operating writer and must never be treated as more-trusted-than-
// authoritative, so this is a strict inequality check, not a
// less-than-only check.
export function isAccessVersionStale(
  tokenAccessVersion: number,
  authoritativeAccessVersion: number,
): boolean {
  return tokenAccessVersion !== authoritativeAccessVersion;
}

export class StaleAccessVersionError extends Error {}

// Fail-closed helper an enforcement point calls before trusting any
// claim beyond accessVersion itself (Spec sec13).
export function assertFreshAccessVersion(
  tokenAccessVersion: number,
  authoritativeAccessVersion: number,
): void {
  if (isAccessVersionStale(tokenAccessVersion, authoritativeAccessVersion)) {
    throw new StaleAccessVersionError(
      `token accessVersion (${tokenAccessVersion}) does not match the authoritative value (${authoritativeAccessVersion}) -- refresh required`,
    );
  }
}
