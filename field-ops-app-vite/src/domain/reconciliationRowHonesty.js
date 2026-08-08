// Three independent persona missions reported the same thing on the Operations
// Overview reconciliation table:
//
//   Expected 0 · Actual NaN · Variance NaN · Severity CRITICAL
//
// summarised as "5 discrepancies -- 5 critical". A service manager read that as
// a real inventory emergency. It is not: it is a row the system could not
// evaluate, wearing the badge it uses for its most serious finding.
//
// A row whose quantities are not finite numbers is UNKNOWN. It is not CRITICAL,
// it is not zero, and it is not quietly dropped either -- an unevaluable row is
// itself worth seeing, just not worth alarming about. This is the same
// four-state honesty rule the rest of the codebase follows (LOADING / EMPTY /
// DENIED / UNAVAILABLE stay distinct): never let "I don't know" render as a
// confident answer.
//
// The upstream computation that produces NaN is a separate defect with a
// separate owner. This module makes sure the UI stops asserting something it
// cannot support in the meantime.

const SEVERITY_UNKNOWN = "UNKNOWN";

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Classifies one reconciliation discrepancy row for honest display.
 * @returns {{trustworthy: boolean, severity: string, expected: number|null,
 *            actual: number|null, variance: number|null}}
 */
export function classifyReconciliationRow(row) {
  const expected = finiteOrNull(row && row.expectedQuantity);
  const actual = finiteOrNull(row && row.actualQuantity);
  const rawSeverity = row && typeof row.severity === "string" ? row.severity : null;

  if (expected === null || actual === null) {
    return { trustworthy: false, severity: SEVERITY_UNKNOWN, expected, actual, variance: null };
  }

  // Trust the reported variance only if it is itself a number; otherwise derive
  // it from two figures we have already confirmed are real.
  const variance = finiteOrNull(row.variance) ?? actual - expected;
  return {
    trustworthy: true,
    severity: rawSeverity ?? SEVERITY_UNKNOWN,
    expected,
    actual,
    variance,
  };
}

/** Display text for a quantity that may not be knowable. Never renders NaN. */
export function quantityText(value) {
  return value === null ? "Unknown" : String(value);
}

/** Display text for a variance, signed when positive. Never renders NaN. */
export function varianceText(value) {
  if (value === null) return "Unknown";
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Severity counts that exclude rows the system could not evaluate, plus a
 * separate count of those rows -- so "5 critical" can never be built out of
 * arithmetic that failed.
 */
export function summariseReconciliation(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let unevaluable = 0;

  for (const row of list) {
    const { trustworthy, severity } = classifyReconciliationRow(row);
    if (!trustworthy) {
      unevaluable += 1;
      continue;
    }
    if (severity in counts) counts[severity] += 1;
  }
  return { ...counts, unevaluable, evaluated: list.length - unevaluable, total: list.length };
}
