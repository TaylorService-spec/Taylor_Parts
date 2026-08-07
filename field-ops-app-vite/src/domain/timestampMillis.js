/**
 * One coercion for "when did this happen", because there is more than one
 * shape in play and mixing them produced a 54-year-old work order.
 *
 * WHY THIS EXISTS. F0 moved the operational surfaces from the legacy
 * `fieldops_jobs` model to the governed `fieldops_wos` Work Order Engine. The
 * legacy model stored `createdAt` as epoch MILLISECONDS (a number); the
 * governed model stores a Firestore **Timestamp object**. The consumers were
 * doing `now - job.createdAt` arithmetic and were never updated, so every
 * age-derived value silently broke at once:
 *
 *   "478391h since creation"   (~54 years -> the epoch, not the job)
 *   "19932d ago"
 *   "Invalid Date"
 *   NaN reconciliation variance
 *   an At Risk panel reporting 100% of jobs CRITICAL
 *
 * A risk panel that flags everything flags nothing, so this was not cosmetic:
 * it made the operational-risk surface actively misleading. Persona review
 * caught it; no automated test did, because none asserted on a real governed
 * timestamp.
 *
 * Returns null when the input cannot be trusted — callers must render "unknown"
 * rather than compute an age from a fabricated zero. Failing closed here is the
 * whole point: a missing timestamp must never become "54 years old".
 */
export function toMillis(value) {
  if (value == null) return null;

  // Already epoch millis (legacy documents, and anything already coerced).
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;

  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }

  // Firestore Timestamp (client SDK) — has toDate()/toMillis().
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") {
      const t = value.toMillis();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value.toDate === "function") {
      const t = value.toDate()?.getTime();
      return Number.isFinite(t) ? t : null;
    }
    // Plain-object form, e.g. after JSON serialization across a callable.
    if (typeof value.seconds === "number") {
      const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
      return value.seconds * 1000 + Math.floor(nanos / 1e6);
    }
    if (typeof value._seconds === "number") {
      const nanos = typeof value._nanoseconds === "number" ? value._nanoseconds : 0;
      return value._seconds * 1000 + Math.floor(nanos / 1e6);
    }
    return null;
  }

  // ISO-8601 or any other parseable string.
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

/**
 * Age in hours, or null when the timestamp is unusable.
 *
 * Deliberately NOT defaulting to 0 or to `now`: both produce a confident lie.
 * Callers branch on null and say "unknown".
 */
export function ageHours(value, now = Date.now()) {
  const ms = toMillis(value);
  if (ms === null) return null;
  const hours = (now - ms) / 3_600_000;
  return hours >= 0 ? hours : 0;
}
