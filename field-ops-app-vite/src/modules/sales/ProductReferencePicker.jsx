import { useId, useMemo, useState } from "react";
import {
  useProductReferenceSearch,
  PRODUCT_SEARCH_STATE as S,
  MIN_SEARCH_LENGTH,
} from "../../hooks/useProductReferenceSearch.js";

// CHOOSING THE PRODUCT A LINE COMMITS TO.
//
// ════════════════════ WHAT THIS REPLACES ════════════════════
//
// A text input labelled "Item" whose value went straight onto the line as `ref`. A person was being
// asked to reproduce a canonical id — "CW-P-0000", "taylor--c713" — from memory, and the only
// feedback that they had it wrong arrived after submitting the whole agreement.
//
// ════════════════════ IDENTITY IS NOT THE LABEL, EVER ════════════════════
//
// The line stores `ref` — the canonical id — and NOTHING ELSE about the product. The name beside it
// is display, resolved for confirmation, and is never written to the command. Commercial
// correctness must not depend on a string the client happened to be carrying: if the label were
// identity, renaming a part would rewrite what was sold.
//
// ════════════════════ TWO SHAPES, BECAUSE THE TWO CATALOGS ARE NOT ALIKE ════════════════════
//
// EQUIPMENT MODELS are reference data — one per model the company sells — so they are LISTED. A
// typeahead there would make somebody guess a prefix of an id they have never seen.
//
// PARTS are a large catalog, so they are SEARCHED. Enumerating them into a dropdown is the
// client-side dataset ownership boundary DECISIONS #102 §9 draws, and it would be slow at exactly
// the moment somebody is trying to quote.
//
// ════════════════════ A LEGACY REF IS SHOWN TRUTHFULLY ════════════════════
//
// Lines written before this control exist and may name anything. A ref that no longer resolves
// renders as "reference unavailable" beside the value the record actually holds — never as a blank
// (which reads as "no item"), and never silently cleared, which would quietly discard what the
// record says. The stored value is the record's, not this control's, to discard.

/**
 * Which kinds have an authority to pick FROM.
 *
 * SERVICE is deliberately false: there is no service-code catalog anywhere in the repository, so
 * there is nothing to pick. It keeps free text, and the server keeps accepting it — refusing a
 * declared commercial kind for lacking a catalog would delete the capability rather than govern it.
 */
export function isSearchableKind(kind) {
  return kind === "PART" || kind === "EQUIPMENT_MODEL";
}

function EquipmentModelSelect({ value, onChange, disabled, lineNumber }) {
  const { state, results } = useProductReferenceSearch("EQUIPMENT_MODEL", null, { enabled: !disabled });
  const sorted = useMemo(
    () => [...results].sort((a, b) => (a.displayName ?? a.ref).localeCompare(b.displayName ?? b.ref)),
    [results],
  );

  if (state === S.LOADING) return <span className="fo-muted">Loading models…</span>;
  if (state === S.DENIED) return <span className="fo-muted">You may not browse the model catalog.</span>;
  if (state === S.UNAVAILABLE) return <span className="fo-muted">The model catalog is unavailable.</span>;
  if (state === S.READY && sorted.length === 0) return <span className="fo-muted">No equipment models are set up yet.</span>;

  // The stored ref may predate this control, or name a model since removed. It stays selectable so
  // the record keeps saying what it says, and is labelled for what it is.
  const known = sorted.some((m) => m.ref === value);
  return (
    <select
      aria-label={`Line ${lineNumber} equipment model`}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose a model…</option>
      {!known && value ? <option value={value}>{value} — reference unavailable</option> : null}
      {sorted.map((m) => (
        <option key={m.ref} value={m.ref}>
          {m.displayName ? `${m.displayName} (${m.ref})` : m.ref}
        </option>
      ))}
    </select>
  );
}

function PartTypeahead({ value, onChange, disabled, lineNumber }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const { state, results, truncated } = useProductReferenceSearch("PART", text, { enabled: !disabled && open });

  const choose = (part) => {
    onChange(part.ref);
    setText("");
    setOpen(false);
    setActive(0);
  };

  // A CHOSEN PART IS NOT AN EDITABLE STRING. Once selected it renders as a chip with a Change
  // control, so there is no text box whose contents could be mistaken for the identity — which is
  // exactly how free text became the stored ref in the first place.
  if (value && !open) {
    const hit = results.find((r) => r.ref === value);
    return (
      <span className="fo-agreement-line__chosen">
        <span data-testid={`line-${lineNumber}-ref`}>{value}</span>
        {hit?.displayName ? <span className="fo-muted"> — {hit.displayName}</span> : null}
        <button
          type="button"
          className="fo-linkbutton"
          disabled={disabled}
          aria-label={`Line ${lineNumber} change part`}
          onClick={() => { setOpen(true); setText(""); }}
        >
          Change
        </button>
      </span>
    );
  }

  const onKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <span className="fo-agreement-line__typeahead">
      <input
        aria-label={`Line ${lineNumber} part search`}
        // combobox semantics so a screen reader announces that this suggests rather than accepts.
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search parts…"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {state === S.IDLE && text.trim().length > 0 && text.trim().length < MIN_SEARCH_LENGTH && (
        <span className="fo-muted">Keep typing…</span>
      )}
      {state === S.LOADING && <span className="fo-muted">Searching…</span>}
      {state === S.DENIED && <span className="fo-muted">You may not search the parts catalog.</span>}
      {state === S.UNAVAILABLE && <span className="fo-muted">The parts catalog is unavailable.</span>}
      {state === S.READY && results.length === 0 && <span className="fo-muted">No parts match that.</span>}
      {state === S.READY && results.length > 0 && (
        <ul id={listId} role="listbox" className="fo-typeahead__list">
          {results.map((p, i) => (
            <li key={p.ref} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
              >
                <span className="fo-typeahead__name">{p.displayName ?? p.ref}</span>
                {/* The id is shown BESIDE the name, as the disambiguator between similar parts --
                    never as the name itself. Two "Drive Belt"s are told apart by it. */}
                <span className="fo-muted"> {p.ref}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {truncated && <span className="fo-muted">More matches exist — refine your search.</span>}
    </span>
  );
}

export default function ProductReferencePicker({ kind, value, onChange, disabled = false, lineNumber = 1 }) {
  if (isSearchableKind(kind)) {
    return kind === "EQUIPMENT_MODEL" ? (
      <EquipmentModelSelect value={value} onChange={onChange} disabled={disabled} lineNumber={lineNumber} />
    ) : (
      <PartTypeahead value={value} onChange={onChange} disabled={disabled} lineNumber={lineNumber} />
    );
  }
  // SERVICE: no authority exists to pick from, so free text remains — and the server still accepts
  // it, because refusing a supported kind for lacking a catalog would delete the capability rather
  // than govern it.
  return (
    <input
      aria-label={`Line ${lineNumber} service description`}
      placeholder="Service"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
