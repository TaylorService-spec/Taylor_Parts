// Numeric semantics — where a number is stored, where it is calculated, where it is shown.
//
// THE RULE THIS EXISTS FOR: formatting must never silently change an authoritative
// business value. A rate stored as 12.375% and displayed as 12.38% is correct; the same
// rate ROUNDED to 12.38 and then used in arithmetic is a business error that reconciles
// against nothing. So the three scales are separate fields, and display rounding is a
// pure function that returns a string.
//
// PERCENTAGE STORAGE IS EXPLICIT. `0.15` and `15` both mean "fifteen percent" to somebody,
// and neither is inferable from the value. Two subsystems guessing differently are wrong
// by a factor of one hundred while still looking plausible — which is why storageMode is
// required rather than defaulted.

export const NUMERIC_KIND = Object.freeze([
  "INTEGER",
  "DECIMAL",
  "PERCENTAGE",
  "RATIO",
  "CURRENCY",
  "QUANTITY",
]);

/** How a PERCENTAGE is physically stored. Required — never inferred. */
export const PERCENT_STORAGE_MODE = Object.freeze(["FRACTION", "PERCENT_UNITS"]);

/**
 * Rounding vocabulary.
 *
 * Only modes with testable semantics and a real EOS need. Adding modes for completeness
 * produces options nobody can explain the difference between at the moment they must
 * choose one.
 */
export const ROUNDING_MODE = Object.freeze(["HALF_UP", "HALF_EVEN", "DOWN", "UP", "FLOOR", "CEILING"]);

/** The three rounding occasions, which are not interchangeable. */
export const ROUNDING_STAGE = Object.freeze(["INPUT", "CALCULATION", "DISPLAY"]);

export function makeNumericSemantics(input = {}) {
  return Object.freeze({
    numericKind: input.numericKind,
    storageMode: input.storageMode ?? null, // PERCENTAGE only
    storageScale: input.storageScale ?? null,
    calculationScale: input.calculationScale ?? null,
    displayScale: input.displayScale ?? null,
    roundingMode: input.roundingMode ?? null,
    minimum: input.minimum ?? null,
    maximum: input.maximum ?? null,
    step: input.step ?? null,
    unit: input.unit ?? null,
    unitFamily: input.unitFamily ?? null,
    displayUnit: input.displayUnit ?? null,
  });
}

export function validateNumericSemantics(n, { at = "numeric" } = {}) {
  const problems = [];
  if (!n) {
    problems.push(`${at}: numeric semantics are required for a numeric field`);
    return problems;
  }
  if (!NUMERIC_KIND.includes(n.numericKind)) {
    problems.push(`${at}: numericKind "${n.numericKind}" is not a known NUMERIC_KIND`);
  }

  // The explicit-percentage rule. Everything else can carry a sensible default; this
  // cannot, because the two conventions differ by 100x and both look reasonable.
  if (n.numericKind === "PERCENTAGE" && !PERCENT_STORAGE_MODE.includes(n.storageMode)) {
    problems.push(`${at}: a PERCENTAGE must declare storageMode (${PERCENT_STORAGE_MODE.join(" or ")}) — it is never inferable`);
  }

  if (n.numericKind === "INTEGER" && n.storageScale) {
    problems.push(`${at}: an INTEGER cannot declare a storageScale`);
  }
  if (!ROUNDING_MODE.includes(n.roundingMode) && n.roundingMode !== null) {
    problems.push(`${at}: roundingMode "${n.roundingMode}" is not a known ROUNDING_MODE`);
  }

  // Display MAY be coarser than storage — that is the normal case and the whole point.
  // Display FINER than storage is the incoherent one: it shows precision that was never
  // captured, which reads as accuracy nobody has.
  const [storage, display] = [n.storageScale, n.displayScale];
  if (Number.isInteger(storage) && Number.isInteger(display) && display > storage) {
    problems.push(`${at}: displayScale ${display} exceeds storageScale ${storage} — it would show precision that was never stored`);
  }
  if (Number.isInteger(n.calculationScale) && Number.isInteger(storage) && n.calculationScale < storage) {
    problems.push(`${at}: calculationScale ${n.calculationScale} is coarser than storageScale ${storage} — calculating below stored precision discards captured value`);
  }
  if (n.minimum !== null && n.maximum !== null && n.minimum > n.maximum) {
    problems.push(`${at}: minimum ${n.minimum} exceeds maximum ${n.maximum}`);
  }
  if (n.numericKind === "QUANTITY" && !n.unit && !n.unitFamily) {
    // 12 what? An unqualified quantity is the ambiguity this kind exists to remove.
    problems.push(`${at}: a QUANTITY must declare a unit or a unitFamily — a bare number is not a quantity`);
  }
  return problems;
}

/** Round a number for DISPLAY. Returns a string, so the result cannot re-enter arithmetic. */
export function formatForDisplay(value, semantics) {
  if (value === null || value === undefined) return null;
  const scale = Number.isInteger(semantics?.displayScale) ? semantics.displayScale : 2;

  // A percentage stored as a fraction is multiplied HERE, at the display boundary, and
  // nowhere else. Doing it earlier would put a display convention into stored data.
  const shown = semantics?.numericKind === "PERCENTAGE" && semantics.storageMode === "FRACTION"
    ? value * 100
    : value;

  return applyRounding(shown, scale, semantics?.roundingMode ?? "HALF_UP").toFixed(scale);
}

/** The rounding modes, as arithmetic rather than as documentation. */
export function applyRounding(value, scale, mode = "HALF_UP") {
  const factor = 10 ** scale;
  const scaled = value * factor;
  switch (mode) {
    case "DOWN": return Math.trunc(scaled) / factor;
    case "UP": return (scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
    case "FLOOR": return Math.floor(scaled) / factor;
    case "CEILING": return Math.ceil(scaled) / factor;
    case "HALF_EVEN": {
      const floor = Math.floor(scaled);
      const diff = scaled - floor;
      if (diff > 0.5) return (floor + 1) / factor;
      if (diff < 0.5) return floor / factor;
      return (floor % 2 === 0 ? floor : floor + 1) / factor;
    }
    case "HALF_UP":
    default:
      return Math.sign(scaled) * Math.round(Math.abs(scaled)) / factor;
  }
}
