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
//
// Site-work r4 E (Fix 2) -- minimal Saved Reports wiring. Save persists the definition the user
// actually built (via the SAME trusted createSavedDefinitionCallable Saved Reports uses); there is
// no update/overwrite callable on the server (savedReportService.js only exposes create / get /
// list / rename / duplicate / delete), so Save always creates a NEW saved report rather than
// silently claiming to overwrite one it can't. Open (?open=<id>, pushed by SavedReports.jsx) loads
// the definition via the same trusted get() Saved Reports uses and revalidates it through the
// existing F2/W-SAVE-UI reconciler (savedReportReconcile.js) -- catalog drift is dropped and
// surfaced exactly as it is in the Saved Reports "Open" preview, never silently restored.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  availableObjects, availableFieldGroups, defaultComparator,
  setObject, toggleField, toggleGroupBy, addFilter, updateFilter, removeFilter,
  addSort, updateSort, removeSort, builderErrors, builderStatus,
  hasCountRows, toggleCountRows,
} from "../../domain/reporting/reportBuilderModel.js";
import { createReportDefinition, FILTER_COMPARATORS_BY_TYPE, ARRAY_VALUE_COMPARATORS, SORT_DIRECTIONS } from "../../domain/reporting/reportQueryModel.js";
import { rowColumns, aggregateColumns, formatCell } from "../../domain/reporting/reportResultTable.js";
import { runReport } from "../../domain/reporting/reportExecutionSeam.js";
import { describeRunOutcome } from "../../domain/reporting/reportResultState.js";
import { savedReportService } from "../../domain/reporting/savedReportService.js";
import { reconcileSavedReport, describeReconciliation } from "../../domain/reporting/savedReportReconcile.js";
import { mapSavedDefinitionError } from "../../domain/reporting/savedReportServiceOutcome.js";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import LoadingState from "../../shared/ui/LoadingState";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives";

const OBJECTS = availableObjects();

// `runReportFn` defaults to the real D-FN seam; it exists only so a browser/dev harness can inject
// a fixture outcome (the trusted engine has no client-side test double). Production never passes it.
// `savedReportServiceImpl` is likewise injectable so tests never touch firebase/functions directly.
export default function ReportBuilder({ runReportFn = runReport, savedReportServiceImpl = savedReportService }) {
  const [def, setDef] = useState(() => createReportDefinition(null));
  const [outcome, setOutcome] = useState({ kind: "idle" });
  const [running, setRunning] = useState(false);
  const [searchParams] = useSearchParams();
  const openId = searchParams.get("open");
  const [openState, setOpenState] = useState(() => (openId ? { status: "loading" } : { status: "idle" }));
  const [saveName, setSaveName] = useState("");
  const [saveState, setSaveState] = useState({ status: "idle" });

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

  // Hydrate from a saved report when the route carries ?open=<id> (SavedReports.jsx's "Open").
  // Re-fetches via the trusted get() callable (never trusts a stale list-row embed) and runs the
  // SAME reconciler Saved Reports' own "Open" preview uses, so catalog drift is handled identically
  // in both places. Fail-closed: an unopenable/errored load leaves the builder blank, never guesses.
  useEffect(() => {
    if (!openId) { setOpenState({ status: "idle" }); return undefined; }
    let cancelled = false;
    setOpenState({ status: "loading" });
    savedReportServiceImpl.get(openId).then((rec) => {
      if (cancelled) return;
      const result = reconcileSavedReport(rec);
      if (!result.openable) {
        setOpenState({ status: "error", message: result.reason });
        return;
      }
      setDef(result.definition);
      setOutcome({ kind: "idle" });
      setSaveName(typeof rec?.name === "string" ? rec.name : "");
      setOpenState({ status: "loaded", drift: describeReconciliation(result), needsEditing: result.residualErrors.length > 0 });
    }).catch((err) => {
      if (cancelled) return;
      setOpenState({ status: "error", message: mapSavedDefinitionError(err).message });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the ?open id changes
  }, [openId]);

  // Save persists the CURRENT in-progress definition (not a stub) via the trusted create() callable
  // -- the same one Saved Reports' "New" already uses. There is no server-side update path, so this
  // always creates a new saved report; the label says so rather than implying an overwrite.
  const onSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaveState({ status: "saving" });
    try {
      await savedReportServiceImpl.create({ name, definition: def });
      setSaveState({ status: "success", name });
    } catch (err) {
      setSaveState({ status: "error", message: mapSavedDefinitionError(err).message });
    }
  };

  return (
    <div className="fo-main">
      <div className="fo-panel">
        <h2>Report builder</h2>
        <p className="fo-muted">
          Build a report from a governed business object. Only the data you're authorized to see is
          returned — fields you can't read are left out and shown as omitted.
        </p>

        <OpenBanner openState={openState} />

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

            {/* 3c. save -- persists the definition built above via the same trusted create()
                callable Saved Reports' "New" uses. No server-side update path exists yet, so this
                always creates a NEW saved report (never claims to overwrite one). */}
            <SaveControl saveName={saveName} setSaveName={setSaveName} saveState={saveState} onSave={onSave} />

            {/* 4. validation + run */}
            {errors.length > 0 && (
              <div className="fo-state" role="status">
                <p className="fo-state-title">Finish these to run:</p>
                <ul>{errors.map((msg, i) => <li key={i} className="fo-muted">{msg}</li>)}</ul>
              </div>
            )}

            <Button
              type="button"
              variant="primary"
              className="fo-btn-large"
              onClick={onRun}
              disabled={status !== "ready" || running}
              loading={running}
            >
              Run report
            </Button>

            <ResultArea outcome={outcome} def={def} />
          </>
        )}
      </div>
    </div>
  );
}

// Mirrors SavedReports.jsx's own OpenStatus copy/tone conventions -- loading while the trusted
// get() resolves, a safe refusal reason when unopenable/errored, and a drift/needs-editing note
// (never silently restored) once loaded.
function OpenBanner({ openState }) {
  if (openState.status === "idle") return null;
  if (openState.status === "loading") return <LoadingState>Opening saved report…</LoadingState>;
  if (openState.status === "error") {
    return <FailureState title="Couldn't open this report" message={openState.message} />;
  }
  if (!openState.drift && !openState.needsEditing) {
    return (
      <p className="fo-state fo-tone-info fo-state-message" role="status" aria-live="polite">
        Opened saved report. Still valid against the current data catalog.
      </p>
    );
  }
  return (
    <div className="fo-state fo-tone-warning" role="status" aria-live="polite">
      {openState.drift && <p className="fo-warning fo-state-message">{openState.drift}</p>}
      {openState.needsEditing && (
        <p className="fo-warning fo-state-message">
          Some columns or options are no longer valid — fix them below before running.
        </p>
      )}
    </div>
  );
}

function SaveControl({ saveName, setSaveName, saveState, onSave }) {
  return (
    <section aria-labelledby="rb-save-h">
      <h3 id="rb-save-h">Save</h3>
      <div className="fo-form">
        <label htmlFor="rb-save-name">Report name</label>
        <input
          id="rb-save-name"
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name this report"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={onSave}
          disabled={saveState.status === "saving" || saveName.trim() === ""}
          loading={saveState.status === "saving"}
        >
          Save as new report
        </Button>
      </div>
      {saveState.status === "success" && (
        <p className="fo-state fo-tone-info fo-state-message" role="status" aria-live="polite">
          Saved “{saveState.name}”. Find it in Saved Reports.
        </p>
      )}
      {saveState.status === "error" && (
        <p className="fo-warning fo-state-message" role="alert">{saveState.message}</p>
      )}
    </section>
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
              {f.sensitivity !== "standard" && <StatusPill tone="attention" label={f.sensitivity} />}
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
      <Button type="button" variant="secondary" className="fo-link-btn" onClick={addBlank}>+ Add filter</Button>
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
  // Switching comparators can change the required value SHAPE (scalar <-> array, or a 2-element
  // `between` pair) -- reset the value to a shape-appropriate empty when that boundary is crossed,
  // otherwise leave it alone (e.g. "in" <-> "containsAny" both stay array-valued).
  const onComparator = (e) => {
    const op = e.target.value;
    if (op === "between") { onChange({ op, value: ["", ""] }); return; }
    const isArray = ARRAY_VALUE_COMPARATORS.includes(op);
    // "in" <-> "containsAny" both take a plain array -- keep the value as the user built it.
    const keepValue = isArray && ARRAY_VALUE_COMPARATORS.includes(filter.op) && filter.op !== "between";
    onChange({ op, value: keepValue ? filter.value : (isArray ? [] : "") });
  };
  return (
    <div className="fo-form" role="group" aria-label="Filter">
      <select aria-label="Field" value={filter.fieldId} onChange={onField}>
        {filterable.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.label}</option>)}
      </select>
      <select aria-label="Comparator" value={filter.op} onChange={onComparator}>
        {comparators.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      <FilterValueInput field={field} filter={filter} onChange={onChange} />
      <Button type="button" variant="secondary" onClick={onRemove} aria-label="Remove filter">Remove</Button>
    </div>
  );
}

// The value control's shape follows the comparator, not just the field's dataType: array-valued
// comparators (in / containsAny) need a list, and `between` needs exactly two bounds (Spec-enforced
// by reportQueryValidation.js). Rendering only a scalar input here was the bug -- an array
// comparator could be selected but never given a legal value, so validation never cleared.
function FilterValueInput({ field, filter, onChange }) {
  const { op, value } = filter;

  if (field.dataType === "boolean") {
    return (
      <select aria-label="Value" value={String(value)} onChange={(e) => onChange({ value: e.target.value === "true" })}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (op === "between") {
    const bounds = Array.isArray(value) ? value : ["", ""];
    const inputType = field.dataType === "date" ? "date" : field.dataType === "number" ? "number" : "text";
    const cast = (v) => (field.dataType === "number" && v !== "" ? Number(v) : v);
    return (
      <span className="fo-form" role="group" aria-label="Between">
        <input aria-label="From" type={inputType} value={bounds[0] ?? ""} placeholder="from"
          onChange={(e) => onChange({ value: [cast(e.target.value), bounds[1] ?? ""] })} />
        <input aria-label="To" type={inputType} value={bounds[1] ?? ""} placeholder="to"
          onChange={(e) => onChange({ value: [bounds[0] ?? "", cast(e.target.value)] })} />
      </span>
    );
  }

  if (ARRAY_VALUE_COMPARATORS.includes(op)) {
    // Re-keyed on fieldId+op so switching field/comparator remounts with a fresh initial text
    // instead of a stale one; while the row stays put, the input owns its own text so a mid-typed
    // trailing "," or space isn't stripped out from under the user on every keystroke.
    return <ArrayValueInput key={`${filter.fieldId}:${op}`} field={field} value={value} onChange={onChange} />;
  }

  return (
    <input
      aria-label="Value"
      type={field.dataType === "number" ? "number" : "text"}
      value={value ?? ""}
      placeholder="value"
      onChange={(e) => onChange({ value: field.dataType === "number" ? Number(e.target.value) : e.target.value })}
    />
  );
}

function ArrayValueInput({ field, value, onChange }) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(", ") : ""));
  const onInput = (e) => {
    const raw = e.target.value;
    setText(raw);
    const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    onChange({ value: field.dataType === "number" ? parts.map(Number) : parts });
  };
  return (
    <input
      aria-label="Value"
      type="text"
      value={text}
      placeholder="comma-separated values (e.g. a, b, c)"
      onChange={onInput}
    />
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
            <Button type="button" variant="secondary" onClick={() => setDef(removeSort(def, i))} aria-label="Remove sort">Remove</Button>
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
