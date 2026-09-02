// FINANCIALS PERIOD — the ONE place calendar boundaries are computed for this family.
//
// Every Financials surface that filters by time resolves its window here, so "this quarter" cannot
// come to mean two different spans on two pages. A page-local copy of month arithmetic is exactly
// how that drift starts.
//
// ════════ TIMEZONE ════════
//
// LOCAL calendar boundaries, deliberately — no new Financials-specific rule. The family already
// renders every date with `new Date(ms).toLocaleDateString()`, so a user who sees an invoice dated
// the 1st must have it fall inside "this month". Computing UTC boundaries under a local-rendering
// surface would put a record on one side of the line and its own printed date on the other.
//
// ════════ INCLUSIVE, AND WHY THE END IS THE LAST MILLISECOND ════════
//
// A user picking 1 Mar → 31 Mar means all of 31 March. `endMillis` is therefore 23:59:59.999 on
// the end day, not midnight at its start — an end-exclusive boundary would silently drop a full
// day's records, and would do it most often on the day the user cared enough to name.
//
// PURE: no clock of its own (callers pass `nowMillis`), no Firestore, no formatting.

export const PERIOD_PRESETS = Object.freeze([
  Object.freeze({ key: "all", label: "All activity" }),
  Object.freeze({ key: "thisMonth", label: "This month" }),
  Object.freeze({ key: "lastMonth", label: "Last month" }),
  Object.freeze({ key: "thisQuarter", label: "This quarter" }),
  Object.freeze({ key: "lastQuarter", label: "Last quarter" }),
  Object.freeze({ key: "yearToDate", label: "Year to date" }),
  Object.freeze({ key: "last12Months", label: "Last 12 months" }),
  Object.freeze({ key: "custom", label: "Custom range" }),
]);

export const DEFAULT_PERIOD_KEY = "all";

const startOfDay = (y, m, d) => new Date(y, m, d, 0, 0, 0, 0).getTime();
/** The LAST millisecond of the given day — see the header on inclusivity. */
const endOfDay = (y, m, d) => new Date(y, m, d, 23, 59, 59, 999).getTime();
const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/**
 * Resolve a preset (or a custom range) into an explicit window.
 *
 * Returns `null` for "all activity" — the ABSENCE of a period, which is different from a window
 * that happens to be wide. Callers omit both bounds from the request rather than sending an
 * enormous span, so the server sees no period filter at all.
 */
export function resolvePeriod(presetKey, custom = {}, nowMillis = Date.now()) {
  const now = new Date(nowMillis);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (presetKey) {
    case "all":
      return null;
    case "thisMonth":
      return { startMillis: startOfDay(y, m, 1), endMillis: endOfDay(y, m, lastDayOfMonth(y, m)) };
    case "lastMonth": {
      // Month arithmetic via the Date constructor, which normalizes December → January itself.
      const s = new Date(y, m - 1, 1);
      const ly = s.getFullYear();
      const lm = s.getMonth();
      return { startMillis: startOfDay(ly, lm, 1), endMillis: endOfDay(ly, lm, lastDayOfMonth(ly, lm)) };
    }
    case "thisQuarter": {
      const q = Math.floor(m / 3) * 3;
      return { startMillis: startOfDay(y, q, 1), endMillis: endOfDay(y, q + 2, lastDayOfMonth(y, q + 2)) };
    }
    case "lastQuarter": {
      const q = Math.floor(m / 3) * 3 - 3;
      const s = new Date(y, q, 1);
      const qy = s.getFullYear();
      const qm = s.getMonth();
      return { startMillis: startOfDay(qy, qm, 1), endMillis: endOfDay(qy, qm + 2, lastDayOfMonth(qy, qm + 2)) };
    }
    case "yearToDate":
      // Ends TODAY, not on 31 December: a year-to-date window that ran to the end of the year
      // would be a forecast horizon, not a record of what has happened.
      return { startMillis: startOfDay(y, 0, 1), endMillis: endOfDay(y, m, d) };
    case "last12Months": {
      const s = new Date(y, m - 11, 1);
      return { startMillis: startOfDay(s.getFullYear(), s.getMonth(), 1), endMillis: endOfDay(y, m, d) };
    }
    case "custom": {
      const v = validateCustomRange(custom);
      if (!v.valid) return null;
      return { startMillis: v.startMillis, endMillis: v.endMillis };
    }
    default:
      return null;
  }
}

/** Parse a native `<input type="date">` value (YYYY-MM-DD) as a LOCAL calendar day. */
function parseDayInput(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  // Rejects 2026-02-31 and friends, which Date would silently roll into March.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return { y, mo: mo - 1, d };
}

/**
 * Validate a custom range. An INVALID range is never turned into a request — a from-after-to
 * window would otherwise be sent to the server, come back correctly empty, and read to the user as
 * "no records" when the truth is "that range is backwards".
 */
export function validateCustomRange({ from, to } = {}) {
  const f = parseDayInput(from);
  const t = parseDayInput(to);
  if (!f && !t) return { valid: false, reason: "Choose a start and end date." };
  if (!f) return { valid: false, reason: "Choose a start date." };
  if (!t) return { valid: false, reason: "Choose an end date." };
  const startMillis = startOfDay(f.y, f.mo, f.d);
  const endMillis = endOfDay(t.y, t.mo, t.d);
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
