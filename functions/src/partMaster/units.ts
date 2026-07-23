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

// ===========================================================================
// INV-1 Phase 1, PR 1.5 -- governed unit-conversion model extension
// (ADR-008 Accepted / Decision #40). Pure additions to the SINGLE unit
// authority: unit families with compatibility checks, exact decimal-string
// conversion factors (never floats), canonical intra-family ratios for
// measured units, and star-topology part unit profiles (every conversion
// targets the canonical stocking unit -- cycles are impossible by
// construction, so a circular/ambiguous chain is rejected as a non-star
// spec). No inventory quantities are recalculated; no history is
// rewritten; canonical partId is untouched by any unit concern.
// ===========================================================================

export const UNIT_FAMILIES = ["COUNT", "LENGTH", "VOLUME", "WEIGHT"] as const;
export type UnitFamily = (typeof UNIT_FAMILIES)[number];

export const UNIT_FAMILY_OF: Readonly<Record<UnitCode, UnitFamily>> = {
  EACH: "COUNT", KIT: "COUNT", BOTTLE: "COUNT", TUBE: "COUNT",
  BOX: "COUNT", CASE: "COUNT", ROLL: "COUNT",
  FOOT: "LENGTH",
  GALLON: "VOLUME",
  OUNCE: "WEIGHT", POUND: "WEIGHT",
};

/** Same-family check: conversions across unit families are ALWAYS rejected
 * (a CASE of gallons is a packaging fact, not a unit conversion -- it stays
 * a COUNT-family part-specific factor). */
export function areUnitsCompatible(a: UnitCode, b: UnitCode): boolean {
  return UNIT_FAMILY_OF[a] === UNIT_FAMILY_OF[b];
}

/** Canonical fixed intra-family ratios for MEASURED units (exact, integer):
 * factor converts 1 <from> into <ratio> of <to>. COUNT-family pairs have NO
 * canonical ratio -- pack sizes are part/supplier-specific by design. */
const CANONICAL_RATIOS: ReadonlyArray<{ from: UnitCode; to: UnitCode; factor: ConversionFactor }> = [
  { from: "POUND", to: "OUNCE", factor: { numerator: 16, denominator: 1 } },
];

export function canonicalRatio(from: UnitCode, to: UnitCode): ConversionFactor | null {
  if (from === to) return { numerator: 1, denominator: 1 };
  for (const r of CANONICAL_RATIOS) {
    if (r.from === from && r.to === to) return r.factor;
    if (r.from === to && r.to === from) return { numerator: r.factor.denominator, denominator: r.factor.numerator };
  }
  return null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Normalize an integer ratio to lowest terms (deterministic). */
export function reduceFactor(factor: ConversionFactor): Result<ConversionFactor> {
  const checked = validateConversionFactor(factor);
  if (!checked.valid) return checked;
  const g = gcd(factor.numerator, factor.denominator);
  return { valid: true, value: { numerator: factor.numerator / g, denominator: factor.denominator / g } };
}

const FACTOR_DECIMAL_PATTERN = /^\d+(\.\d{1,6})?$/;

/** Parse an EXACT decimal-string conversion factor (e.g. "2.5") into a
 * reduced integer ratio. Rejects zero, negative, NaN/Infinity shapes,
 * floats-as-numbers, and anything beyond 6 decimal places. */
export function parseDecimalFactor(text: string): Result<ConversionFactor> {
  if (typeof text !== "string" || !FACTOR_DECIMAL_PATTERN.test(text.trim())) {
    return {
      valid: false,
      errors: [{ code: "INVALID_FORMAT", path: "factor", message: "factor must be a positive decimal string (max 6 dp)" }],
    };
  }
  const trimmed = text.trim();
  const [whole, frac = ""] = trimmed.split(".");
  const numerator = Number(whole + frac);
  const denominator = 10 ** frac.length;
  if (!Number.isSafeInteger(numerator) || numerator <= 0) {
    return {
      valid: false,
      errors: [{ code: "OUT_OF_RANGE", path: "factor", message: "factor must be positive and within safe-integer range" }],
    };
  }
  return reduceFactor({ numerator, denominator });
}

/** One governed conversion edge: 1 <fromUnit> = factor <toUnit>. */
export interface UnitConversionSpec {
  readonly fromUnit: UnitCode;
  readonly toUnit: UnitCode;
  readonly factor: ConversionFactor;
}

export function validateConversionSpec(spec: UnitConversionSpec): Result<UnitConversionSpec> {
  if (!isUnitCode(spec.fromUnit) || !isUnitCode(spec.toUnit)) {
    return { valid: false, errors: [{ code: "INVALID_ENUM", path: "unit", message: "unknown unit code" }] };
  }
  if (spec.fromUnit === spec.toUnit) {
    return { valid: false, errors: [{ code: "INVALID_COMBINATION", path: "toUnit", message: "conversion between identical units is ambiguous -- omit it" }] };
  }
  if (!areUnitsCompatible(spec.fromUnit, spec.toUnit)) {
    return { valid: false, errors: [{ code: "INVALID_COMBINATION", path: "toUnit", message: `incompatible unit families ${UNIT_FAMILY_OF[spec.fromUnit]} -> ${UNIT_FAMILY_OF[spec.toUnit]}` }] };
  }
  const reduced = reduceFactor(spec.factor);
  if (!reduced.valid) return reduced;
  return { valid: true, value: { ...spec, factor: reduced.value } };
}

/** Star-topology part unit profile: purchase and issue units each convert
 * DIRECTLY to the canonical stocking unit. Any spec targeting anything else
 * is rejected -- which makes circular/ambiguous chains structurally
 * impossible (exactly one canonical unit, all edges point at it). */
export interface PartUnitProfile {
  readonly stockingUnit: UnitCode;
  readonly purchase?: UnitConversionSpec;
  readonly issue?: UnitConversionSpec;
}

export function validatePartUnitProfile(profile: PartUnitProfile): Result<PartUnitProfile> {
  if (!isUnitCode(profile.stockingUnit)) {
    return { valid: false, errors: [{ code: "INVALID_ENUM", path: "stockingUnit", message: "unknown stocking unit" }] };
  }
  const out: { stockingUnit: UnitCode; purchase?: UnitConversionSpec; issue?: UnitConversionSpec } = { stockingUnit: profile.stockingUnit };
  for (const key of ["purchase", "issue"] as const) {
    const spec = profile[key];
    if (spec === undefined) continue;
    const checked = validateConversionSpec(spec);
    if (!checked.valid) return checked;
    if (checked.value.toUnit !== profile.stockingUnit) {
      return {
        valid: false,
        errors: [{ code: "INVALID_COMBINATION", path: `${key}.toUnit`, message: "every conversion must target the canonical stocking unit (star topology -- no chains, no cycles)" }],
      };
    }
    out[key] = checked.value;
  }
  return { valid: true, value: out };
}

/** Convert between any two units of a star profile via the canonical
 * stocking unit (from -> stocking -> to), deterministically. */
export function convertViaProfile(
  profile: PartUnitProfile,
  fromUnit: UnitCode,
  toUnit: UnitCode,
  quantity: string,
  policy: RoundingPolicy
): Result<string> {
  const valid = validatePartUnitProfile(profile);
  if (!valid.valid) return valid;
  const edgeFor = (unit: UnitCode): Result<ConversionFactor> => {
    if (unit === profile.stockingUnit) return { valid: true, value: { numerator: 1, denominator: 1 } };
    for (const key of ["purchase", "issue"] as const) {
      const spec = valid.value[key];
      if (spec !== undefined && spec.fromUnit === unit) return { valid: true, value: spec.factor };
    }
    const canonical = canonicalRatio(unit, profile.stockingUnit);
    if (canonical !== null) return { valid: true, value: canonical };
    return { valid: false, errors: [{ code: "INVALID_COMBINATION", path: "unit", message: `no governed conversion from ${unit} to ${profile.stockingUnit}` }] };
  };
  const fromEdge = edgeFor(fromUnit);
  if (!fromEdge.valid) return fromEdge;
  const toEdge = edgeFor(toUnit);
  if (!toEdge.valid) return toEdge;
  // from -> stocking (multiply by fromEdge), stocking -> to (divide by
  // toEdge): combined = fromEdge * inverse(toEdge), composed exactly in
  // integers before any rounding decision.
  const combined = reduceFactor({
    numerator: fromEdge.value.numerator * toEdge.value.denominator,
    denominator: fromEdge.value.denominator * toEdge.value.numerator,
  });
  if (!combined.valid) return combined;
  return convertQuantity(fromUnit, toUnit, quantity, combined.value, policy);
}
