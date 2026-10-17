// Employee Work Schedule — pure helpers for the Employee record's Work Schedule tab (Scheduling PR-2).
//
// Renders the governed schedule the server returns (readEmployeeWorkSchedule) and turns the edit form into the exact
// setTechnicianWorkingHours payload. Nothing here decides a rule: the validation MIRRORS the server's refusals
// (workOrderAvailability.ts parseWeeklyHours) so a form can say what is wrong before a round trip, and the command still
// decides. No React, no I/O; node-testable.
//
// NO DEFAULT HOURS. An empty form is an error, never "07:00–16:00": a schedule is a recorded fact, and inventing one is
// the exact thing the board's "No schedule" state exists to refuse.

/** Display order: Monday first. Keys are the server's weekday strings ("0" = Sunday … "6" = Saturday). */
export const WEEKDAYS = Object.freeze([
  ["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"],
].map(([key, label]) => Object.freeze({ key, label })));

/** Mirrors MAX_INTERVALS_PER_WEEKDAY on the server. */
export const MAX_INTERVALS_PER_DAY = 6;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const minutes = (hhmm) => (hhmm === "24:00" ? 1440 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));

/** "07:00" -> "7:00a"; "24:00" -> "12:00a" (midnight). */
export function clockLabel(hhmm) {
  const m = minutes(hhmm) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}

/** One weekday's intervals as words, with the gaps between them named as breaks. */
export function describeDay(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return "Off";
  const sorted = [...intervals].sort((a, b) => minutes(a.start) - minutes(b.start));
  const parts = [];
  sorted.forEach((iv, idx) => {
    if (idx > 0) parts.push(`${minutes(iv.start) - minutes(sorted[idx - 1].end)} min break`);
    parts.push(`${clockLabel(iv.start)}–${clockLabel(iv.end)}`);
  });
  return parts.join(" · ");
}

/** The edit form's model from a governed weeklyHours (or an empty form when there is none — no default). */
export function formFromWeeklyHours(weeklyHours) {
  return Object.fromEntries(WEEKDAYS.map(({ key }) => [key,
    (weeklyHours?.[key] ?? []).map((iv) => ({ start: iv.start, end: iv.end }))]));
}

/** Copy one day's intervals onto other days (the "same as Monday" helper). Returns a new form. */
export function copyDay(form, fromKey, toKeys) {
  const next = { ...form };
  for (const k of toKeys) next[k] = (form[fromKey] ?? []).map((iv) => ({ ...iv }));
  return next;
}

/**
 * The setTechnicianWorkingHours `weeklyHours` from the form, or the reasons it would be refused.
 * Returns { ok: true, weeklyHours } | { ok: false, errors: [{ day, message }] }.
 */
export function weeklyHoursFromForm(form) {
  const errors = [];
  const weeklyHours = {};
  for (const { key, label } of WEEKDAYS) {
    const rows = (form?.[key] ?? []).filter((iv) => iv.start || iv.end);
    if (rows.length === 0) continue;
    if (rows.length > MAX_INTERVALS_PER_DAY) errors.push({ day: key, message: `${label}: at most ${MAX_INTERVALS_PER_DAY} intervals` });
    const parsed = [];
    for (const iv of rows) {
      if (!TIME.test(iv.start ?? "") || !TIME.test(iv.end ?? "") || iv.start === "24:00") {
        errors.push({ day: key, message: `${label}: times are HH:MM (end may be 24:00)` });
        continue;
      }
      if (minutes(iv.end) <= minutes(iv.start)) {
        errors.push({ day: key, message: `${label}: ${iv.start}–${iv.end} ends before it starts` });
        continue;
      }
      parsed.push({ start: iv.start, end: iv.end });
    }
    parsed.sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let i = 1; i < parsed.length; i += 1) {
      if (minutes(parsed[i].start) < minutes(parsed[i - 1].end)) errors.push({ day: key, message: `${label}: intervals overlap` });
    }
    if (parsed.length) weeklyHours[key] = parsed;
  }
  if (errors.length === 0 && Object.keys(weeklyHours).length === 0) {
    errors.push({ day: null, message: "A schedule needs at least one working interval. Hours are never assumed." });
  }
  return errors.length ? { ok: false, errors } : { ok: true, weeklyHours };
}

/** An IANA zone the browser can resolve (the server re-validates). */
export function isTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

/** The schedule(s) governing today, company-specific first (the server's own precedence). */
export function currentSchedules(schedules) {
  return (schedules ?? [])
    .filter((s) => s.status === "CURRENT")
    .sort((a, b) => (a.operatingCompanyId === null ? 1 : 0) - (b.operatingCompanyId === null ? 1 : 0));
}
