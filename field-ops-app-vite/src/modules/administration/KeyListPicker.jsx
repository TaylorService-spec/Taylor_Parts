// A list of governed KEYS (Security Roles, Functional Roles) chosen by TYPEAHEAD (UI corrections item E, 2026-10-08) --
// the Workflow assignment selector. The value stays the comma-separated key list the draft definition already carries
// (definitionForServer is unchanged); each chosen key is a removable chip shown by its display name. Suggestions come from
// the governed catalog the caller already read; the SERVER still resolves every key and reports one it does not have.
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import { identifierLabel } from "../../shared/display/displayLabels.js";

const split = (value) => String(value ?? "").split(",").map((k) => k.trim()).filter(Boolean);

// `labels` (optional, key -> display name) names chosen keys that are NOT offered as options -- e.g. a Role already bound
// to a workflow action that is not eligible for it (W01 D3). `unlistedNote` (optional) is said beside such a chip.
// `readOnly` shows the chosen keys only: no remove buttons and no "Add…" input that would look usable but accept nothing.
// The caller says WHY the list is read-only; `disabled` remains the momentary state (e.g. while a save is in flight).
export default function KeyListPicker({ id, label, value, onChange, options = [], disabled = false, readOnly = false, labels = null, unlistedNote = null }) {
  const keys = split(value);
  const byKey = new Map(options.map((o) => [o.key, o]));
  const nameOf = (k) => byKey.get(k)?.label ?? labels?.[k];
  const add = (key) => { if (key && !keys.includes(key)) onChange([...keys, key].join(", ")); };
  const remove = (key) => onChange(keys.filter((k) => k !== key).join(", "));
  const search = async (query) => {
    const q = query.toLowerCase();
    const items = options.filter((o) => !keys.includes(o.key)
      && (o.key.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q)));
    return { ok: true, items, total: items.length };
  };
  return (
    <div className="fo-keylist" data-keylist={id} data-readonly={readOnly ? "true" : undefined}>
      <ul className="fo-keylist__chips" aria-label={`${label}: chosen`}>
        {keys.map((k) => (
          <li key={k} className="fo-cp-tag" data-key={k}>
            {identifierLabel(k, nameOf(k))}
            {byKey.has(k) ? null : labels?.[k] ? (unlistedNote ? <span className="fo-muted"> ({unlistedNote})</span> : null)
              : <span className="fo-muted"> (not in catalog)</span>}
            {readOnly ? null : <button type="button" className="fo-keylist__remove" aria-label={`Remove ${identifierLabel(k, nameOf(k))}`} disabled={disabled} onClick={() => remove(k)}>×</button>}
          </li>
        ))}
      </ul>
      {readOnly ? (keys.length === 0 ? <p className="fo-muted">None assigned</p> : null) : <Autocomplete
        id={id}
        label={label}
        hideLabel
        placeholder="Add…"
        search={search}
        getKey={(o) => o.key}
        getLabel={(o) => identifierLabel(o.key, o.label)}
        getContext={(o) => [o.key, o.context].filter(Boolean).join(" · ")}
        onSelect={(o) => { if (o) add(o.key); }}
        disabled={disabled}
        minChars={1}
        emptyText="No matching key in the catalog."
      />}
    </div>
  );
}
