// Board → Employee record → Work Schedule, and back again (Owner, "WORK HOURS AND PTO ENTRY", 2026-10-17).
//
// The Dispatcher Board offers a "Work schedule" link that opens the governed Employee record on its Work Schedule tab,
// carrying the board's exact address (date, view, technician filter, the open technician review) in `back`. The record
// offers "Back to the board" only when `back` is a board address -- never an arbitrary URL, so the parameter cannot be
// used to send someone off-site or to another page. Pure; node-testable.
//
// Visibility of the LINK is decided by the board (Administration reachable AND flat employee.record.read); visibility
// of the RECORD is decided by its own governed reads. This module only builds and validates addresses.

/** The Dispatcher Board's router path (navConfig: service domain, "dispatcher-board" item). */
export const BOARD_PATH = "/service/dispatcher-board";

/** `/administration/users/<employeeId>?tab=schedule&back=<board address>`. */
export function employeeScheduleHref(employeeId, boardAddress) {
  const params = new URLSearchParams({ tab: "schedule" });
  const back = safeBoardReturn(boardAddress);
  if (back) params.set("back", back);
  return `/administration/users/${encodeURIComponent(employeeId)}?${params.toString()}`;
}

/** `value` when it is a board address on this app (path, optionally with a query); otherwise null. */
export function safeBoardReturn(value) {
  if (typeof value !== "string" || value.length > 4000) return null;
  // Exactly the board path, then nothing or a query string. No other path, no scheme, host, fragment, backslash or
  // control character.
  // eslint-disable-next-line no-control-regex
  return /^\/service\/dispatcher-board(\?[^#\\\u0000-\u001f\u007f]*)?$/.test(value) ? value : null;
}
