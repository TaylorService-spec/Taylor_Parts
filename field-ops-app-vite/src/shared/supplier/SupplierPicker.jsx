import { useId, useMemo, useState } from "react";
import { selectableActiveSuppliers, rankSupplierMatches } from "../../domain/supplierPicker";

// Governed Supplier entity selector. Replaces free-text supplier entry: the caller passes the governed
// Supplier read state ({ loading, error, suppliers } from useSuppliers) and receives the SELECTED ACTIVE
// Supplier ENTITY via onSelect (never a bare string). Only ACTIVE governed suppliers are selectable.
// FAIL-CLOSED: a denied/unavailable read shows an honest state and offers NO free-text fallback -- the
// caller must gate submit on a selected entity. Reusable (not a one-off dropdown): the API is entity-based
// so a later supplierId+snapshot persistence needs no interaction redesign.
const RESULT_LIMIT = 8;

export default function SupplierPicker({ loading, error, suppliers, selected, onSelect, inputId }) {
  const [query, setQuery] = useState("");
  const generatedId = useId();
  const boxId = inputId ?? `${generatedId}-supplier`;
  const listboxId = `${generatedId}-supplier-list`;

  const activeRows = useMemo(() => selectableActiveSuppliers(suppliers ?? []), [suppliers]);
  const { results } = useMemo(() => rankSupplierMatches(activeRows, query, RESULT_LIMIT), [activeRows, query]);

  if (loading) return <p className="fo-muted" role="status">Loading suppliers…</p>;
  if (error) {
    const denied = error === "permission-denied";
    return (
      <p className="fo-warning" role="alert">
        {denied
          ? "You do not have access to the governed supplier list, so a purchase order can’t be recorded here. Contact an administrator."
          : "The supplier list is unavailable, so a purchase order can’t be recorded right now. Try again later."}
      </p>
    );
  }

  // Selected: show the chosen governed supplier + a Change affordance.
  if (selected) {
    return (
      <div className="fo-supplier-selected">
        <div>
          <strong>{selected.name}</strong>{" "}
          <span className="fo-sup-status fo-sup-status--done">Active</span>
        </div>
        <button type="button" className="fo-linkbtn" onClick={() => { setQuery(""); onSelect(null); }}>Change supplier</button>
      </div>
    );
  }

  if (activeRows.length === 0) {
    return <p className="fo-muted" role="status">No active suppliers are available to select. An administrator must add or activate a supplier first.</p>;
  }

  return (
    <div className="fo-supplier-picker">
      <input
        id={boxId}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-autocomplete="list"
        placeholder="Search active suppliers…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {/* Each option is a native <button>, so it is fully keyboard-operable (Tab to focus, Enter/Space to
          select) without custom roving-tabindex arrow-key handling. This is a deliberately simpler pattern
          than CustomerPicker's roving listbox -- adequate for a bounded, name-sorted active-supplier list;
          do not copy one style onto the other assuming parity. */}
      <ul id={listboxId} role="listbox" aria-label="Active suppliers" className="fo-supplier-options">
        {results.length === 0 ? (
          <li className="fo-muted" aria-disabled="true">No matching active suppliers.</li>
        ) : (
          results.map((s) => (
            <li key={s.id} role="option">
              <button type="button" className="fo-supplier-option" onClick={() => onSelect(s)}>
                <span>{s.name}</span>
                {s.vendorNumber ? <span className="fo-muted"> · {s.vendorNumber}</span> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
