import { EQUIPMENT_STATUS } from "../../domain/constants.js";

// Issue #232 unit E5 -- the register's status filter table.
//
// This lives in its own PURE module (no JSX) for one reason: so a plain-node unit test
// can import THIS table and assert the real values the screen uses. Inline in the
// component it was unreachable from the suite, and an independent review proved the
// consequence -- mutating `value: null` to `value: ""`, the exact bug the test claimed
// to guard, left all 10 assertions green. The test was asserting searchEquipment's
// behaviour and merely describing the register's.
//
// `value: null` on "All statuses" is load-bearing, not stylistic. searchEquipment
// treats an explicitly supplied UNKNOWN status -- and "" is one -- as a real filter
// that matches nothing, so the conventional <option value="">All</option> sentinel
// would render an EMPTY register for the default selection. `null` (or omitting the
// key) is the only spelling that means "no status filter".
//
// Note `?? null` at the call site does NOT protect against this: ?? only coalesces
// null/undefined, so an empty string would pass straight through.
export const STATUS_FILTERS = Object.freeze([
  { key: "all", label: "All statuses", value: null },
  { key: "active", label: "Active", value: EQUIPMENT_STATUS.ACTIVE },
  { key: "inactive", label: "Inactive", value: EQUIPMENT_STATUS.INACTIVE },
  { key: "retired", label: "Retired", value: EQUIPMENT_STATUS.RETIRED },
]);

export function statusFilterValue(key) {
  const found = STATUS_FILTERS.find((s) => s.key === key);
  // An unrecognized key means the caller is asking for a filter this table does not
  // define. Fall back to "no filter" (null) rather than to undefined -- both mean the
  // same to searchEquipment, but null is the documented spelling.
  return found ? found.value : null;
}
