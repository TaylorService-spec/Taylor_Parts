// INV-1 Phase 1, PR 1.1 -- the SINGLE identifier normalization authority
// (ADR-008 / spec §2). Pure, deterministic, locale-independent (explicit
// ASCII-only case mapping concerns: toUpperCase() on identifier charsets we
// validate to [A-Za-z0-9 ._/#-], so no locale-sensitive letters survive to
// the case fold). Never silently changes meaning: invalid input returns an
// explicit invalid Result; the original display value is preserved by the
// caller (PartAlias.rawValue), never by mutation here.

import type { AliasType, ManufacturerId, Result, ValidationIssue } from "./types";

const MAX_IDENTIFIER_LENGTH = 120;

// Numeric GS1 symbologies: digits only, exact lengths, leading zeroes
// meaningful -- ALWAYS strings, never parsed to JS numbers.
const NUMERIC_LENGTHS: Partial<Record<AliasType, readonly number[]>> = {
  UPC: [12],
  EAN: [13],
  GTIN: [8, 12, 13, 14],
};

// Permitted characters for non-numeric identifier types after whitespace
// collapse (conservative allow-list; punctuation is preserved, not stripped,
// for MPN/SKU-class values -- stripping could merge distinct identifiers).
const TEXT_IDENTIFIER_PATTERN = /^[A-Z0-9 ._/#-]+$/;

function invalid(path: string, code: ValidationIssue["code"], message: string): Result<never> {
  return { valid: false, errors: [{ code, path, message }] };
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Normalize an identifier value for its alias type. MANUFACTURER_PN requires
 * the manufacturer scope (per-manufacturer uniqueness) and embeds it in the
 * normalized value as `<manufacturerId>|<value>`.
 */
export function normalizeIdentifier(
  aliasType: AliasType,
  rawValue: string,
  manufacturerId?: ManufacturerId
): Result<string> {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return invalid("rawValue", "REQUIRED", "identifier value must be a non-empty string");
  }
  if (rawValue.length > MAX_IDENTIFIER_LENGTH) {
    return invalid("rawValue", "OUT_OF_RANGE", `identifier exceeds ${MAX_IDENTIFIER_LENGTH} characters`);
  }

  const numericLengths = NUMERIC_LENGTHS[aliasType];
  if (numericLengths !== undefined) {
    // UPC/EAN/GTIN: strip spaces and hyphens only; everything left must be
    // digits; leading zeroes preserved (string domain, never Number()).
    const digits = rawValue.replace(/[\s-]/g, "");
    if (!/^\d+$/.test(digits)) {
      return invalid("rawValue", "INVALID_FORMAT", `${aliasType} must contain only digits (plus separators)`);
    }
    if (!numericLengths.includes(digits.length)) {
      return invalid(
        "rawValue",
        "OUT_OF_RANGE",
        `${aliasType} length must be ${numericLengths.join("/")} digits, got ${digits.length}`
      );
    }
    return { valid: true, value: digits };
  }

  const collapsed = collapseWhitespace(rawValue).toUpperCase();
  if (!TEXT_IDENTIFIER_PATTERN.test(collapsed)) {
    return invalid("rawValue", "INVALID_FORMAT", "identifier contains unsupported characters");
  }

  if (aliasType === "MANUFACTURER_PN") {
    if (manufacturerId === undefined || manufacturerId.length === 0) {
      return invalid("manufacturerId", "REQUIRED", "MANUFACTURER_PN normalization requires a manufacturer scope");
    }
    return { valid: true, value: `${manufacturerId}|${collapsed}` };
  }
  if (manufacturerId !== undefined) {
    return invalid("manufacturerId", "CONFLICTING_FIELDS", `manufacturer scope is only valid for MANUFACTURER_PN, not ${aliasType}`);
  }
  return { valid: true, value: collapsed };
}

/**
 * GS1 mod-10 check-digit validator (UPC-A/EAN-13/GTIN-8/12/13/14). Optional
 * by design: legacy/non-GS1 records are NOT rejected by normalization for
 * failing this -- callers opt in where strictness is warranted (spec §2).
 */
export function validateGs1CheckDigit(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  // GS1: from the RIGHT of the body, weights alternate 3,1,3,1...
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Deterministic future storage key for an alias: `<type>__<normalizedValue>`.
 * Structural-uniqueness scheme approved by O-3; storage-independent here
 * (a later gated PR maps it to a document ID; a future tenant scope prefixes
 * it under Issue #140 without redesign).
 */
export function buildAliasKey(aliasType: AliasType, normalizedValue: string): Result<string> {
  if (typeof normalizedValue !== "string" || normalizedValue.length === 0) {
    return invalid("normalizedValue", "REQUIRED", "normalized value must be non-empty");
  }
  return { valid: true, value: `${aliasType}__${normalizedValue}` };
}
