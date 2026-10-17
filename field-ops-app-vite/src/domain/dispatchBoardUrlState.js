// The Dispatcher Board's view, date and technician filter, kept in the URL (G-6).
//
// They used to be component state, so leaving the board — to open a Work Order, an Employee, anything —
// and coming Back reset it to today's Day view with every technician shown. In the query string they
// survive Back, refresh and a shared link. Pure: no React, no router; node-testable.
//
//   ?view=day|week|fortnight   absent or unknown -> day   (there is no map view: §7 of
//                                                         docs/architecture/employee-work-schedule-design.md)
//   ?date=YYYY-MM-DD           local date; absent or invalid -> today
//   ?techs=id,id               Employee ids; absent -> EVERY technician (null), never "the ones we knew
//                              about when the link was made" — a new technician is never silently hidden.
//                              Present but empty (`?techs=`) is the deliberate "every lane hidden" choice.
//
// Other params on the URL are left untouched.

import { atWall, startOfDay, wall } from "./boardClock.js";

const VIEW_BY_PARAM = Object.freeze({ day: "DAY", week: "WEEK", fortnight: "FORTNIGHT" });
const PARAM_BY_VIEW = Object.freeze({ DAY: "day", WEEK: "week", FORTNIGHT: "fortnight" });

const pad = (n) => String(n).padStart(2, "0");

// Dates are read and written on the Board's clock (the governed business zone once the Board has set it).
function localMidnight(millis) {
  return startOfDay(millis);
}

function dateParam(millis) {
  const w = wall(millis);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
}

function parseDateParam(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject roll-overs (2026-02-31 -> March 3): a date that is not the one asked for is invalid.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return atWall(y, mo, d);
}

/** { view, anchorMillis, technicianFilter } from URLSearchParams. */
export function readBoardUrlState(searchParams, nowMillis) {
  const view = VIEW_BY_PARAM[searchParams.get("view")] ?? "DAY";
  const anchorMillis = parseDateParam(searchParams.get("date")) ?? localMidnight(nowMillis);
  const ids = (searchParams.get("techs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { view, anchorMillis, technicianFilter: searchParams.has("techs") ? new Set(ids) : null };
}

/** A NEW URLSearchParams: `searchParams` with the board state written over it, defaults omitted. */
export function writeBoardUrlState(searchParams, { view, anchorMillis, technicianFilter }, nowMillis) {
  const next = new URLSearchParams(searchParams);
  const v = PARAM_BY_VIEW[view];
  if (!v || v === "day") next.delete("view"); else next.set("view", v);
  if (!Number.isFinite(anchorMillis) || localMidnight(anchorMillis) === localMidnight(nowMillis)) next.delete("date");
  else next.set("date", dateParam(anchorMillis));
  if (technicianFilter instanceof Set) next.set("techs", [...technicianFilter].sort().join(","));
  else next.delete("techs");
  return next;
}
