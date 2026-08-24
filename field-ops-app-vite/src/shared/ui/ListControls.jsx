import { useMemo, useState } from "react";
import {
  filterableFields, sortableFields, groupFieldsByOwner, sortOptionsFor,
  OPERATOR_LABEL, FIELD_TYPE,
} from "../../domain/fieldMetadata.js";
import {
  describeFilter, makeFilter, RELATIVE_RANGE, RELATIVE_RANGE_LABEL, activeFilterCount,
} from "../../domain/listQueryState.js";
import { Button } from "./primitives/index.js";

// ADD FILTER, SORT, AND THE CHIPS THAT SHOW WHAT IS ACTIVE.
//
// ============================ IT READS METADATA; IT KNOWS NO OBJECTS ============================
//
// Nothing here mentions a Work Order, a Sales Order or a piece of Equipment. The available fields,
// their operators, their value pickers and their sort vocabulary all come from the field metadata —
// so a new object gets working filters by declaring fields, not by somebody writing a fourth filter
// menu that behaves subtly differently from the other three.
//
// ============================ THE USER NEVER SEES A QUERY ============================
//
// No `==`, no `array-contains`, no field ids. A person picks "Customer", "is", and a customer's NAME;
// the query layer is the only thing that knows an id is involved.
//
// ============================ ACTIVE FILTERS ARE VISIBLE ============================
//
// Applied filters are chips on the page, each individually removable — never state hidden inside a
// modal that has been dismissed. Somebody looking at a short list must be able to see instantly
// whether it is short because the data is, or because they narrowed it.

/** `+ Add Filter` — the field menu, grouped by the object that owns each field. */
export function AddFilter({ fields, objectLabel, onAdd, hasCapability = null, valueOptions = {} }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(null);
  const [operator, setOperator] = useState(null);
  const [value, setValue] = useState("");

  const groups = useMemo(
    () => groupFieldsByOwner(filterableFields(fields, { hasCapability }), objectLabel),
    [fields, objectLabel, hasCapability],
  );

  const reset = () => { setField(null); setOperator(null); setValue(""); setOpen(false); };

  const commit = () => {
    if (!field || !operator) return;
    // The picker's options carry {value, label}: the query gets the value, the chip gets the label.
    const options = valueOptions[field.id] ?? [];
    const chosen = options.find((o) => String(o.value) === String(value));
    onAdd(makeFilter({
      fieldId: field.id, operator, value,
      valueLabel: chosen?.label ?? (field.type === FIELD_TYPE.DATE || field.type === FIELD_TYPE.DATETIME
        ? (RELATIVE_RANGE_LABEL[value] ?? value)
        : null),
    }));
    reset();
  };

  if (!open) {
    return (
      <Button variant="secondary" className="fo-listctl__add" onClick={() => setOpen(true)}>
        + Add Filter
      </Button>
    );
  }

  return (
    <div className="fo-listctl__builder" role="group" aria-label="Add a filter">
      <label className="fo-listctl__step">
        Field
        <select
          value={field?.id ?? ""}
          onChange={(e) => {
            const next = fields.find((f) => f.id === e.target.value) ?? null;
            setField(next);
            // Operators come from the FIELD, so switching fields cannot leave a comparison that its
            // type never allowed.
            setOperator(next?.operators?.[0] ?? null);
            setValue("");
          }}
        >
          <option value="">Choose a field…</option>
          {groups.map((g) => (
            <optgroup key={g.owner} label={g.owner}>
              {g.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {field ? (
        <label className="fo-listctl__step">
          Condition
          <select value={operator ?? ""} onChange={(e) => setOperator(e.target.value)}>
            {field.operators.map((op) => (
              <option key={op} value={op}>{OPERATOR_LABEL[op] ?? op}</option>
            ))}
          </select>
        </label>
      ) : null}

      {field ? (
        <label className="fo-listctl__step">
          Value
          <FilterValueInput field={field} operator={operator} value={value} onChange={setValue} options={valueOptions[field.id]} />
        </label>
      ) : null}

      <div className="fo-listctl__actions">
        <Button onClick={commit} disabled={!field || !operator || value === ""}>Apply</Button>
        <Button variant="secondary" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * The value control, chosen by field TYPE.
 *
 * A reference field gets a picker of HUMAN IDENTITIES — "Harbor Grill Restaurant Group", never
 * `acct-harbor`. The id travels underneath as the option's value and is never shown.
 */
function FilterValueInput({ field, operator, value, onChange, options }) {
  const isDate = field.type === FIELD_TYPE.DATE || field.type === FIELD_TYPE.DATETIME;

  if (operator === "RELATIVE" && isDate) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {Object.values(RELATIVE_RANGE).map((r) => (
          <option key={r} value={r}>{RELATIVE_RANGE_LABEL[r]}</option>
        ))}
      </select>
    );
  }
  if (Array.isArray(options) && options.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  }
  if (isDate) return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === FIELD_TYPE.NUMBER || field.type === FIELD_TYPE.QUANTITY || field.type === FIELD_TYPE.CURRENCY) {
    return <input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** The chips. Visible on the page, each removable on its own. */
export function ActiveFilters({ state, fields, onRemove, onClear, valueOptions = null }) {
  const count = activeFilterCount(state);
  if (count === 0) return null;
  return (
    <div className="fo-listctl__active" role="group" aria-label="Active filters">
      {state.filters.map((f) => (
        <span className="fo-listctl__chip" key={`${f.fieldId}:${f.operator}`}>
          {describeFilter(f, fields, valueOptions)}
          <button
            type="button"
            className="fo-listctl__chip-remove"
            aria-label={`Remove filter ${describeFilter(f, fields, valueOptions)}`}
            onClick={() => onRemove(f.fieldId, f.operator)}
          >
            ×
          </button>
        </span>
      ))}
      <Button variant="secondary" className="fo-listctl__clear" onClick={onClear}>Clear filters</Button>
    </div>
  );
}

/** Sort, in the vocabulary each field's type deserves — "Newest first", not "scheduledStart desc". */
export function SortControl({ fields, state, onSort, hasCapability = null }) {
  const options = useMemo(() => {
    const sortable = sortableFields(fields, { hasCapability });
    return sortable.flatMap((f) => sortOptionsFor(f));
  }, [fields, hasCapability]);

  const current = state.sort ? `${state.sort.fieldId}:${state.sort.direction}` : "";

  return (
    <label className="fo-listctl__sort">
      Sort
      <select
        value={current}
        onChange={(e) => {
          if (!e.target.value) { onSort(null, null); return; }
          const [fieldId, direction] = e.target.value.split(":");
          onSort(fieldId, direction);
        }}
      >
        <option value="">Default order</option>
        {options.map((o) => (
          <option key={`${o.fieldId}:${o.direction}`} value={`${o.fieldId}:${o.direction}`}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * The empty state.
 *
 * "No records match these filters" and "No data" are different statements, and only one of them is
 * true when somebody has narrowed a list to nothing. Telling a person the system is empty when they
 * filtered it empty sends them to look for a bug that is not there.
 */
export function ListEmptyState({ state, onClear, emptyLabel = "No records yet" }) {
  const filtered = activeFilterCount(state) > 0 || !!state.search;
  if (!filtered) return <p className="fo-muted">{emptyLabel}</p>;
  return (
    <div className="fo-listctl__empty">
      <p>No records match these filters.</p>
      <Button variant="secondary" onClick={onClear}>Clear filters</Button>
    </div>
  );
}
