// Issue #325 unit F3 -- the object-first report BUILDER shell.
//
// Pick an object -> pick authorized fields -> add filters / group / sort -> Run. It reads the
// F1 catalog and validates live with the F2 validator (all via reportBuilderModel.js), and a Run
// goes through the GATED execution seam (reportExecutionSeam.js), which is inert until the
// trusted Function ships (Issue #15) -- so this renders and validates but NEVER executes. The
// result area renders the full Spec §12 state matrix from a run outcome via describeRunOutcome;
// today a real Run yields the honest "unavailable" state, and the same renderer covers every
// other state for when the backend lands.
//
// Keyboard-first (native <select>/<input>/<button>, associated <label>s) and responsive (shared
// fo- layout tokens). This shell is intentionally NOT wired into navConfig.js/App.jsx -- exposing
// it in the product nav is activation (W1-UI), a later, separately-gated step; F1-F3 all ship
// inert and unreachable by construction.
import { useState } from "react";
import {
  availableObjects, availableFieldGroups, defaultComparator,
  setObject, toggleField, toggleGroupBy, addFilter, updateFilter, removeFilter,
  addSort, updateSort, removeSort, builderErrors, builderStatus,
} from "../../domain/reporting/reportBuilderModel.js";
import { createReportDefinition, FILTER_COMPARATORS_BY_TYPE, SORT_DIRECTIONS } from "../../domain/reporting/reportQueryModel.js";
import { runReport } from "../../domain/reporting/reportExecutionSeam.js";
import { describeRunOutcome } from "../../domain/reporting/reportResultState.js";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

const OBJECTS = availableObjects();

export default function ReportBuilder() {
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
    const result = await runReport(def);
    setOutcome(result);
    setRunning(false);
  };

  return (
    <div className="fo-main">
      <div className="fo-panel">
        <h2>Report builder</h2>
        <p className="fo-muted">
          Build a report from a governed business object. Reports don't run yet — the trusted
          reporting engine isn't deployed — so this validates your report but won't return data.
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

            <ResultArea outcome={outcome} />
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

function ResultArea({ outcome }) {
  if (!outcome || outcome.kind === "idle") {
    const d = describeRunOutcome({ kind: "idle" });
    return <div className="fo-state" role={d.role}><p className="fo-state-title">{d.title}</p><p className="fo-muted fo-state-message">{d.message}</p></div>;
  }
  const d = describeRunOutcome(outcome);
  if (d.tone === "error") return <FailureState title={d.title} message={d.message} />;
  if (d.kind === "empty") return <EmptyState title={d.title} message={d.message} variant="filtered" />;
  return (
    <div className={`fo-state fo-tone-${d.tone}`} role={d.role} aria-live="polite">
      {d.title && <p className="fo-state-title">{d.title}</p>}
      {d.message && <p className="fo-state-message fo-muted">{d.message}</p>}
      {d.notes.length > 0 && <ul>{d.notes.map((n, i) => <li key={i} className="fo-warning">{n}</li>)}</ul>}
    </div>
  );
}
