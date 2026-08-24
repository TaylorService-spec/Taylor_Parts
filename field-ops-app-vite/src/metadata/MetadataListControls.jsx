// THE ONE FILTER AND SORT EXPERIENCE — driven by object metadata, never by a screen-local registry.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md §14, §15.
// Converged from the retired `shared/ui/ListControls.jsx` pilot (PR #1442).
//
// ============================ WHAT A SCREEN NO LONGER DECIDES ============================
//
// Every control here is built from two pieces of metadata and nothing else:
//
//   the ENTITY   what fields the object has, what each is called, what it can be compared by
//   the LIST     which of those filters THIS list offers — which is the set whose composite
//                indexes scripts/listIndexCoverage.mjs has proved exist
//
// A screen that assembled its own filter array would be making a promise nothing verified. That is
// the failure §9 exists to prevent, and the reason a per-screen registry is not a style preference
// to be argued about: an offered filter with no index fails in front of a user, at read time, on a
// surface nobody touched.
//
// So a newly declared, index-backed field becomes filterable by being declared. Nobody edits a
// screen.
//
// ============================ REFUSALS EXPLAIN THEMSELVES ============================
//
// A field that is visible but cannot be queried says WHY — "lives on another record", "needs an
// index that has not been set up yet". A disabled control with no explanation is a dead end: the
// person cannot tell whether to wait, ask, or work around it, and neither can the next engineer.

import { useMemo, useState } from "react";
import { Button } from "../shared/ui/primitives/index.js";
import { UNSUPPORTED_TEXT } from "./unsupportedReason.js";
import { makeCriterion, describeCriterion, activeCriteriaCount } from "./listUrlState.js";

/** Comparison words, in business language. Nobody is shown `ARRAY_CONTAINS`. */
const OPERATOR_LABEL = Object.freeze({
  EQUALS: "is",
  NOT_EQUALS: "is not",
  IN: "is any of",
  GREATER_THAN: "is more than",
  GREATER_OR_EQUAL: "is at least",
  LESS_THAN: "is less than",
  LESS_OR_EQUAL: "is at most",
  ARRAY_CONTAINS: "includes",
  ARRAY_CONTAINS_ANY: "includes any of",
});

/** Sort wording chosen by TYPE, so a date reads "Newest first" rather than "createdAt desc". */
function sortOptionsFor(field) {
  const pair = (asc, desc) => [
    { fieldId: field.id, direction: "ASC", label: `${field.label} — ${asc}` },
    { fieldId: field.id, direction: "DESC", label: `${field.label} — ${desc}` },
  ];
  switch (field.type) {
    case "TIMESTAMP":
    case "DATE":
      return pair("Oldest first", "Newest first");
    case "NUMBER":
    case "CURRENCY_MINOR":
      return pair("Lowest first", "Highest first");
    case "ENUM":
      // GROUPED, NOT SEQUENCED. Firestore orders by the STORED STRING, so an enum sort puts every
      // ACTIVE together and every PROSPECT together -- genuinely useful -- and the resulting order
      // is alphabetical by machine value, not the lifecycle. "First to last" would read as the
      // lifecycle and deliver the alphabet, which is a promise no stored ordinal exists to keep.
      return pair("grouped A to Z", "grouped Z to A");
    default:
      return pair("A to Z", "Z to A");
  }
}

/** Fields a viewer may see at all. A capability resolver that throws DENIES. */
function readable(fields, hasCapability) {
  const holds = (capability) => {
    if (!capability) return true;
    try {
      return typeof hasCapability === "function" && hasCapability(capability) === true;
    } catch {
      return false;
    }
  };
  // A field this viewer may not read is ABSENT from the menu, not present-and-disabled. Offering it
  // greyed out still discloses that the field exists and what it is called.
  return (fields ?? []).filter((f) => f.displayable !== false && holds(f.readCapability));
}

/**
 * The value control, chosen by field TYPE.
 *
 * An enum gets a picker of HUMAN LABELS with the canonical value underneath, so nobody has to learn
 * `NON_STOCK` to filter by it — and so the query still receives the stored value.
 */
function CriterionValueInput({ field, value, onChange, options }) {
  const choices = options
    ?? (field.enumValues ?? []).map((v) => ({ value: v, label: field.enumLabels?.[v] ?? String(v) }));

  if (choices.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a value…</option>
        {choices.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === "NUMBER" || field.type === "CURRENCY_MINOR") {
    return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === "DATE" || field.type === "TIMESTAMP") {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Value" />;
}

/**
 * `+ Add Filter`.
 *
 * @param def    ListViewDefinition — the filters THIS list offers (index-backed)
 * @param entity EntityDefinition — the fields the object has
 */
export function AddFilter({ def, entity, onAdd, hasCapability = null, valueOptions = {} }) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState("");
  const [operator, setOperator] = useState("");
  const [value, setValue] = useState("");

  // The offered set is the INTERSECTION: a field the object has AND a filter this list declares.
  // Either alone would over-promise — the entity may mark a field filterable in principle while this
  // particular list has no index for it.
  const offered = useMemo(() => {
    const byId = new Map(readable(entity?.fields, hasCapability).map((f) => [f.id, f]));
    return (def?.filters ?? [])
      .map((f) => ({ filter: f, field: byId.get(f.fieldId) }))
      .filter((x) => x.field);
  }, [def, entity, hasCapability]);

  // Fields a person can SEE but cannot filter, with the reason. Shown so a disabled capability is
  // explained rather than simply missing.
  const unavailable = useMemo(() => {
    const offeredIds = new Set(offered.map((o) => o.field.id));
    return readable(entity?.fields, hasCapability)
      .filter((f) => !offeredIds.has(f.id) && f.unsupportedFilterReason)
      .map((f) => ({ label: f.label, why: UNSUPPORTED_TEXT[f.unsupportedFilterReason] }));
  }, [offered, entity, hasCapability]);

  const chosen = offered.find((o) => o.field.id === fieldId) ?? null;
  const reset = () => { setFieldId(""); setOperator(""); setValue(""); setOpen(false); };

  const commit = () => {
    if (!chosen || !operator) return;
    const options = valueOptions[fieldId]
      ?? (chosen.field.enumValues ?? []).map((v) => ({ value: v, label: chosen.field.enumLabels?.[v] ?? String(v) }));
    const picked = options.find((o) => String(o.value) === String(value));
    // The LABEL travels with the criterion so the chip is human immediately. It is not the only
    // defence -- describeCriterion re-resolves from the picker and the enum -- because a URL cannot
    // carry it and a shared link must still read as words.
    onAdd(makeCriterion({ fieldId, operator, value, valueLabel: picked?.label ?? null }));
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
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            // Operators come from the LIST's declared filter, so switching fields cannot leave a
            // comparison this list has no index to serve.
            const next = offered.find((o) => o.field.id === e.target.value);
            setOperator(next?.filter.operators?.[0] ?? "");
            setValue("");
          }}
        >
          <option value="">Choose a field…</option>
          {offered.map(({ field }) => <option key={field.id} value={field.id}>{field.label}</option>)}
        </select>
      </label>

      {chosen && (
        <label className="fo-listctl__step">
          Condition
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {chosen.filter.operators.map((op) => (
              <option key={op} value={op}>{OPERATOR_LABEL[op] ?? op}</option>
            ))}
          </select>
        </label>
      )}

      {chosen && (
        <label className="fo-listctl__step">
          Value
          <CriterionValueInput
            field={chosen.field}
            value={value}
            onChange={setValue}
            options={valueOptions[fieldId]}
          />
        </label>
      )}

      <div className="fo-listctl__actions">
        <Button onClick={commit} disabled={!chosen || !operator || value === ""}>Apply</Button>
        <Button variant="secondary" onClick={reset}>Cancel</Button>
      </div>

      {unavailable.length > 0 && (
        <p className="fo-listctl__why fo-muted">
          {unavailable.map((u) => `${u.label}: ${u.why}`).join(" ")}
        </p>
      )}
    </div>
  );
}

/** The chips. Each names its field and value in words, and removes itself. */
export function ActiveCriteria({ criteria, entity, onRemove, onClear, valueOptions = null }) {
  if (activeCriteriaCount(criteria) === 0) return null;
  return (
    <div className="fo-listctl__active" role="group" aria-label="Active filters">
      {(criteria.filters ?? []).map((c) => {
        const text = describeCriterion(c, entity, valueOptions);
        return (
          <span className="fo-listctl__chip" key={`${c.fieldId}:${c.operator}`}>
            {text}
            <button
              type="button"
              className="fo-listctl__chip-remove"
              aria-label={`Remove filter ${text}`}
              onClick={() => onRemove(c.fieldId, c.operator)}
            >
              ×
            </button>
          </span>
        );
      })}
      <Button variant="secondary" className="fo-listctl__clear" onClick={onClear}>Clear filters</Button>
    </div>
  );
}

/** Sort. Only fields the object declares sortable, in each field type's own vocabulary. */
export function SortControl({ entity, criteria, onSort, hasCapability = null }) {
  const options = useMemo(
    () => readable(entity?.fields, hasCapability).filter((f) => f.sortable).flatMap(sortOptionsFor),
    [entity, hasCapability],
  );
  const active = criteria?.sort?.[0];
  const current = active ? `${active.fieldId}:${active.direction}` : "";

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
 * What the link asked for and did not get.
 *
 * Rendered as a status region rather than an alert: nothing is broken, and the list below it is
 * usable. What is wrong is that it is WIDER than requested, which the message says out loud.
 */
export function DroppedCriteriaNotice({ message }) {
  if (!message) return null;
  return (
    // NAMED, not just a status region. A screen already carries other status text (a write-disabled
    // notice, a save result), and an unnamed live region leaves a screen-reader user to work out
    // which one just spoke.
    <p className="fo-state fo-tone-muted fo-state-message" role="status" aria-label="Criteria not applied">
      {message}
    </p>
  );
}

/**
 * The empty state.
 *
 * "No records match these filters" and "No data" are different statements, and only one of them is
 * true when somebody has narrowed a list to nothing. Telling a person the system is empty when they
 * filtered it empty sends them looking for a bug that is not there.
 */
export function ListEmptyState({ criteria, onClear, emptyLabel = "No records yet" }) {
  if (activeCriteriaCount(criteria) === 0) return <p className="fo-muted">{emptyLabel}</p>;
  return (
    <div className="fo-listctl__empty">
      <p className="fo-muted">No records match these filters.</p>
      <Button variant="secondary" onClick={onClear}>Clear filters</Button>
    </div>
  );
}
