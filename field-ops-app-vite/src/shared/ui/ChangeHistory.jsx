import { useMemo, useState } from "react";
import RuledSection from "./RuledSection.jsx";
import EmptyState from "./EmptyState.jsx";
import FailureState from "./FailureState.jsx";
import LoadingState from "./LoadingState.jsx";
import { formatTimestamp } from "../../domain/displayTimestamp";
import {
  ALL_FIELDS,
  DEFAULT_SORT,
  HISTORY_SORT_KEY,
  ariaSortFor,
  historyActorOptions,
  historyFieldOptions,
  nextSort,
  presentHistory,
} from "../../domain/changeHistory.js";

// THE SHARED RECORD-HISTORY SECTION.
//
// ════════════════════ RECORD-AGNOSTIC ON PURPOSE ════════════════════
//
// Nothing in this file knows what an Employee is. It takes normalized rows (domain/changeHistory
// .js) and renders them; Customers, Equipment, Parts, Work Orders, Purchase Orders and the
// Financials records mount the same component with their own rows and their own field labels.
//
// That is why the Field filter's options are DERIVED from the rows rather than declared here. A
// global list of employee field names baked into a shared component offers Equipment a filter for
// "Employment Status" that can only ever return nothing, and silently omits any field the list was
// not updated for. The options are exactly what the history contains, always.
//
// ════════════════════ WHAT IT WILL NOT DO ════════════════════
//
// It renders stored, audited events and only those. There is no prop through which a caller could
// hand it a client-computed diff, because a history assembled from React state reports changes
// nobody made and loses changes somebody else made.
//
// ════════════════════ SORTING IS A BUTTON, NOT A CLICKABLE HEADER ════════════════════
//
// Each sortable column header contains a real <button>, so it is reachable and operable from a
// keyboard without a single handler of this component's own, and the <th> carries `aria-sort` so
// the current order is announced rather than only drawn. The arrow is decorative -- the state is
// in aria-sort and in the button's own accessible name.

const COLUMNS = [
  { key: HISTORY_SORT_KEY.OCCURRED_AT, label: "Date / Time" },
  { key: HISTORY_SORT_KEY.FIELD, label: "Field / Event" },
  { key: HISTORY_SORT_KEY.PREVIOUS, label: "Previous" },
  { key: HISTORY_SORT_KEY.NEW, label: "New" },
  { key: HISTORY_SORT_KEY.CHANGED_BY, label: "Changed By" },
];

// An absent value is stated, not left blank. A blank "Previous" cell is indistinguishable from a
// cell that failed to render, and the two mean very different things about the record.
const ABSENT = "—";

/**
 * @param rows        normalized rows (normalizeHistoryRows). Ignored while loading/unavailable.
 * @param loading     the read is in flight.
 * @param unavailable an honest message when the trusted history read could not be performed.
 *                    NOT the same as an empty history, and rendered as a failure rather than as
 *                    "nothing has happened to this record".
 * @param title       section heading. Defaults to the pattern's own name.
 */
export default function ChangeHistory({
  rows = [],
  loading = false,
  unavailable = null,
  onRetry = null,
  title = "Change History",
  emptyMessage = "No recorded changes for this record yet.",
}) {
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [field, setField] = useState(ALL_FIELDS);
  const [actor, setActor] = useState(ALL_FIELDS);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fieldOptions = useMemo(() => historyFieldOptions(rows), [rows]);
  const actorOptions = useMemo(() => historyActorOptions(rows), [rows]);
  const shown = useMemo(
    () => presentHistory(rows, { filters: { field, actor, from: from || null, to: to || null }, sort }),
    [rows, field, actor, from, to, sort],
  );

  // A filter whose selected value is no longer present in the rows (the record reloaded, the
  // filtered field's last event was on another page) would silently show nothing with no
  // explanation. Falling back to "all" here keeps the control honest about what it is showing.
  const activeField = fieldOptions.some((o) => o.value === field) ? field : ALL_FIELDS;
  const activeActor = actorOptions.some((o) => o.value === actor) ? actor : ALL_FIELDS;

  // A FILTER BAR OVER AN EMPTY HISTORY IS FOUR CONTROLS THAT CANNOT DO ANYTHING.
  //
  // The options are derived from the rows, and that is right (see the header comment) -- but it
  // means a record with no recorded history renders "All changes" and "Anyone" over two selects
  // holding nothing else, plus a From/To pair with no range to narrow. Every one of them is
  // operable and none of them can change what is shown, which is how a working screen comes to
  // look broken.
  //
  // THE ANSWER IS NOT TO FILL THEM. Populating Field from the employee schema would offer a
  // filter for every field the profile HAS rather than every field that CHANGED, and selecting
  // one would return nothing while implying the history was searched. What is missing here is
  // history, not options.
  //
  // So the bar appears when there is something to filter, and the empty state stands alone.
  // A filtered read that matches nothing is a DIFFERENT case -- the rows exist, the controls
  // stay, and "No matches" tells the reader their filters are why (below).
  const hasHistory = rows.length > 0;
  const filtered =
    hasHistory && (activeField !== ALL_FIELDS || activeActor !== ALL_FIELDS || from !== "" || to !== "");

  return (
    <RuledSection title={title} id="change-history">
      {loading ? (
        <LoadingState>Loading change history…</LoadingState>
      ) : unavailable ? (
        // A read we could not perform is NOT an empty history. Saying "no changes" here would
        // assert something about the record that we have no basis for.
        <FailureState
          title="Change history unavailable"
          message={unavailable}
          action={
            onRetry ? (
              <button type="button" onClick={onRetry}>
                Try again
              </button>
            ) : null
          }
        />
      ) : (
        <>
          {hasHistory ? (
            <div className="fo-history__filters">
              <label className="fo-history__filter">
                <span>Field</span>
                <select
                  value={activeField}
                  onChange={(e) => setField(e.target.value)}
                  data-history-filter="field"
                >
                  <option value={ALL_FIELDS}>All changes</option>
                  {fieldOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fo-history__filter">
                <span>Changed by</span>
                <select
                  value={activeActor}
                  onChange={(e) => setActor(e.target.value)}
                  data-history-filter="actor"
                >
                  <option value={ALL_FIELDS}>Anyone</option>
                  {actorOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fo-history__filter">
                <span>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-history-filter="from" />
              </label>
              <label className="fo-history__filter">
                <span>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-history-filter="to" />
              </label>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState
              variant={filtered ? "filtered" : "database"}
              title={filtered ? "No matches" : "No changes recorded"}
              message={filtered ? "No recorded changes match these filters." : emptyMessage}
            />
          ) : (
            <div className="fo-table-scroll">
              {/* --stack is the established handheld recomposition: the header row is hidden and
                  each cell renders its own label from data-label, so a five-column audit table
                  stays readable at 320px instead of scrolling sideways. */}
              <table className="fo-table fo-table--stack fo-history__table" data-testid="change-history-table">
                <caption className="fo-visually-hidden">
                  {title} — {shown.length} {shown.length === 1 ? "entry" : "entries"}
                </caption>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th key={col.key} scope="col" aria-sort={ariaSortFor(sort, col.key)}>
                        <button
                          type="button"
                          className="fo-sort-btn"
                          data-sort-key={col.key}
                          onClick={() => setSort((cur) => nextSort(cur, col.key))}
                        >
                          {col.label}
                          {/* Decorative: the order is carried by aria-sort on the th, so this
                              never has to be read out twice. */}
                          <span aria-hidden="true" className="fo-sort-btn__glyph">
                            {sort.key === col.key ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id} data-history-row={row.id}>
                      <td data-label="Date / Time">
                        {row.occurredAt === null ? ABSENT : formatTimestamp(row.occurredAt)}
                      </td>
                      <td data-label="Field / Event" data-history-field={row.fieldKey ?? row.eventType}>
                        {row.fieldLabel || ABSENT}
                        {/* A refused attempt is part of the record's history and is marked as
                            refused. Dropping it would make the trail read as though nobody
                            ever tried. */}
                        {row.outcome && row.outcome !== "applied" ? (
                          <span className="fo-history__outcome"> ({row.outcome})</span>
                        ) : null}
                      </td>
                      <td data-label="Previous">{row.previousValue ?? ABSENT}</td>
                      <td data-label="New">{row.newValue ?? ABSENT}</td>
                      <td data-label="Changed By">{row.changedByLabel ?? "Unknown user"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </RuledSection>
  );
}
