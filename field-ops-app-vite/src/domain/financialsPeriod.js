// FINANCIALS PERIOD — the preset vocabulary. The BOUNDARIES come from the reporting-period
// authority (G-05, Decision #163).
//
// ════════ WHAT CHANGED, AND WHY IT MATTERED ════════
//
// This file used to compute month, quarter and year boundaries itself, in whatever timezone the
// BROWSER happened to be in, and it did so for six live Financials screens. That made "this month" a
// property of where the viewer was sitting.
//
// Its own header defended that honestly — the family renders dates with toLocaleDateString(), so
// local boundaries kept a record and its printed date on the same side of the line — and the
// reasoning was sound while no governed reporting timezone existed. One does now: America/Phoenix
// for Taylor and Ventana. So the arithmetic moved to domain/reportingPeriod.js, and this file kept
// what it is actually for: the preset vocabulary, custom-range validation, and the words on the rail.
//
// ════════ THE PRESETS DID NOT CHANGE MEANING ════════
//
// Deliberately. "This month" still means the WHOLE month, not month-to-date. Those are different
// questions, and quietly converting one into the other would change what six shipped screens report
// without anyone having asked. The resolver supplies both shapes, so each preset maps to the one it
// always meant — and the two to-date presets are ADDITIVE.
//
// ════════ INCLUSIVE ENDS ARE PRESERVED, AND NOW DERIVED ════════
//
// The server compares eventMillis against periodEndMillis with a strict greater-than, so endMillis
// must be the LAST millisecond of the last day. That is unchanged. What changed is that it is no
// longer computed here as 23:59:59.999 — it is the resolver's endInclusiveMillis, derived from the
// single half-open boundary the authority owns. Which is how this file can no longer disagree with a
// goal window about where September ends.
//
// PURE: no clock of its own (callers pass nowMillis), no Firestore, no formatting.
import { resolveReportingPeriod, TAYLOR_VENTANA_REPORTING_CALENDAR } from "./reportingPeriod.js";

export const PERIOD_PRESETS = Object.freeze([
  Object.freeze({ key: "all", label: "All activity" }),
  Object.freeze({ key: "monthToDate", label: "Month to date" }),
  Object.freeze({ key: "thisMonth", label: "This month" }),
  Object.freeze({ key: "lastMonth", label: "Last month" }),
  Object.freeze({ key: "quarterToDate", label: "Quarter to date" }),
  Object.freeze({ key: "thisQuarter", label: "This quarter" }),
  Object.freeze({ key: "lastQuarter", label: "Last quarter" }),
  Object.freeze({ key: "yearToDate", label: "Year to date" }),
  Object.freeze({ key: "last12Months", label: "Last 12 months" }),
  Object.freeze({ key: "custom", label: "Custom range" }),
]);

export const DEFAULT_PERIOD_KEY = "all";

const CAL = TAYLOR_VENTANA_REPORTING_CALENDAR;

/** One resolution through the authority. */
const resolve = (periodType, nowMillis, comparisonMode = "NONE") =>
  resolveReportingPeriod({ calendar: CAL, periodType, asOfMillis: nowMillis, comparisonMode });

/** The shape the six Financials screens send: an INCLUSIVE-millis window, as the server compares. */
const asRequestWindow = (window) =>
  window ? { startMillis: window.startMillis, endMillis: window.endInclusiveMillis } : null;

/** A single reporting day's boundaries, for a user-picked calendar date. */
const dayWindow = (y, monthIndex, d) =>
  resolve("DAY", Date.UTC(y, monthIndex, d, 12)).current;

/**
 * Resolve a preset (or a custom range) into an explicit window.
 *
 * Returns `null` for "all activity" — the ABSENCE of a period, which is different from a window that
 * happens to be wide. Callers omit both bounds from the request rather than sending an enormous
 * span, so the server sees no period filter at all.
 *
 * Every branch delegates its boundaries. What each preset MEANS is decided here; where a month
 * begins is not.
 */
export function resolvePeriod(presetKey, custom = {}, nowMillis = Date.now()) {
  switch (presetKey) {
    case "all":
      return null;

    // TO-DATE — the window ends at the as-of day. The MTD/QTD/YTD/T12M the ruling names.
    case "monthToDate":
      return asRequestWindow(resolve("MTD", nowMillis).current);
    case "quarterToDate":
      return asRequestWindow(resolve("QTD", nowMillis).current);
    case "yearToDate":
      // Ends TODAY, not on 31 December: a year-to-date window running to the end of the year would
      // be a forecast horizon, not a record of what has happened.
      return asRequestWindow(resolve("YTD", nowMillis).current);
    case "last12Months":
      return asRequestWindow(resolve("T12M", nowMillis).current);

    // FULL PERIOD — the whole month or quarter, including days that have not happened yet.
    // Unchanged in meaning from before this file delegated its arithmetic.
    case "thisMonth":
      return asRequestWindow(resolve("MTD", nowMillis).fullPeriod);
    case "thisQuarter":
      return asRequestWindow(resolve("QTD", nowMillis).fullPeriod);

    // PRIOR full periods, through the authority's own comparison rather than month arithmetic here.
    case "lastMonth":
      return asRequestWindow(resolve("MTD", nowMillis, "PRIOR_FULL").comparison);
    case "lastQuarter":
      return asRequestWindow(resolve("QTD", nowMillis, "PRIOR_FULL").comparison);

    case "custom": {
      const v = validateCustomRange(custom);
      if (!v.valid) return null;
      return { startMillis: v.startMillis, endMillis: v.endMillis };
    }
    default:
      return null;
  }
}

/** Parse a native `<input type="date">` value (YYYY-MM-DD) as a calendar day. */
function parseDayInput(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  // Rejects 2026-02-31 and friends, which Date would silently roll into March. Checked in UTC
  // because this is a calendar-validity question, not a timezone one — the reporting zone is applied
  // afterwards, when the day is turned into instants.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo: mo - 1, d };
}

/**
 * Validate a custom range. An INVALID range is never turned into a request — a from-after-to window
 * would otherwise be sent to the server, come back correctly empty, and read to the user as "no
 * records" when the truth is "that range is backwards".
 */
export function validateCustomRange({ from, to } = {}) {
  const f = parseDayInput(from);
  const t = parseDayInput(to);
  if (!f && !t) return { valid: false, reason: "Choose a start and end date." };
  if (!f) return { valid: false, reason: "Choose a start date." };
  if (!t) return { valid: false, reason: "Choose an end date." };
  // Both edges come from the SAME authority as every preset, so a custom "1–30 September" and the
  // "This month" preset cannot disagree about either boundary.
  const startMillis = dayWindow(f.y, f.mo, f.d).startMillis;
  const endMillis = dayWindow(t.y, t.mo, t.d).endInclusiveMillis;
  if (startMillis > endMillis) return { valid: false, reason: "The start date is after the end date." };
  return { valid: true, startMillis, endMillis };
}

/** The words for the current selection — what the rail says the user is looking at. */
export function periodLabel(presetKey, custom = {}) {
  if (presetKey === "custom") {
    const v = validateCustomRange(custom);
    if (!v.valid) return "Custom range — not set";
    const day = (ms) => new Date(ms).toLocaleDateString();
    return `${day(v.startMillis)} – ${day(v.endMillis)}`;
  }
  return PERIOD_PRESETS.find((p) => p.key === presetKey)?.label ?? "All activity";
}

/**
 * The period fields for a listFinancialFacts request. Always spread into the request object, so a
 * period-less selection sends no bounds rather than nulls the server must interpret.
 */
export function periodRequestFields(presetKey, custom = {}, nowMillis = Date.now()) {
  const window = resolvePeriod(presetKey, custom, nowMillis);
  if (!window) return {};
  return { periodStartMillis: window.startMillis, periodEndMillis: window.endMillis };
}
