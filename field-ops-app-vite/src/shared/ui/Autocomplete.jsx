// SHARED AUTOCOMPLETE (UI corrections package, 2026-10-08, item E / H).
//
// The WAI-ARIA combobox over useTypeahead: an input with a listbox popup. Arrow keys move, Enter chooses, Escape closes,
// Tab leaves; mouse and touch choose with a pointer press (pointerdown, so the input's blur does not swallow it). Each
// suggestion shows its label and useful context. "View all results" is the last option when the caller can show a full
// result list for the query.
//
// Two uses, one component:
//   * a SEARCH box  (Global Search, the Users roster) -- onSelect opens the record; onViewAll shows every result;
//   * a SELECTOR    (employee, manager, owner, accountable, assignee, customer, equipment, workflow assignee) -- the
//                   chosen record is `selected`, shown in the input; typing again searches again and clears it.
// Authority is the server's: `search` is an EOS API read that applies capabilities, operating company and scope.
import { useEffect, useId, useRef, useState } from "react";
import { TYPEAHEAD_MIN_CHARS, TYPEAHEAD_STATE, useTypeahead } from "../../hooks/useTypeahead.js";

const VIEW_ALL = "__view_all__";

export default function Autocomplete({
  id,
  label,
  hideLabel = false,
  placeholder,
  search,
  onSelect,
  onViewAll = null,
  selected = null,
  getKey = (item) => item.id,
  getLabel = (item) => item.label,
  getContext = (item) => item.context ?? null,
  minChars = TYPEAHEAD_MIN_CHARS,
  debounceMs,
  limit,
  disabled = false,
  onQueryChange,
  initialQuery = "",
  className = "",
  emptyText = "No matches.",
  inputProps = {},
}) {
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const listId = `${inputId}-listbox`;
  const ta = useTypeahead({ search, minChars, debounceMs, limit });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [display, setDisplay] = useState(selected ? getLabel(selected) : initialQuery);
  const inputRef = useRef(null);

  // A selection made elsewhere (or cleared) is reflected in the input.
  const selectedKey = selected ? getKey(selected) : null;
  useEffect(() => { if (selected) setDisplay(getLabel(selected)); }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The highlighted option resets only when the ANSWERED query changes -- never on an unrelated re-render.
  useEffect(() => { setActive(-1); }, [ta.forQuery, ta.status]);

  const options = [
    ...ta.items.map((item) => ({ key: String(getKey(item)), item })),
    ...(onViewAll && ta.status === TYPEAHEAD_STATE.READY && ta.items.length > 0 ? [{ key: VIEW_ALL, item: null }] : []),
  ];
  const expanded = open && ta.status !== TYPEAHEAD_STATE.IDLE;

  const type = (value) => {
    setDisplay(value);
    ta.setQuery(value);
    setOpen(true);
    onQueryChange?.(value);
    if (selected && value !== getLabel(selected)) onSelect?.(null);
  };
  const choose = (option) => {
    if (!option) return;
    if (option.key === VIEW_ALL) { setOpen(false); onViewAll?.(ta.query.trim()); return; }
    setOpen(false);
    setDisplay(getLabel(option.item));
    onSelect?.(option.item);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => (options.length ? (i + 1) % options.length : -1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1)); }
    else if (e.key === "Enter") {
      if (expanded && active >= 0) { e.preventDefault(); choose(options[active]); }
      else if (onViewAll && ta.query.trim().length >= minChars) { e.preventDefault(); setOpen(false); onViewAll(ta.query.trim()); }
    } else if (e.key === "Escape") { if (expanded) { e.preventDefault(); setOpen(false); } }
  };

  const activeId = expanded && active >= 0 ? `${listId}-opt-${active}` : undefined;
  return (
    <div className={`fo-autocomplete ${className}`.trim()} data-autocomplete={ta.status}>
      <label htmlFor={inputId} className={hideLabel ? "fo-sr-only" : "fo-autocomplete__label"}>{label}</label>
      <input
        ref={inputRef}
        id={inputId}
        className="fo-input fo-autocomplete__input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeId}
        placeholder={placeholder}
        disabled={disabled}
        value={display}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        {...inputProps}
      />
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="fo-autocomplete__list" hidden={!expanded}>
        {ta.status === TYPEAHEAD_STATE.PENDING && ta.items.length === 0 ? <li className="fo-autocomplete__note" role="presentation">Searching…</li> : null}
        {ta.status === TYPEAHEAD_STATE.DENIED ? <li className="fo-autocomplete__note" role="presentation">Searching here is not available to you.</li> : null}
        {ta.status === TYPEAHEAD_STATE.FAILED ? <li className="fo-autocomplete__note" role="presentation">Suggestions could not be loaded.</li> : null}
        {ta.status === TYPEAHEAD_STATE.READY && ta.items.length === 0 ? <li className="fo-autocomplete__note" role="presentation">{emptyText}</li> : null}
        {options.map((option, i) => (
          <li
            key={option.key}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={`fo-autocomplete__option${i === active ? " fo-autocomplete__option--active" : ""}${option.key === VIEW_ALL ? " fo-autocomplete__option--all" : ""}`}
            data-option={option.key}
            onPointerDown={(e) => { e.preventDefault(); choose(option); }}
            onMouseEnter={() => setActive(i)}
          >
            {option.key === VIEW_ALL ? (
              <span>{`View All Results for “${ta.query.trim()}”${ta.total ? ` (${ta.total})` : ""}`}</span>
            ) : (
              <>
                <span className="fo-autocomplete__primary">{getLabel(option.item)}</span>
                {getContext(option.item) ? <span className="fo-autocomplete__context">{getContext(option.item)}</span> : null}
              </>
            )}
          </li>
        ))}
      </ul>
      <span className="fo-sr-only" aria-live="polite">
        {expanded && ta.status === TYPEAHEAD_STATE.READY ? `${ta.items.length} suggestion${ta.items.length === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}

/**
 * A `search` over a list the SERVER already returned for this caller (an assignable-technician roster, a governed
 * catalog): it narrows what the caller may already see and never widens it. Matches every word of the query.
 */
export function searchLoaded(items, getText) {
  return async (query) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (items ?? []).filter((item) => {
      const text = String(getText(item) ?? "").toLowerCase();
      return words.every((w) => text.includes(w));
    });
    return { ok: true, items: matches, total: matches.length };
  };
}
