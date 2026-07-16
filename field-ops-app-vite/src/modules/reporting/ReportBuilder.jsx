// Issue #325 / ADR-007 -- the object-first report BUILDER (F3 shell, activated in W1).
//
// Pick an object -> pick authorized fields -> add filters / group / sort -> Run. It reads the
// F1 catalog and validates live with the F2 validator (all via reportBuilderModel.js). A Run goes
// through the execution seam (reportExecutionSeam.js), which invokes the trusted Function (D-FN);
// the client never reads data itself. When the Function isn't deployed the seam resolves to the
// honest "unavailable" state (unavailable-safe). The result area renders the full Spec §12 state
// matrix via describeRunOutcome, plus the projected rows/aggregates tables for a real result --
// a field the runner may not read is simply ABSENT from the row objects (the Function projects it
// out) and is surfaced as a dropped column, never blanked.
//
// Reachable only through the capability-gated /reporting/builder route (navConfig.js +
// App.jsx) -- today the Owner Role alone holds the wave-1 report capabilities. Keyboard-first
// (native <select>/<input>/<button>, associated <label>s) and responsive (shared fo- tokens).
import { useState } from "react";
import {
  availableObjects, availableFieldGroups, defaultComparator,
  setObject, toggleField, toggleGroupBy, addFilter, updateFilter, removeFilter,
  addSort, updateSort, removeSort, builderErrors, builderStatus,
  hasCountRows, toggleCountRows,
} from "../../domain/reporting/reportBuilderModel.js";
import { createReportDefinition, FILTER_COMPARATORS_BY_TYPE, SORT_DIRECTIONS } from "../../domain/reporting/reportQueryModel.js";
import { rowColumns, aggregateColumns, formatCell } from "../../domain/reporting/reportResultTable.js";
import { runReport } from "../../domain/reporting/reportExecutionSeam.js";
import { describeRunOutcome } from "../../domain/reporting/reportResultState.js";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

const OBJECTS = availableObjects();

// `runReportFn` defaults to the real D-FN seam; it exists only so a browser/dev harness can inject
// a fixture outcome (the trusted engine has no client-side test double). Production never passes it.
export default function ReportBuilder({ runReportFn = runReport }) {
  const [def, setDef] = useState(() => createReportDefinition(null));
  const [outcome, setOutcome] = useState({ kind: "idle" });
  const [running, setRunning] = useState(false);

  const groups = def.objectId ? availableFieldGroups(def.objectId) : [];
  const selectableFields = groups.flatMap((g) => g.fields);
  const fieldById = Object.fromEntries(selectableFields.map((f) => [f.fieldId, f]));
  const selected = def.fields.map((id) => fieldById[id]).filter(Boolean);
  const errors = builderErrors(def);
  const status = builderStatus(def);

  const onPickObject = (e) => {
    setDef(e.target.value ? setObject(def, e.target.value) : createReportDefinition(null));
    setOutcome({ kind: "idle" });
  };

  const onRun = async () => {
    setRunning(true);
    setOutcome({ kind: "loading" });
    const result = await runReportFn(def);
    setOutcome(result);
    setRunning(false);
  };

  return (
    <div className="fo-main">
      <div className="fo-panel">
        <h2>Report builder</h2>
        <p className="fo-muted">
          Build a report from a governed business object. Only the data you're authorized to see is
          returned — fields you can't read are left out and shown as omitted.
        </p>

        {/* 1. object */}
        <div className="fo-form">
          <label htmlFor="rb-object">Object</label>
          <select id="rb-object" value={def.objectId ?? ""} onChange={onPickObject}>
            <option value="">Choose an object…</option>
            {OBJECTS.map((o) => (
              <option key={o.objectId} value={o.objectId} disabled={o.comingSoon}>
                {o.label}{o.comingSoon ? " (coming soon)" : ""}
              </option>
            ))}
          </select>
        </div>

        {!def.objectId ? (
          <EmptyState
            title="Start by choosing an object"
            message="Pick a business object above to see the fields you can report on."
          />
        ) : (
          <>
            {/* 2. fields */}
            <FieldGroups groups={groups} selected={def.fields} onToggle={(id) => setDef(toggleField(def, id))} />

            {/* 3. filters / group / sort -- only for selected fields, driven by their operators */}
            {selected.length > 0 && (
              <>
                <Filters def={def} selected={selected} setDef={setDef} />
                <GroupBy def={def} selected={selected} setDef={setDef} />
                <SortBy def={def} selected={selected} setDef={setDef} />
              </>
            )}

            {/* 3b. summary -- the fieldless countRows aggregate (Spec §7). Available regardless of
                selected fields; when grouping, it counts per group. */}
            <section aria-labelledby="rb-summary-h">
              <h3 id="rb-summary-h">Summary</h3>
              <label className="fo-checkbox-label">
                <input type="checkbox" checked={hasCountRows(def)} onChange={() => setDef(toggleCountRows(def))} />
                Count rows{def.groupBy.length > 0 ? " (per group)" : " (total)"}
              </label>
            </section>

            {/* 4. validation + run */}
            {errors.length > 0 && (
              <div className="fo-state" role="status">
                <p className="fo-state-title">Finish these to run:</p>
                <ul>{errors.map((msg, i) => <li key={i} className="fo-muted">{msg}</li>)}</ul>
              </div>
            )}

            <button
              type="button"
              className="fo-btn-large"
              onClick={onRun}
              disabled={status !== "ready" || running}
              aria-disabled={status !== "ready" || running}
            >
              {running ? "Running…" : "Run report"}
            </button>

            <ResultArea outcome={outcome} def={def} />
          </>
        )}
      </div>
    </div>
  );
}

function FieldGroups({ groups, selected, onToggle }) {
  return (
    <section aria-labelledby="rb-fields-h">
      <h3 id="rb-fields-h">Fields</h3>
      {groups.map((g) => (
        <fieldset key={g.label} className="fo-fieldset" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <legend>{g.label}</legend>
          {g.fields.map((f) => (
            <label key={f.fieldId} className="fo-checkbox-label">
              <input
                type="checkbox"
                checked={selected.includes(f.fieldId)}
                onChange={() => onToggle(f.fieldId)}
              />
              {f.label}
              {f.sensitivity !== "standard" && <span className="fo-badge">{f.sensitivity}</span>}
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  );
}

function Filters({ def, selected, setDef }) {
  const filterable = selected.filter((f) => f.operators.includes("filter"));
  if (filterable.length === 0) return null;
  const addBlank = () => {
    const f = filterable[0];
    setDef(addFilter(def, { fieldId: f.fieldId, op: defaultComparator(f.dataType), value: "" }));
  };
  return (
    <section aria-labelledby="rb-filters-h">
      <h3 id="rb-filters-h">Filters</h3>
      {def.filters.map((flt, i) => (
        <FilterRow
          key={i}
          filter={flt}
          filterable={filterable}
          onChange={(patch) => setDef(updateFilter(def, i, patch))}
          onRemove={() => setDef(removeFilter(def, i))}
        />
      ))}
      <button type="button" className="fo-btn-secondary fo-link-btn" onClick={addBlank}>+ Add filter</button>
    </section>
  );
}

function FilterRow({ filter, filterable, onChange, onRemove }) {
  const field = filterable.find((f) => f.fieldId === filter.fieldId) ?? filterable[0];
  const comparators = FILTER_COMPARATORS_BY_TYPE[field.dataType] ?? [];
  const onField = (e) => {
    const next = filterable.find((f) => f.fieldId === e.target.value);
    onChange({ fieldId: next.fieldId, op: defaultComparator(next.dataType), value: "" });
  };
  return (
    <div className="fo-form" role="group" aria-label="Filter">
      <select aria-label="Field" value={filter.fieldId} onChange={onField}>
        {filterable.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.label}</option>)}
      </select>
      <select aria-label="Comparator" value={filter.op} onChange={(e) => onChange({ op: e.target.value })}>
        {comparators.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      {field.dataType === "boolean" ? (
        <select aria-label="Value" value={String(filter.value)} onChange={(e) => onChange({ value: e.target.value === "true" })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          aria-label="Value"
          type={field.dataType === "number" ? "number" : "text"}
          value={filter.value ?? ""}
          placeholder="value"
          onChange={(e) => onChange({ value: field.dataType === "number" ? Number(e.target.value) : e.target.value })}
        />
      )}
      <button type="button" className="fo-btn-secondary" onClick={onRemove} aria-label="Remove filter">Remove</button>
    </div>
  );
}

function GroupBy({ def, selected, setDef }) {
  const groupable = selected.filter((f) => f.operators.includes("group"));
  if (groupable.length === 0) return null;
  return (
    <section aria-labelledby="rb-group-h">
      <h3 id="rb-group-h">Group by</h3>
      {groupable.map((f) => (
        <label key={f.fieldId} className="fo-checkbox-label">
          <input type="checkbox" checked={def.groupBy.includes(f.fieldId)} onChange={() => setDef(toggleGroupBy(def, f.fieldId))} />
          {f.label}
        </label>
      ))}
    </section>
  );
}

function SortBy({ def, selected, setDef }) {
  const sortable = selected.filter((f) => f.operators.includes("sort"));
  if (sortable.length === 0) return null;
  const notYetSorted = sortable.filter((f) => !def.sort.some((s) => s.fieldId === f.fieldId));
  return (
    <section aria-labelledby="rb-sort-h">
      <h3 id="rb-sort-h">Sort</h3>
      {def.sort.map((s, i) => {
        const field = sortable.find((f) => f.fieldId === s.fieldId);
        if (!field) return null;
        return (
          <div key={s.fieldId} className="fo-form" role="group" aria-label="Sort">
            <span>{field.label}</span>
            <select aria-label="Direction" value={s.direction} onChange={(e) => setDef(updateSort(def, i, { direction: e.target.value }))}>
              {SORT_DIRECTIONS.map((dir) => <option key={dir} value={dir}>{dir === "asc" ? "ascending" : "descending"}</option>)}
            </select>
            <button type="button" className="fo-btn-secondary" onClick={() => setDef(removeSort(def, i))} aria-label="Remove sort">Remove</button>
          </div>
        );
      })}
      {notYetSorted.length > 0 && (
        <div className="fo-form">
          <label htmlFor="rb-add-sort">Add sort</label>
          <select id="rb-add-sort" value="" onChange={(e) => e.target.value && setDef(addSort(def, e.target.value))}>
            <option value="">Choose a field…</option>
            {notYetSorted.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.label}</option>)}
          </select>
        </div>
      )}
    </section>
  );
}

function ResultArea({ outcome, def }) {
  if (!outcome || outcome.kind === "idle") {
    const d = describeRunOutcome({ kind: "idle" });
    return <div className="fo-state" role={d.role}><p className="fo-state-title">{d.title}</p><p className="fo-muted fo-state-message">{d.message}</p></div>;
  }
  const d = describeRunOutcome(outcome);
  // Error tones (permission-denied, failure) carry no data.
  if (d.tone === "error") return <FailureState title={d.title} message={d.message} />;
  // A valid run with zero rows.
  if (d.kind === "empty") return <EmptyState title={d.title} message={d.message} variant="filtered" />;

  const rows = Array.isArray(outcome.rows) ? outcome.rows : [];
  const aggregates = Array.isArray(outcome.aggregates) ? outcome.aggregates : [];

  return (
    <div className={`fo-state fo-tone-${d.tone}`} role={d.role} aria-live="polite">
      {d.title && <p className="fo-state-title">{d.title}</p>}
      {d.message && <p className="fo-state-message fo-muted">{d.message}</p>}
      {/* dropped-column / dropped-predicate notices are surfaced here, never silently */}
      {d.notes.length > 0 && <ul>{d.notes.map((n, i) => <li key={i} className="fo-warning">{n}</li>)}</ul>}
      {rows.length > 0 && <ResultsTable caption="Results" columns={rowColumns(def?.fields, rows)} rows={rows} />}
      {aggregates.length > 0 && <ResultsTable caption="Summary" columns={aggregateColumns(aggregates)} rows={aggregates} />}
    </div>
  );
}

function ResultsTable({ caption, columns, rows }) {
  if (columns.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="fo-table">
        <caption className="fo-muted" style={{ textAlign: "left", captionSide: "top", marginBottom: 4 }}>
          {caption} — {rows.length} row{rows.length === 1 ? "" : "s"}
        </caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key}>{formatCell(row[c.key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
