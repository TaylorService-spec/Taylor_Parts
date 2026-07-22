// INV-1 Phase 1, PR 1.1 -- pure unit-of-measure model and the single
// conversion authority (ADR-008 / spec §11; O-4). NO floating-point
// authoritative math: quantities are decimal STRINGS validated to per-unit
// precision and converted via scaled-integer arithmetic (numerator/
// denominator integer ratios). Historical transactions preserve their
// original quantity+unit elsewhere -- this module never restates history.

import { UNIT_CODES } from "./types";
import type { ConversionFactor, Result, RoundingPolicy, UnitCode, UnitDefinition, ValidationIssue } from "./types";

function invalid(path: string, code: ValidationIssue["code"], message: string): Result<never> {
  return { valid: false, errors: [{ code, path, message }] };
}

// Unit registry: configuration-shaped (a later gate may externalize it);
// covers the units observed in the current catalog (ea->EACH, kit->KIT,
// bottle->BOTTLE, tube->TUBE) plus the approved measured units.
export const UNIT_DEFINITIONS: Readonly<Record<UnitCode, UnitDefinition>> = {
  EACH: { code: "EACH", label: "each", precision: 0, fractional: false },
  KIT: { code: "KIT", label: "kit", precision: 0, fractional: false },
  BOTTLE: { code: "BOTTLE", label: "bottle", precision: 0, fractional: false },
  TUBE: { code: "TUBE", label: "tube", precision: 0, fractional: false },
  BOX: { code: "BOX", label: "box", precision: 0, fractional: false },
  CASE: { code: "CASE", label: "case", precision: 0, fractional: false },
  ROLL: { code: "ROLL", label: "roll", precision: 0, fractional: false },
  FOOT: { code: "FOOT", label: "foot", precision: 2, fractional: true },
  GALLON: { code: "GALLON", label: "gallon", precision: 2, fractional: true },
  OUNCE: { code: "OUNCE", label: "ounce", precision: 2, fractional: true },
  POUND: { code: "POUND", label: "pound", precision: 2, fractional: true },
};

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === "string" && (UNIT_CODES as readonly string[]).includes(value);
}

/** Parse a decimal-string quantity for a unit: precision- and sign-checked. */
export function parseQuantity(unit: UnitCode, quantity: string): Result<{ scaled: bigint; precision: number }> {
  const def = UNIT_DEFINITIONS[unit];
  if (typeof quantity !== "string" || !/^-?\d+(\.\d+)?$/.test(quantity.trim())) {
    return invalid("quantity", "INVALID_FORMAT", "quantity must be a decimal string");
  }
  const trimmed = quantity.trim();
  if (trimmed.startsWith("-")) {
    return invalid("quantity", "OUT_OF_RANGE", "quantity must not be negative");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > def.precision) {
    return invalid("quantity", "PRECISION_EXCEEDED", `${unit} allows ${def.precision} decimal place(s), got ${frac.length}`);
  }
  if (!def.fractional && frac.length > 0 && Number(frac) !== 0) {
    return invalid("quantity", "PRECISION_EXCEEDED", `${unit} is integer-only`);
  }
  const scaled = BigInt(whole + frac.padEnd(def.precision, "0"));
  return { valid: true, value: { scaled, precision: def.precision } };
}

export function validateConversionFactor(factor: ConversionFactor): Result<ConversionFactor> {
  if (!Number.isInteger(factor.numerator) || !Number.isInteger(factor.denominator) || factor.numerator <= 0 || factor.denominator <= 0) {
    return invalid("conversionFactor", "OUT_OF_RANGE", "conversion factor must be a positive integer ratio");
  }
  return { valid: true, value: factor };
}

function renderScaled(scaled: bigint, precision: number): string {
  const s = scaled.toString().padStart(precision + 1, "0");
  return precision === 0 ? s : `${s.slice(0, -precision)}.${s.slice(-precision)}`;
}

/**
 * Convert a purchase-unit quantity to the stocking unit (or back with the
 * inverted factor). Scaled-integer math; HALF_UP rounds at the target unit's
 * precision; REJECT_INEXACT returns PRECISION_EXCEEDED when the conversion
 * is not exact at that precision (the reversibility-safe policy).
 */
export function convertQuantity(
  fromUnit: UnitCode,
  toUnit: UnitCode,
  quantity: string,
  factor: ConversionFactor,
  policy: RoundingPolicy
): Result<string> {
  const factorCheck = validateConversionFactor(factor);
  if (!factorCheck.valid) return factorCheck;
  const parsed = parseQuantity(fromUnit, quantity);
  if (!parsed.valid) return parsed;

  const toDef = UNIT_DEFINITIONS[toUnit];
  const fromPrecision = BigInt(10) ** BigInt(parsed.value.precision);
  const toPrecision = BigInt(10) ** BigInt(toDef.precision);

  // target_scaled = qty_scaled/fromPrecision * num/den * toPrecision
  const numerator = parsed.value.scaled * BigInt(factor.numerator) * toPrecision;
  const denominator = fromPrecision * BigInt(factor.denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) {
    return { valid: true, value: renderScaled(quotient, toDef.precision) };
  }
  if (policy === "REJECT_INEXACT") {
    return invalid("quantity", "PRECISION_EXCEEDED", `conversion is not exact at ${toUnit} precision ${toDef.precision}`);
  }
  // HALF_UP on the true remainder.
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return { valid: true, value: renderScaled(rounded, toDef.precision) };
}
