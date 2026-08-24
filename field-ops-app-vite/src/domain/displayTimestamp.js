// Four persona missions in a row reported the same two strings on live screens:
//
//   "Invalid Date"     -- new Date(x).toLocaleString() where x was not a usable time
//   "19933d ago"       -- an age of roughly 54 years, on a request made this week
//
// A dispatcher's reaction was the point: seeing the literal text "Invalid Date"
// "makes me distrust every other timestamp in the app". A nonsense age does the
// same damage more quietly, because it looks like a number someone computed.
//
// An unusable timestamp is UNKNOWN. It is not the epoch, it is not now, and it is
// not a 54-year-old request. domain/timestampMillis.js already refuses zero and
// non-finite values for exactly this reason (it was written after the F0
// regression made a risk panel flag every job CRITICAL); this module is the
// display half of the same rule.

import { toMillis } from "./timestampMillis.js";

/** Absolute timestamp for display. Never renders "Invalid Date". */
export function formatTimestamp(value, { unknown = "Unknown" } = {}) {
  const ms = toMillis(value);
  if (ms === null) return unknown;
  const text = new Date(ms).toLocaleString();
  // Belt and braces: if the platform still produced an unusable string, say so
  // rather than printing it.
  return text === "Invalid Date" ? unknown : text;
}

/**
 * Time-of-day for display (e.g. "02:15 PM). The Operational History timeline
 * shows a clock time only, so it needs the same "never render Invalid Date"
 * rule as formatTimestamp — the governed Work Order's `createdAt` is a Firestore
 * Timestamp, and `new Date(<Timestamp>)` produced the literal "Invalid Date" on
 * every row until this coercion was applied.
 */
/**
 * A DATE for a list column (e.g. "Aug 12, 2025"), with no time of day.
 *
 * `formatTimestamp` gives a full locale string — "8/12/2025, 5:00:00 AM" — which is right on a
 * detail page and wrong in a list. The seconds carry no information anybody reads, and on a phone
 * card they take a whole line to say nothing. A list answers "when, roughly"; a record answers
 * "exactly when".
 *
 * Same "never render Invalid Date" rule as its siblings.
 */
export function formatDateOnly(value, { unknown = "Unknown" } = {}) {
  const ms = toMillis(value);
  if (ms === null) return unknown;
  const text = new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return text === "Invalid Date" ? unknown : text;
}

export function formatClockTime(value, { unknown = "Unknown" } = {}) {
  const ms = toMillis(value);
  if (ms === null) return unknown;
  const text = new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return text === "Invalid Date" ? unknown : text;
}

// Beyond this, an age is far more likely to be a broken value than a real
// request that has genuinely been waiting since before the business existed.
// Capping the phrasing keeps the row honest without silently hiding it.
const IMPLAUSIBLE_AGE_DAYS = 400;

/**
 * Relative age for display. Returns a coarse phrase rather than a precise
 * number once the value stops being plausible, and never a negative age.
 */
export function formatAge(value, nowMs = Date.now(), { unknown = "Unknown" } = {}) {
  const ms = toMillis(value);
  if (ms === null) return unknown;

  const diffMs = nowMs - ms;
  // A future timestamp is not an age. Treat it as unusable rather than
  // rendering "0m ago" and implying it just happened.
  if (diffMs < 0) return unknown;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days > IMPLAUSIBLE_AGE_DAYS) return "Over a year ago";
  return `${days}d ago`;
}
