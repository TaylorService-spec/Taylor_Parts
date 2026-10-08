// SHARED TABLE SORTING (UI corrections package, 2026-10-08, item C / H).
//
// One tri-state cycle for every sortable column: click 1 ascending, click 2 descending, click 3 back to the table's
// DEFAULT order. useTableSort owns only that state; ordering rows is either done here (sortRows, for a table whose whole
// authorized dataset is already on the client) or by the server (pass the state to the read, for a bounded/paginated
// read where the client does not hold the complete set).
import { useCallback, useMemo, useState } from "react";

export const SORT_DIRECTION = Object.freeze({ ASC: "asc", DESC: "desc" });

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** The next state of the cycle for `key`: none -> asc -> desc -> none (default). */
export function nextSort(current, key) {
  if (!current || current.key !== key) return { key, direction: SORT_DIRECTION.ASC };
  if (current.direction === SORT_DIRECTION.ASC) return { key, direction: SORT_DIRECTION.DESC };
  return null;
}

/** aria-sort for a column header. */
export function ariaSortOf(sort, key) {
  if (!sort || sort.key !== key) return "none";
  return sort.direction === SORT_DIRECTION.ASC ? "ascending" : "descending";
}

/** Compares two display values: empty last in both directions, numbers and dates naturally, text case-insensitively. */
export function compareValues(a, b) {
  const empty = (v) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return collator.compare(String(a), String(b));
}

/**
 * Sorts a COPY of rows by `sort` using `columns[key].value(row)`; with no sort the rows keep the order given (the
 * table's default). Ties keep their default order (stable sort), so the default is the tie-breaker.
 */
export function sortRows(rows, sort, columns) {
  if (!sort || !columns?.[sort.key]) return rows;
  const valueOf = columns[sort.key].value ?? ((row) => row?.[sort.key]);
  const sign = sort.direction === SORT_DIRECTION.DESC ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, v: valueOf(row) }))
    .sort((x, y) => {
      const xe = x.v === null || x.v === undefined || x.v === "";
      const ye = y.v === null || y.v === undefined || y.v === "";
      if (xe !== ye) return xe ? 1 : -1; // empty stays last in both directions
      return sign * compareValues(x.v, y.v) || x.index - y.index;
    })
    .map((x) => x.row);
}

/**
 * Sort state for one table. `rows` + `columns` sort on the client; omit them and use `sort` to drive a server read.
 * Returns { sort, toggle(key), reset(), sorted }.
 */
export function useTableSort({ rows = null, columns = null, initial = null } = {}) {
  const [sort, setSort] = useState(initial);
  const toggle = useCallback((key) => setSort((current) => nextSort(current, key)), []);
  const reset = useCallback(() => setSort(null), []);
  const sorted = useMemo(() => (rows ? sortRows(rows, sort, columns) : rows), [rows, sort, columns]);
  return { sort, toggle, reset, sorted };
}
