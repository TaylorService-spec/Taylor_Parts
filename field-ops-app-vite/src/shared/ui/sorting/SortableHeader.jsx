// A sortable column header (UI corrections package, item C). A real <button> inside the <th>, so it is reachable by Tab
// and activated by Enter / Space; the <th> carries aria-sort; the indicator is visible and also stated for screen readers.
import { ariaSortOf } from "./useTableSort.js";

const INDICATOR = Object.freeze({ ascending: "▲", descending: "▼", none: "↕" });
const SPOKEN = Object.freeze({ ascending: "sorted ascending", descending: "sorted descending", none: "not sorted" });

export default function SortableHeader({ columnKey, label, sort, onSort, className = "", ...rest }) {
  const state = ariaSortOf(sort, columnKey);
  return (
    <th scope="col" aria-sort={state} className={`fo-sortable-th ${className}`.trim()} data-sort-key={columnKey} data-sort-state={state} {...rest}>
      <button type="button" className="fo-sortable-th__button" onClick={() => onSort(columnKey)}
        title={state === "none" ? `Sort by ${label}` : state === "ascending" ? `Sort by ${label}, descending` : "Restore the default order"}>
        <span>{label}</span>
        <span className={`fo-sortable-th__indicator fo-sortable-th__indicator--${state}`} aria-hidden="true">{INDICATOR[state]}</span>
        <span className="fo-sr-only">{`, ${SPOKEN[state]}`}</span>
      </button>
    </th>
  );
}
