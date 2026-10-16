// Wall-clock <-> instant conversion in a NAMED IANA time zone (the operating company's governed business time zone),
// for a `datetime-local` field. The field has no zone of its own, so reading it as the BROWSER's zone would put a
// dispatcher outside Arizona hours away from the governed schedule. Intl only; no dependency.

const pad = (n) => String(n).padStart(2, "0");

function parts(ms, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** The zone's offset from UTC at `ms`, in milliseconds (positive east of Greenwich). */
function offsetAt(ms, timeZone) {
  const p = parts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** epoch millis -> "YYYY-MM-DDTHH:mm" as the wall clock reads in `timeZone`. "" for null. */
export function toZonedInput(ms, timeZone) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const p = parts(ms, timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** "YYYY-MM-DDTHH:mm" read as the wall clock in `timeZone` -> epoch millis; null when malformed. */
export function fromZonedInput(value, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes settle the offset across a DST edge (Arizona has none; other companies may).
  let guess = asUtc - offsetAt(asUtc, timeZone);
  guess = asUtc - offsetAt(guess, timeZone);
  return Number.isFinite(guess) ? guess : null;
}

/** "Oct 17, 9:30 AM" in `timeZone`, for sentences. */
export function formatZoned(ms, timeZone) {
  if (ms == null || !Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** The browser's own zone: the honest fallback when no governed zone is known yet. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
