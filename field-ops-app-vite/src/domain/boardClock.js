// The Dispatcher Board's wall clock. Every "which day / which hour" question the Board's geometry and views ask goes
// through here, so the grid can be drawn in the operating company's GOVERNED business time zone
// (tenant_operating_companies.business_time_zone, read via readMyCompanyAuthority) instead of the browser's.
//
// With no zone set the answers are the browser's local clock, exactly as before -- so every other screen that shares
// these helpers (the scheduling workspace) and every existing test is unchanged.
//
// ponytail: one module-level zone, set by the mounted Board and cleared on unmount. Two boards in different zones on
// one page would need the zone passed explicitly instead.
import { zonedParts, zonedWallToMillis, browserTimeZone } from "./zonedTime.js";

let zone = null;

/** Set (or clear, with null) the zone the Board draws in. */
export function setBoardTimeZone(timeZone) { zone = timeZone || null; }

/** The zone the Board is drawing in: the governed one when set, else the browser's. */
export function boardTimeZone() { return zone ?? browserTimeZone(); }

/** { y, mo, d, h, mi, dow } as the Board's clock reads `ms` (dow 0=Sun..6=Sat). */
export function wall(ms) {
  if (zone === null) {
    const t = new Date(ms);
    return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes(), dow: t.getDay() };
  }
  const p = zonedParts(ms, zone);
  return { y: p.y, mo: p.mo, d: p.d, h: p.h, mi: p.mi, dow: new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() };
}

/** The instant the Board's clock reads y-mo-d h:mi. Fields may overflow (d + 1, h 24) and are normalized. */
export function atWall(y, mo, d, h = 0, mi = 0) {
  return zone === null ? new Date(y, mo - 1, d, h, mi, 0, 0).getTime() : zonedWallToMillis(y, mo, d, h, mi, zone);
}

/** Midnight of the Board-clock day containing `ms`. */
export function startOfDay(ms) {
  const w = wall(ms);
  return atWall(w.y, w.mo, w.d);
}

/** The same wall time `n` days later (DST-safe: by calendar, not by 24h steps). */
export function addDays(ms, n) {
  const w = wall(ms);
  return atWall(w.y, w.mo, w.d + n, w.h, w.mi);
}

/** toLocaleDateString in the Board's zone. */
export function formatDay(ms, options) {
  return new Date(ms).toLocaleDateString(undefined, { ...options, timeZone: boardTimeZone() });
}

/** toLocaleString in the Board's zone. */
export function formatInstant(ms, options) {
  return new Date(ms).toLocaleString(undefined, { ...options, timeZone: boardTimeZone() });
}
